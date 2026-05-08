# EDGE Gym Access Control — Project Status Report

**Last updated:** 2026-05-08  
**Status:** Phases 1–4C complete. Full system built end-to-end.

---

## 1. What This System Does

A local-first gym ERP with offline entry control. The **edge service** runs at each gym branch on a Raspberry Pi / mini PC. It makes access allow/deny decisions from a local SQLite database without needing internet. When connectivity is available it syncs events to the central **API server** on a VPS.

```
Member scans RFID / QR
        │
        ▼
  Edge Service (branch, SQLite)
  ─ evaluates 5-rule engine locally
  ─ triggers relay / door lock
  ─ queues event to SQLite
        │  (sync when internet up)
        ▼
  API Server (VPS, MongoDB)
  ─ central member/staff/billing data
  ─ FCM push notifications
  ─ web admin panel (Phase 4)
```

---

## 2. Repository Layout

```
edge-gym-access-control/          ← monorepo root
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .env.example                  ← all required env vars documented
├── PROJECT_STATUS.md             ← this file
│
├── packages/
│   ├── shared-types/             ← @edge-gym/shared-types
│   │   └── src/
│   │       ├── enums.ts          ← all enums (MemberStatus, Zone, StaffRole, …)
│   │       ├── member.ts
│   │       ├── membership.ts
│   │       ├── access.ts         ← AccessRequest, AccessContext, JwtPayload
│   │       ├── payment.ts
│   │       ├── device.ts
│   │       ├── sync.ts           ← EdgeMemberRecord, EdgeStaffRecord, EdgeAccessPolicy
│   │       ├── staff.ts
│   │       └── index.ts
│   │
│   └── access-engine/            ← @edge-gym/access-engine (pure, no I/O)
│       └── src/
│           ├── engine.ts         ← evaluateAccess() — runs 5 rules in order
│           ├── types.ts          ← AccessRequest, AccessContext, AccessResult
│           ├── rules/
│           │   ├── blocklist.ts
│           │   ├── membership.ts
│           │   ├── zone.ts
│           │   ├── time-window.ts
│           │   └── anti-passback.ts
│           └── __tests__/engine.test.ts   ← 10 unit tests (Jest)
│
├── apps/
│   ├── api-server/               ← @edge-gym/api-server (VPS, Node 18, Fastify v4)
│   │   ├── vitest.config.ts
│   │   └── src/
│   │       ├── config.ts         ← Zod env validation, exits on bad env
│   │       ├── app.ts            ← buildApp() — registers all plugins + routes
│   │       ├── index.ts          ← entry point, starts server + worker
│   │       ├── plugins/
│   │       │   ├── firebase.ts   ← Firebase Admin SDK, decorates fastify.firebase
│   │       │   └── mongodb.ts    ← Mongoose connection plugin
│   │       ├── middleware/
│   │       │   └── rbac.ts       ← requireRoles(), requireBranchAccess()
│   │       ├── models/           ← 13 Mongoose models (see §5)
│   │       ├── routes/           ← 12 route plugins (see §6)
│   │       ├── services/
│   │       │   └── fcm.ts        ← fcmSendToToken, fcmSendMulticast, getAdminApp
│   │       ├── worker/
│   │       │   └── index.ts      ← 5 cron jobs (see §7)
│   │       └── __tests__/
│   │           ├── helpers/      ← mongo.ts, build-test-app.ts, tokens.ts
│   │           └── integration/  ← sync-contract, rbac, payment-flow
│   │
│   └── edge-service/             ← @edge-gym/edge-service (branch device, SQLite)
│       ├── vitest.config.ts
│       └── src/
│           ├── config.ts         ← Zod env validation
│           ├── index.ts          ← Fastify entry, /access/decide + /health + /sync/status
│           ├── db/
│           │   ├── schema.ts     ← 6 SQLite tables (WAL mode)
│           │   └── sqlite.ts     ← EdgeDB class (all SQLite operations)
│           ├── access/
│           │   └── decision.ts   ← decide() — wires EdgeDB → engine → SQLite event
│           ├── sync/
│           │   └── worker.ts     ← pull(), push(), heartbeat(), startSyncWorker()
│           └── __tests__/        ← edge-db, decision, sync-failure tests (Vitest)
│
├── infra/
│   ├── pm2/ecosystem.config.cjs  ← 3 PM2 processes (api, worker, edge-branch1)
│   └── frp/frpc.ini.example      ← FRP tunnel config for branch → VPS
│
└── ui/
    ├── admin.html                ← Web admin PWA mockup (9 sections, dummy data)
    └── mobile.html               ← Mobile APK mockup (5 screens, dummy data)
```

