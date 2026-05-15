# EDGE Gym Access Control — Project Status Report

**Last updated:** 2026-05-15  
**Status:** Phases 1–4C complete + all admin web features built. Ready for client handover (VPS deploy + Firebase setup needed).

---

## 1. What This System Does

A local-first gym ERP with offline entry control. The **edge service** runs at each gym branch on a Raspberry Pi / mini PC. It makes access allow/deny decisions from a local SQLite database without needing internet. When connectivity is available it syncs events to the central **API server** on a VPS.

```
Member/Staff scans RFID / face (U5) / QR
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
  ─ web admin panel (React PWA)
  ─ member mobile app (Expo / React Native)
```

---

## 2. Repository Layout

```
edge-gym-access-control/          ← monorepo root (pnpm workspaces)
├── packages/
│   ├── shared-types/             ← @edge-gym/shared-types (enums, interfaces)
│   └── access-engine/            ← @edge-gym/access-engine (5-rule decision engine)
│
├── apps/
│   ├── api-server/               ← VPS: Fastify v4 + MongoDB/Mongoose + Firebase Admin
│   ├── edge-service/             ← Branch device: SQLite, offline decision, sync worker
│   ├── hardware-adapter/         ← Branch device: Wiegand/Serial/TCP reader → relay/LED
│   ├── web-admin/                ← React 18 PWA (Vite + TanStack Query + Zustand + Tailwind)
│   └── member-app/               ← Expo SDK 51 mobile app (Android APK / iOS)
│
├── infra/
│   ├── pm2/ecosystem.config.cjs  ← PM2 process config (api, worker, edge-branch1, hw-branch1)
│   └── frp/frpc.ini.example      ← FRP reverse tunnel template (branch edge → VPS)
│
└── PROJECT_STATUS.md             ← this file
```

---

## 3. Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 18 (VPS) |
| Package manager | pnpm 9 (workspaces) |
| Language | TypeScript 5.4, strict, ESM |
| API framework | Fastify v4 |
| Auth | Google Sign-In → Firebase Admin → JWT (15m) + refresh (30d) |
| Central DB | MongoDB via Mongoose 8 |
| Edge DB | SQLite via better-sqlite3 (WAL mode) |
| Process manager | PM2 |
| Tunnel | FRP (branch → VPS) |
| Mobile | Expo SDK 51, expo-router 3.5, React Native 0.74 |

---

## 4. API Routes (base: `/api/v1`)

### New routes added 2026-05-15

| Method | Path | Description |
|---|---|---|
| PATCH | `/products/:id/broadcast` | Toggle broadcastEnabled ON/OFF |
| GET | `/reports/staff-attendance` | Individual staff punch records (subjectType=staff) |
| GET | `/reports/staff-attendance/download` | Download ALOG_0{MM}.txt for EDGEFOLIO salary import |
| GET | `/api/v1/health` | Health now accessible from frontend (was only at /health) |

### Full route list (all prefixed `/api/v1`)

Auth, Members, Memberships, Branches, Staff, Products, Access Events, Payments, Notifications, Reports, Edge Sync — see previous version of this file or `apps/api-server/src/routes/` for full list.

**Reports tab breakdown:**
| Tab | Backend endpoint | What it shows |
|---|---|---|
| Dues | `/reports/dues` | Members with expired memberships |
| Expiring Soon | `/reports/expiring` | Active memberships expiring in N days |
| Daily Collection | `/reports/daily-collection` | Revenue grouped by date |
| Denied Access | `/reports/access-denied` | Denied entry events |
| Low Stock | `/reports/stock-low` | Products at/below min stock level |
| Attendance | `/reports/attendance` | **Aggregate daily count** — total member check-ins per day |
| Staff Attendance | `/reports/staff-attendance` | **Individual staff punches** — downloadable as ALOG_0{MM}.txt |

> **Attendance vs Staff Attendance:** "Attendance" counts all ALLOW events per day (useful to see how busy the gym was). "Staff Attendance" is per-employee punch records filtered to `subjectType=staff`, formatted for EDGEFOLIO salary calculation. The ALOG filename is `ALOG_001.txt` through `ALOG_012.txt` based on selected month.

---

## 5. Web Admin — Complete Feature List (as of 2026-05-15)

Built at `apps/web-admin/`. All pages are functional end-to-end.