---

## 3. Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 18 (VPS constraint — plan migration to Node 20) |
| Package manager | pnpm 9 (workspaces) |
| Language | TypeScript 5.4, strict mode, ESM (`"type": "module"`) |
| API framework | Fastify v4 |
| Auth | Google Sign-In → Firebase Admin SDK → short-lived JWT (15m) + refresh (30d) |
| Central DB | MongoDB via Mongoose 8 |
| Edge DB | SQLite via better-sqlite3 (WAL mode, synchronous) |
| Validation | Zod (env + request bodies) |
| FCM | Firebase Admin SDK messaging |
| Job scheduler | node-cron |
| Process manager | PM2 |
| Tunnel | FRP (branch edge → VPS) |
| Testing (engine) | Jest 29 + ts-jest |
| Testing (api+edge) | Vitest 1.6 + mongodb-memory-server |

---

## 4. Environment Variables

Copy `.env.example` and fill in values. Both processes on VPS share the same file.

**API Server required vars:**
```
MONGODB_URI, JWT_SECRET (≥32 chars), REFRESH_TOKEN_SECRET (≥32 chars),
FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY,
EDGE_SHARED_SECRET (≥16 chars — must match edge service value)
```

**Edge Service required vars (per branch, set in PM2 env or system env):**
```
EDGE_DEVICE_ID, EDGE_BRANCH_ID, EDGE_SYNC_BASE_URL,
EDGE_SHARED_SECRET (same secret as API server)
EDGE_SQLITE_PATH (default: ./data/edge.db)
```

> **EDGE_SHARED_SECRET** is the HMAC key used to sign push-events batches from the edge service and verify them on the API server. Both sides must use the same value.

---

## 5. MongoDB Models (13 total)

| Model | Collection | Purpose |
|---|---|---|
| `User` | users | Firebase-linked admin/staff accounts |
| `Branch` | branches | Gym branch locations |
| `Member` | members | Gym members (rfidCardId, qrToken, fcmToken, status) |
| `MemberPlan` | memberplans | Subscription plan templates |
| `Membership` | memberships | Active member subscription instances |
| `Staff` | staffs | Staff records (role, shifts, rfidCardId) |
| `Payment` | payments | All financial transactions (receiptNo unique) |
| `Product` | products | Retail inventory items |
| `InventoryTransaction` | inventorytransactions | Stock in / sales / adjustments |
| `AccessDevice` | accessdevices | Registered RFID/QR/face machines |
| `AccessEvent` | accessevents | Hot access log (≤90 days, unique index on edgeDeviceId+localSeq) |
| `ArchivedAccessEvent` | archivedaccessevents | Cold storage (>90 days, same unique index) |
| `SyncCheckpoint` | synccheckpoints | Per-device last heartbeat, ackCursor, syncLag |
| `AuditLog` | auditlogs | Immutable audit trail for every mutation |

---

## 6. API Routes (base: `/api/v1`)

### Auth — no JWT required
| Method | Path | Description |
|---|---|---|
| POST | `/auth/google/login` | Firebase ID token → app JWT + refresh token |
| POST | `/auth/refresh` | Refresh token → new access token |
| GET | `/auth/me` | Current user info |

### Members
| Method | Path | Description |
|---|---|---|
| GET | `/members` | List (branch-scoped for non-owners) |
| POST | `/members` | Create (status=pending) |
| GET | `/members/:id` | Get single |
| PUT | `/members/:id` | Update profile / zones / rfid |
| POST | `/members/:id/block` | Block with reason |
| POST | `/members/:id/unblock` | Restore to active |
| POST | `/members/:id/qr-token` | Regenerate QR access token (synced to edge on next pull) |
| PUT | `/members/:id/fcm-token` | Register member app FCM token |

### Memberships
| Method | Path | Description |
|---|---|---|
| POST | `/memberships` | Create membership + payment + activate member |
| POST | `/memberships/:id/renew` | Renew plan + record payment |
| POST | `/memberships/:id/freeze` | Freeze period + extend endDate |

### Branches
| Method | Path | Description |
|---|---|---|
| GET | `/branches` | List (owner sees all; others see their branches) |
| POST | `/branches` | Create — owner only |
| GET | `/branches/:id` | Get single |
| PUT | `/branches/:id` | Update — owner only |
| DELETE | `/branches/:id` | Soft-delete (isActive=false) — owner only |

### Staff
| Method | Path | Description |
|---|---|---|
| GET | `/staff` | List with role/branch filter |
| POST | `/staff` | Create — owner or manager |
| GET | `/staff/:id` | Get single |
| PUT | `/staff/:id` | Update — owner or manager |
| DELETE | `/staff/:id` | Deactivate |
| GET | `/staff/:id/attendance` | Access events for this staff member |

### Products
| Method | Path | Description |
|---|---|---|
| GET | `/products` | List (supports `?lowStock=true`) |
| POST | `/products` | Create — owner or manager |
| GET | `/products/:id` | Get single |
| PUT | `/products/:id` | Update |
| DELETE | `/products/:id` | Soft-delete |
| POST | `/products/:id/stock-in` | Restock — creates InventoryTransaction |
| POST | `/products/:id/sell` | POS sale — decrements stock, creates Payment |

### Access Events
| Method | Path | Description |
|---|---|---|
| GET | `/access/events` | Filtered paginated event log |
| GET | `/access/attendance/:memberId` | Visit sessions (check-in/out pairs from main_entry events) |

### Payments
| Method | Path | Description |
|---|---|---|
| GET | `/payments` | List with filters |
| GET | `/payments/summary` | Aggregate totals by mode (MongoDB aggregate) |
| GET | `/payments/:id` | Single receipt |
| POST | `/payments` | Standalone payment (locker, walk-in, etc.) |

### Notifications
| Method | Path | Description |
|---|---|---|
| POST | `/notifications/send` | FCM push to a single member |
| POST | `/notifications/campaign` | Broadcast to all active members of a branch |
| POST | `/notifications/renewal-batch` | Renewal reminders for members expiring in N days |

### Reports
| Method | Path | Description |
|---|---|---|
| GET | `/reports/dues` | Members with expired memberships |
| GET | `/reports/daily-collection` | Revenue grouped by date |
| GET | `/reports/expiring` | Memberships expiring in N days |
| GET | `/reports/access-denied` | Denied entry events |
| GET | `/reports/stock-low` | Products at or below minStockLevel |
| GET | `/reports/attendance` | Daily attendance aggregation |

### Edge Sync (no JWT — edge devices use HMAC)
| Method | Path | Description |
|---|---|---|
| POST | `/edge/register` | Register new device, returns plaintext secret (one-time) |
| POST | `/edge/heartbeat` | Update device online status, returns server time + drift |
| GET | `/edge/pull` | Download members, staff, policies, blocklist to edge |
| POST | `/edge/push-events` | Upload access events batch (HMAC-verified, idempotent) |

### Health / Metrics (public, no auth)
| Method | Path | Description |
|---|---|---|
| GET | `/health` | Liveness + MongoDB ping latency + process stats |
| GET | `/api/v1/metrics` | Heap memory, MongoDB state, Node.js info |

---

## 7. Worker Cron Jobs

All cron jobs run inside the separate `edge-gym-worker` PM2 process.