| Page | Route | Features |
|---|---|---|
| Login | `/login` | Google SSO (Firebase) → JWT |
| **Dashboard** | `/dashboard` | KPI cards, live access feed, expiring memberships, **Broadcast Products widget**, 7-day revenue sparkline |
| Members | `/members` | Paginated list, search/filter, add/edit modal |
| Member Detail | `/members/:id` | Profile, memberships, payments, access log, create membership, block/unblock, QR regen |
| Access Monitor | `/access` | Device status strip, live feed, **Members / Staff / Strangers segments** |
| Billing | `/billing` | Payment list, revenue KPIs, standalone payment |
| **Staff** | `/staff` | Staff table with Face Enrolled status, add/edit (face enroll inline for create & edit) |
| **Products** | `/products` | Inventory table, **Broadcast ON/OFF toggle per product**, restock, low-stock banner |
| Reports | `/reports` | 7-tab view including **Staff Attendance + ALOG download** |
| Settings | `/settings` | Branches (owner), Profile, Billing/GST, **Access Hours** (toggle fixed), Live Access wizard, System Health |

---

## 6. Staff Face Attendance — How It Works

1. **Enroll staff face:** In Staff page → Edit staff → Upload photo → click "Enroll on Machine". This calls `POST /api/v1/staff/:id/enroll-face` which pushes the face to the U5 machine with `id_number = staff._id.toString()`.

2. **Sync attendance:** The edge service polls `GET /workNoteList` from U5 every N seconds. When a punch arrives with a `user_id`, the sync-attendance route looks up Member first, then Staff (using the `id_number` field). If it matches a Staff record, the AccessEvent is saved with `subjectType: 'staff'`.