| Schedule | Job | What it does |
|---|---|---|
| Daily 00:05 | Expiry check | Finds active memberships past endDate → sets Expired on Membership + Member |
| Daily 09:00 | Renewal reminders | Sends FCM push to members expiring in ≤7 days |
| Hourly | Device heartbeat alert | Logs warning if any edge device has no heartbeat for >10 min |
| Daily 08:00 | Low-stock alert | Logs warning for products at or below minStockLevel |
| Daily 03:00 | Archive | Moves AccessEvents >90 days old to ArchivedAccessEvent in 500-record batches |

---

## 8. Edge Service Endpoints

The edge service runs locally on the branch device (default port 8090).

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Device ID + uptime |
| POST | `/access/decide` | Body: `{ identifierValue, identifierType, zone }` → allow/deny + relay trigger |
| GET | `/sync/status` | Last sync state + pending event count |

The sync worker runs in the background:
- Every 30 s: push pending events → pull updated member data
- Every 60 s: heartbeat to VPS

---

## 9. Access Decision Rules (in order)

Implemented in `packages/access-engine/src/engine.ts`. Rules short-circuit on first failure.

| # | Rule | Deny reason |
|---|---|---|
| 1 | Blocklist check | `DENY_BLACKLISTED` |
| 2 | Membership validity (status, hasDues, activeUntil) | `DENY_MEMBER_BLOCKED`, `DENY_MEMBER_FROZEN`, `DENY_MEMBER_EXPIRED`, `DENY_PAYMENT_DUE`, `DENY_UNKNOWN_IDENTITY` |
| 3 | Zone + branch entitlement | `DENY_NOT_IN_ALLOWED_ZONE`, `DENY_BRANCH_NOT_PERMITTED` |
| 4 | Time window (if policy defined for zone) | `DENY_OUTSIDE_TIME_WINDOW` |
| 5 | Anti-passback (60 s cooldown per subject+zone) | `DENY_ANTI_PASSBACK` |

---

## 10. RBAC (Role-Based Access Control)

Roles (from `StaffRole` enum): `owner > manager > trainer > receptionist > accountant > cleaner`

| Action | Required role |
|---|---|
| Create / update / delete branches | owner |
| Create / update / delete staff | owner, manager |
| Create products, stock-in | owner, manager, accountant |
| Send notifications | owner, manager, trainer, receptionist |
| Campaign / renewal-batch notifications | owner, manager |
| View members, access events, payments | all authenticated |
| Data is always filtered to `branchIds` in JWT unless role = owner | — |

---

## 11. Test Suites

### Run all tests
```bash
pnpm install          # install all workspace deps
pnpm test             # runs all test suites across workspaces
```

### Individual suites
```bash
# Access engine unit tests (Jest)
cd packages/access-engine && pnpm test

# API server integration tests (Vitest + mongodb-memory-server)
cd apps/api-server && pnpm test

# Edge service unit tests (Vitest, in-memory SQLite)
cd apps/edge-service && pnpm test
```

### Test coverage
| Suite | File | Tests |
|---|---|---|
| engine | `packages/access-engine/src/__tests__/engine.test.ts` | 10 unit tests — all 5 rules |
| sync-contract | `apps/api-server/src/__tests__/integration/sync-contract.test.ts` | HMAC push (valid/duplicate/invalid), pull structure, heartbeat |
| rbac | `apps/api-server/src/__tests__/integration/rbac.test.ts` | Auth guard, owner-only mutations, branch isolation, public endpoints |
| payment-flow | `apps/api-server/src/__tests__/integration/payment-flow.test.ts` | Member create, membership+payment, renew, freeze, summary, receipt |
| edge-db | `apps/edge-service/src/__tests__/edge-db.test.ts` | Upsert idempotency, event queue, sync state, blocklist CRUD |
| decision | `apps/edge-service/src/__tests__/decision.test.ts` | ALLOW/DENY scenarios, event appended after each call, localSeq increment |
| sync-failure | `apps/edge-service/src/__tests__/sync-failure.test.ts` | Network down → events stay pending; success → synced; batch cap; pull; markSynced idempotency |

---

## 12. Known Gaps & TODOs for Next Developer

These are real gaps in the current codebase — **not design decisions**, just work not yet done.

### Critical
- **`POLICY_VERSION` never incremented**: `POLICY_VERSION = 1` is a hardcoded constant in `edge-sync.ts`. There is no mechanism to bump it when member data changes, so the edge device never knows it should re-pull. Need to store the policy version in a config document (or use a hash of the data) and increment on any member/policy mutation.

- **`lastPolicyVersion` never updated**: After a successful pull, `EdgeDB.getSyncState().lastPolicyVersion` stays at 0 forever. The pull response includes `policyVersion` but the worker ignores it. Add `EdgeDB.updatePolicyVersion(v: number)` and call it in `pull()`.

- **`activeUntil` wrong in edge/pull response**: In `edge-sync.ts` GET `/edge/pull`, `activeUntil` is set to `m.createdAt.toISOString()` (creation date) instead of the membership's actual `endDate`. This means the time-window rule on the edge will use the wrong date. Fix: join Membership collection or store `activeUntil` on Member directly.

- **`hasDues` always false**: The pull response sets `hasDues: false` for all members. Add logic to check if a member has an outstanding payment balance.

- **No admin UI for MemberPlan CRUD**: There are no API routes for creating/editing MemberPlan documents. New developers must seed plans directly in MongoDB. Add `GET/POST/PUT/DELETE /member-plans` routes.

### Important
- **Device secret verification unused**: `POST /edge/register` returns a plaintext secret and stores a hash (`secretKeyHash`). The `/edge/push-events` endpoint only verifies the HMAC (which uses `EDGE_SHARED_SECRET` shared across all devices) — it does NOT verify per-device secrets. Implement per-device auth if multi-tenant security is needed.