3. **Download ALOG:** Settings → Reports → Staff Attendance tab → select month range → click Download ALOG. Saves as `ALOG_001.txt` through `ALOG_012.txt`. Place in `D:\IOT Device\Salary_On\Realtime\` for EDGEFOLIO to pick up.

---

## 7. Product Broadcast Feature

- Each product has `broadcastEnabled` (default `false`).
- Toggle ON/OFF with the pink switch in the Products page → Broadcast column.
- Dashboard shows a **"Broadcast Products"** card with all ON products (name, category, price).
- Clicking any tile navigates to the Products page.
- Use this to display current promotions / featured products on a display screen.

---

## 8. MongoDB Models (14 total)

| Model | Purpose |
|---|---|
| User | Firebase-linked admin/staff accounts |
| Branch | Gym branches (accessHoursEnabled, gstEnabled, gstPercent) |
| Member | Members (rfidCardId, qrToken, fcmToken, status) |
| MemberPlan | Subscription plan templates |
| Membership | Active subscription instances |
| **Staff** | Staff (role, shifts, rfidCardId, **machineUsers**, **faceEnrolled**) |
| Payment | All financial transactions |
| **Product** | Retail inventory (**broadcastEnabled**) |
| InventoryTransaction | Stock in / sales / adjustments |
| **AccessDevice** | Registered devices (**make**, **liveAccessMethod**) |
| AccessEvent | Hot access log (≤90 days) — **subjectType: member/staff/visitor/unknown** |
| ArchivedAccessEvent | Cold storage (>90 days) |
| SyncCheckpoint | Per-device sync state |
| AuditLog | Immutable audit trail |

---

## 9. Known Gaps (for next developer)

### Critical (affects production correctness)
- **`activeUntil` wrong in edge pull:** `edge-sync.ts` sets `activeUntil` to `m.createdAt` instead of membership `endDate`. Edge service uses wrong expiry date. Fix: join Membership or store `activeUntil` on Member.
- **`POLICY_VERSION` never incremented:** Edge never knows when to re-pull. Need to bump on any member/policy change.
- **`hasDues` always false:** Pull response doesn't check outstanding balances.
- **No MemberPlan CRUD routes:** Plans must be seeded directly in MongoDB. Add `GET/POST/PUT/DELETE /member-plans`.

### Important
- **Staff RFID at edge never resolves:** `pull()` doesn't call `upsertStaff()` — add it so staff RFID works offline.
- **No rate limiting:** Add `@fastify/rate-limit` before public deployment.
- **Auth route uses wrong JWT namespace:** `fastify.jwt.sign()` may throw; check if `namespace: 'api'` is set.
- **Per-device secret verification unused:** `/edge/push-events` only checks shared HMAC, not per-device secret.

### Minor
- `receiptNo` and `memberCode` use `Date.now()` — not collision-safe under high concurrency.
- `AuditLog` has no TTL index.
- `GET /reports/*` have no pagination.

---

## 10. Mobile App (APK Developer Handover)

**Location:** `apps/member-app/`  
**Framework:** Expo SDK 51, React Native 0.74, expo-router 3.5  
**Build:** `eas build --platform android --profile preview`

### Screens already built
| Screen | File | Status |
|---|---|---|
| Login | `app/login.tsx` | Google OAuth → Firebase → API JWT |
| Home/Dashboard | `app/(tabs)/index.tsx` | Membership card, stats, quick actions, recent check-ins |
| My Card | `app/(tabs)/card.tsx` | QR code display, scan animation, regen with confirm |
| Access History | `app/(tabs)/history.tsx` | Check-ins grouped by day, filter tabs |
| Notifications | `app/(tabs)/alerts.tsx` | FCM push + local store, mark read, clear |
| Profile | `app/(tabs)/profile.tsx` | Membership details, trainer card, sign out |

### What the APK developer needs to do
1. **Firebase config** — fill `.env` with `EXPO_PUBLIC_FIREBASE_*` and Google client IDs
2. **API URL** — set `EXPO_PUBLIC_API_URL` to the VPS URL (e.g. `https://api.yourgym.in`)
3. **EAS account** — log in to Expo (`eas login`) and run `eas build --platform android --profile preview`
4. **Google OAuth** — add Android SHA-1 fingerprint to Firebase console + Google Cloud OAuth client
5. **Test** — login, check QR code displays, verify check-in history pulls from API

### Pending mobile features (not yet built)
- **Membership renewal payment** — in-app UPI/Razorpay flow
- **Product shop** — browse gym retail products, add to cart
- **Broadcast products display** — show products where `broadcastEnabled=true` as promotions
- **Push notification deep links** — tapping renewal reminder navigates to renewal screen
- **Offline support** — show last-known membership card when no internet

---

## 11. FRPC Tunnel — Setup for Remote Updates from VPS

The branch edge service runs inside the gym (behind NAT/firewall). FRP (Fast Reverse Proxy) creates a secure tunnel so you can reach the branch device from the VPS.

### How it works
```
VPS (public IP)          Branch mini-PC (private LAN)
  frps (port 7000) ◄──── frpc ──── edge service (port 8091)
  exposes port 18091               
```

### Current config at `infra/frp/frpc.ini.example`
```ini
[common]
server_addr = your-vps-ip
server_port = 7000
token       = your_frp_token

[edge-branch1]
type        = tcp
local_ip    = 127.0.0.1
local_port  = 8091
remote_port = 18091
```

### Production setup steps
1. **On VPS** — install frps, create `/etc/frp/frps.ini`:
   ```ini
   [common]
   bind_port = 7000
   token      = your_secret_token
   ```
   Run: `pm2 start frps -- -c /etc/frp/frps.ini`

2. **On branch mini-PC** — install frpc, copy `frpc.ini.example` to `/etc/frp/frpc.ini`, fill in VPS IP and token.  
   Run: `pm2 start frpc -- -c /etc/frp/frpc.ini`

3. **Test tunnel:** From VPS, `curl http://localhost:18091/health` → should return branch edge health JSON.

### Remote update workflow (from VPS)
```bash
# On VPS — pull latest code
cd /opt/edge-gym && git pull

# Build updated packages
pnpm -r build

# Restart API server on VPS
pm2 restart edge-gym-api

# Push update to branch mini-PC via tunnel
ssh branch-user@localhost -p 22091  # if you also tunnel SSH
# OR: use rsync over the tunnel, OR: configure PM2 deploy
```

> **Current gap:** There is no automated deploy script for the branch device. To update the edge service remotely, you need either an SSH tunnel in FRPC (add a second `[ssh-branch1]` block with `local_port=22`) or set up PM2's remote deploy feature pointing at the VPS git remote.

---

## 12. Client Handover — What the Gym Owner Needs to Configure

### Prerequisites (done by you / integrator)
1. VPS with Node 18, PM2, MongoDB, FRP server running
2. Firebase project created, `google-services.json` / `.env` filled
3. Web admin built and served: `pnpm build` → nginx serves `apps/web-admin/dist/`
4. API server started: `pm2 start infra/pm2/ecosystem.config.cjs --env production`
5. Branch mini-PC: edge service + hardware adapter + frpc running via PM2

### What the gym owner configures (via web admin UI)
1. **Login** — Google account (must be added as `Owner` in MongoDB `users` collection first)
2. **Settings → Branches** — create branch, set name/address/phone
3. **Settings → Billing & GST** — enable if GST-registered, set rate
4. **Settings → Access Hours** — optionally restrict entry to specific times/days
5. **Staff page** — add staff, upload face photos, assign roles and shifts
6. **Products page** — add retail inventory, set prices, toggle broadcast for promotions
7. **Members** — add members, create memberships, issue RFID cards

### Demo / Seed Login
The system uses **Google OAuth via Firebase** — there is no username/password login. To give a client a demo:

**Option A (recommended for demo):** Add the client's Google account email to the `users` collection in MongoDB with `role: 'owner'` and the correct `branchIds`. They sign in with their own Google account.

**Option B (for GYMDEMO credentials):** The `dev-server.ts` has a `POST /api/v1/auth/dev-login` endpoint that issues a JWT without any credentials — but this only works in `pnpm dev:local` mode (in-memory MongoDB, no Firebase). It is **not active** in production.

To create a GYMDEMO-style seed login for production:
1. Create a dedicated Gmail account `gymdemo@gmail.com` (or your choice)
2. Add it to Firebase Authentication manually
3. Insert into MongoDB: `db.users.insertOne({ firebaseUid: '<uid from Firebase>', email: 'gymdemo@gmail.com', displayName: 'GYMDEMO', role: 'owner', branchIds: ['<branch_id>'], isActive: true })`
4. Client logs in with that Gmail account via Google Sign-In

> There is currently no username/password login in the system. Adding `GYMDEMO / 123456` requires either: (a) replacing Firebase auth with a local JWT-based auth system (moderate work), or (b) creating a dedicated `POST /auth/seed-login` endpoint that accepts a hardcoded username/password and issues a JWT (simpler, ~1 hour work). See §13 for details.

---

## 13. TODO: GYMDEMO Seed Login (if required)

To add `GYMDEMO / 123456` login without Firebase:

**Backend** (`apps/api-server/src/routes/auth.ts`) — add route:
```typescript
fastify.post('/auth/seed-login', { config: { skipAuth: true } }, async (req, reply) => {
  const { username, password } = req.body as { username: string; password: string };
  const seeds = JSON.parse(process.env['SEED_LOGINS'] ?? '[]');
  const match = seeds.find((s: { username: string; password: string; role: string; branchIds: string[] }) =>
    s.username === username && s.password === password
  );
  if (!match) return reply.status(401).send({ error: 'Invalid credentials' });
  const token = fastify.jwt.sign({ sub: `seed-${username}`, email: `${username}@seed`, role: match.role, branchIds: match.branchIds }, { expiresIn: '24h' });
  return reply.send({ accessToken: token });
});
```

**Env var** (`.env`):
```
SEED_LOGINS=[{"username":"GYMDEMO","password":"123456","role":"owner","branchIds":["<id>"]}]
```

**Frontend** (`apps/web-admin/src/pages/Login.tsx`) — add a "Demo Login" button that calls `/auth/seed-login` and stores the JWT same as Google login.

---

## 14. Phase Summary

| Phase | Description | Status |
|---|---|---|
| 1 | Shared types + access engine (5 rules, offline) | ✅ Complete |
| 2 | API server (Fastify, Mongoose, all routes, worker) | ✅ Complete |
| 3 | Edge service (SQLite, sync, hardware adapter) | ✅ Complete |
| 4A | Web admin PWA (all 10 pages, RBAC, real-time) | ✅ Complete |
| 4B | Member mobile app (6 screens, QR, FCM) | ✅ Built — needs Firebase config + EAS build |
| 4C | Hardware adapter (Wiegand/Serial/TCP/mock) | ✅ Complete |
| 4D | Staff face attendance + ALOG export | ✅ Complete (2026-05-15) |
| 4E | Product broadcast + dashboard widget | ✅ Complete (2026-05-15) |
| — | GYMDEMO / seed login | ⏳ Not started — ~1 hour, see §13 |
| — | Mobile: renewal payment, product shop | ⏳ Not started |
| — | Automated FRPC deploy script | ⏳ Not started — see §11 |
| — | MemberPlan CRUD routes | ⏳ Not started — currently seed-only |
| — | activeUntil + hasDues fix on edge pull | ⏳ Critical bug — see §9 |