- **Staff RFID lookup at edge never returns a Staff record**: In `decision.ts`, when `identifierType === 'rfid'` and member lookup fails, it calls `db.getStaffByRfid()`. But the pull response from the server does NOT populate `local_staff` (the `upsertStaff()` method doesn't exist in EdgeDB). Add `upsertStaff()` to EdgeDB and call it in `pull()`.

- **No face/fingerprint adapter**: `identifierType === 'face'` and `'fingerprint'` are accepted by the schema but `decision.ts` has no lookup path for them. The face machine adapter (TCP listener, SDK bridge) is out of scope but needs a stub or TODO.

- **FCM token registration**: The `PUT /members/:id/fcm-token` endpoint exists and the member app registers on launch (in `NotificationSetup`). Renewal reminder FCM jobs are now end-to-end functional once the app is installed.

- **No rate limiting**: The API has no rate limiting or DDoS protection. Add `@fastify/rate-limit` before production.

- **Auth route uses `fastify.jwt.sign`**: In `auth.ts` line 52, `fastify.jwt.sign()` is called but the JWT plugin was registered with `namespace: 'api'`, so the decorator is `fastify.api`. This likely throws at runtime. Fix: use `fastify['api'].sign(payload, ...)` or remove the `namespace` option.

### Minor / Future
- `receiptNo` uses `Date.now()` — not collision-safe under high concurrency. Use `nanoid` or a database sequence.
- `memberCode` uses `Date.now().slice(-6)` — same collision risk. Use a proper counter.
- `AuditLog` has no TTL index — will grow indefinitely. Add a 1-year TTL or archive policy.
- `GET /reports/*` endpoints have no pagination — could return huge result sets.
- No email notifications (only FCM). Consider adding Nodemailer for renewal reminders.
- `infra/frp/frpc.ini.example` has one branch entry — document how to add more branches.

---

## 13. Phase 4 — What Still Needs to Be Built

### Phase 4A: React Web Admin PWA ✅ COMPLETE (2026-05-08)

Built at `apps/web-admin/`. React 18 + Vite + TanStack Query v5 + Zustand + Tailwind CSS.

**App location:** `apps/web-admin/`

**Setup:**
```bash
cd apps/web-admin
cp .env.example .env      # fill in VITE_API_URL + Firebase config
pnpm install
pnpm dev                  # starts on http://localhost:5173
pnpm build                # production build → dist/
```

**Pages built:**
1. **Login** (`/login`) — Google SSO via Firebase → `POST /auth/google/login` → JWT in Zustand (persisted) + refresh token
2. **Dashboard** (`/dashboard`) — KPI cards, live access feed (10s poll), expiring memberships widget, 7-day revenue sparkline
3. **Members** (`/members`) — Paginated table with search/status filter, add member modal, row → detail page
4. **Member Detail** (`/members/:id`) — Profile, membership history, payment history, access log tabs; create membership; regenerate QR; block/unblock
5. **Access Monitor** (`/access`) — Device status strip, live event feed (8s poll), zone/decision filters
6. **Fees & Billing** (`/billing`) — Payment list, revenue KPI cards, standalone payment modal
7. **Staff** (`/staff`) — Staff table with role badges, add/edit modal (manager+ only)
8. **Products** (`/products`) — Inventory table, low-stock banner, restock modal, add/edit (manager+ only)
9. **Reports** (`/reports`) — 6-tab view: Dues, Expiring Soon, Daily Collection, Denied Access, Low Stock, Attendance
10. **Settings** (`/settings`) — Branch CRUD (owner only), My Profile, System Health (API health + metrics)

**Architecture:**
- `src/api/` — One module per resource (axios + React Query), all typed
- `src/store/auth.ts` — Zustand with `persist` (token, user, selectedBranchId)
- `src/store/toast.ts` — Global toast via Zustand + 4s auto-dismiss
- `src/api/client.ts` — Axios instance with JWT injection interceptor + auto-refresh on 401
- `src/hooks/useRole.ts` — `isOwner`, `isManager`, `can(roles[])` for UI guards
- Design system matches `ui/admin.html`: dark `#05050A`, purple/cyan gradient, glassmorphism cards

### Phase 4B: Member Mobile App ✅ COMPLETE (2026-05-08)

Built at `apps/member-app/`. Expo SDK 51 + Expo Router 3.5 + TanStack Query v5 + Zustand (AsyncStorage persist).

**App location:** `apps/member-app/`

**Setup:**
```bash
cd apps/member-app
cp .env.example .env      # fill in EXPO_PUBLIC_API_URL + Firebase + Google client IDs
pnpm install
npx expo start            # Expo Go or dev build
npx expo run:android      # Android build
npx expo run:ios          # iOS build (Mac only)
```

**Screens built:**
1. **Login** (`/login`) — Google OAuth via `expo-auth-session` → Firebase `signInWithCredential` → API JWT → persisted to AsyncStorage
2. **Home/Dashboard** (`/(tabs)/`) — Hero membership card with LinearGradient + progress bar, stats row (this month/days left/renewals), Quick Actions (4 nav buttons), Recent Activity (5 latest check-ins), 30s auto-refresh
3. **My Card** (`/(tabs)/card`) — QR code via `react-native-qrcode-svg`, pulse ring animation, membership validity bar, allowed zones chips, QR regenerate with confirmation, today's stats
4. **Access History** (`/(tabs)/history`) — All check-in/deny events, grouped by day (Today/Yesterday/date), filter tabs (All/Allowed/Denied), load more (up to 100)
5. **Notifications** (`/(tabs)/alerts`) — Local notifications from `useNotifStore` (Zustand+AsyncStorage, max 50), grouped by day, type icons (renewal/entry/payment/promotion/system), mark read / mark all read / clear
6. **Profile** (`/(tabs)/profile`) — Avatar hero, 4-stat row (total visits/this month/days left/renewals), active membership card (LinearGradient), membership history, assigned trainer card, notification preference toggles (Switch), sign out with Firebase + Zustand logout

**Architecture:**
- `src/api/auth.ts` — `useGoogleAuth()` (expo-auth-session) + `loginWithGoogleToken()` + `logout()` (Firebase signOut)
- `src/api/member.ts` — `getProfile`, `getMemberships`, `getAccessHistory`, `registerFcmToken`, `regenerateQr`
- `src/api/client.ts` — Axios with JWT injection + 401 refresh + single-flight token refresh guard
- `src/store/auth.ts` — Zustand persist to AsyncStorage (token, refreshToken, user, memberId)
- `src/store/notifications.ts` — Local notif store; Expo push listener in `_layout.tsx`; max 50 stored
- `src/theme.ts` — `C` color constants + `GRAD` + `S` shared card/sectionTitle styles
- `app/_layout.tsx` — `AuthGate` (redirect on token change) + `NotificationSetup` (FCM token registration)
- Design system matches `ui/mobile.html`: dark `#05050A`, purple/cyan gradient, glassmorphism surfaces

### Phase 4C: Edge Hardware Adapter ✅ COMPLETE (2026-05-08)

Built at `apps/hardware-adapter/`. Node.js TypeScript service that runs on the branch Raspberry Pi / mini PC alongside the edge service.

**Setup on Raspberry Pi:**
```bash
cd apps/hardware-adapter
cp .env.example .env
cp readers.config.example.json readers.config.json
# Edit readers.config.json for your wiring, then:
pm2 start ../../infra/pm2/ecosystem.config.cjs --only hardware-adapter-branch1
```

**Reader types:**
| Type | Protocol | Use case |
|---|---|---|
| `wiegand` | Wiegand 26/34-bit via GPIO | Most RFID readers (EM4100, MIFARE, HID) |
| `serial`  | RS-485 ASCII / USB-HID serial | Budget readers, USB QR scanners |
| `tcp`     | ZKTeco ASCII / raw hex over TCP | Networked biometric terminals |
| `mock`    | Timer-based simulated scans | Dev / testing without hardware |

**Hardware outputs per reader:** Relay (GPIO pulse), Green LED (ALLOW), Red LED (DENY), Buzzer (beep patterns).

**Decision flow:** `CardReadEvent → cooldown check → POST /access/decide → relay/LED/buzzer`

**Fail-CLOSED:** If edge service is unreachable, the door does NOT open.

**Key files:** `src/config.ts`, `src/readers/` (4 reader types + base), `src/output/` (relay/buzzer/LED), `src/controller.ts` (decision loop), `src/health.ts` (Fastify :8092)

**Tests (Vitest):** Wiegand bit parser, serial format parser, controller ALLOW/DENY/cooldown/network-failure scenarios.

**PM2 entry:** `hardware-adapter-branch1` in `infra/pm2/ecosystem.config.cjs`

---

## 14. How to Start Development

### First time setup
```bash
# Install all workspace deps
pnpm install

# Build shared packages first
cd packages/shared-types && pnpm build
cd packages/access-engine && pnpm build

# Copy env and fill in values
cp .env.example .env

# Run API server in dev mode (auto-reloads on change)
cd apps/api-server && pnpm dev

# Run edge service in dev mode (separate terminal)
cd apps/edge-service && pnpm dev
```

### Run tests
```bash
pnpm test                        # all suites
cd apps/api-server && pnpm test  # integration tests only
cd apps/edge-service && pnpm test # edge unit tests only
cd packages/access-engine && pnpm test  # engine unit tests (Jest)
```

### Production deploy (VPS)
```bash
pnpm -r build                    # build all TypeScript
pm2 start infra/pm2/ecosystem.config.cjs --env production
pm2 save
```

### Adding a new branch edge device
1. POST `/api/v1/edge/register` → get `deviceCode` + `secret`
2. Set env vars on branch device: `EDGE_DEVICE_ID`, `EDGE_BRANCH_ID`, `EDGE_SHARED_SECRET`
3. Add a new PM2 app entry in `infra/pm2/ecosystem.config.cjs`
4. Add FRP tunnel entry in `infra/frp/frpc.ini` for the new branch port
5. Run `pm2 reload ecosystem.config.cjs`

---

## 15. File Count Summary

| Area | Files |
|---|---|
| Shared types | 9 |
| Access engine (+ 1 test) | 8 |
| API server models | 13 |
| API server routes | 12 |
| API server plugins/middleware/services | 4 |
| API server worker + entry | 2 |
| API server tests | 6 |
| Edge service | 5 |
| Edge service tests | 3 |
| Infra | 2 |
| UI mockups | 2 |
| Config/root | 5 |
| **Total** | **71** |
