# EDGE Gym Access Control System

Local-first gym ERP with offline entry control, multi-branch management, web admin PWA, member mobile app, and hardware GPIO/TCP reader integration.

---

## Quick Overview

```
Member scans RFID / QR at branch door
            │
            ▼
    Hardware Adapter          ← Raspberry Pi / mini PC
    (GPIO / serial / TCP)       reads card, controls relay
            │ POST /access/decide
            ▼
    Edge Service              ← same device, port 8091
    (SQLite, offline-first)     5-rule decision engine
            │ sync when online
            ▼
    API Server (VPS)          ← port 3000
    MongoDB + Firebase
            │
     ┌──────┴──────┐
     ▼             ▼
  Web Admin     Member App
  (React PWA)   (Expo RN)
```

**Offline guarantee:** The edge service makes allow/deny decisions from local SQLite without any internet connection. Events are queued and synced to the VPS when connectivity returns.

---

## Repository Layout

```
.
├── packages/
│   ├── shared-types/          @edge-gym/shared-types — enums, DTOs
│   └── access-engine/         @edge-gym/access-engine — pure 5-rule decision engine
├── apps/
│   ├── api-server/            Central VPS API (Fastify v4 + MongoDB)
│   ├── edge-service/          Branch local service (Fastify + SQLite)
│   ├── hardware-adapter/      GPIO/TCP reader → edge service → relay
│   ├── web-admin/             React + Vite web admin PWA
│   └── member-app/            Expo React Native member app
├── infra/
│   ├── pm2/ecosystem.config.cjs
│   └── frp/frpc.ini.example
├── .env.example
└── PROJECT_STATUS.md          Full technical reference (API routes, models, known gaps)
```

---

## Prerequisites

| Tool | Version | Where needed |
|---|---|---|
| Node.js | 18.x (minimum) | VPS, branch device, dev machine |
| pnpm | 9+ | everywhere |
| MongoDB | 6+ or Atlas free | VPS |
| Firebase project | — | Auth + FCM (see §3) |
| PM2 | latest | VPS + branch device |
| Expo CLI | latest | member app dev |
| Raspberry Pi / mini PC | any Linux | branch (hardware-adapter only) |

---

## 1. Firebase Project Setup

Every component (API server, web admin, member app) shares one Firebase project.

1. Go to [Firebase Console](https://console.firebase.google.com/) → **New project**
2. **Authentication** → Sign-in method → enable **Google**
3. **Project Settings** → Service accounts → **Generate new private key**
   - Save the JSON; you'll extract three fields for the API server `.env`
4. **Project Settings** → General → **Your apps** → Add a **Web app**
   - Copy `apiKey`, `authDomain`, `projectId` for `web-admin` and `member-app`
5. (Optional) **Cloud Messaging** → your web push certificate for FCM

---

## 2. Clone and Install

```bash
git clone <repo-url> gym-access-control
cd gym-access-control

pnpm install          # installs all workspace packages at once
```

---

## 3. Environment Variables

### Root `.env` (API server + edge service on VPS)

```bash
cp .env.example .env
```

| Variable | Description |
|---|---|
| `MONGODB_URI` | MongoDB connection string, e.g. `mongodb+srv://user:pass@cluster.mongodb.net/gym` |
| `JWT_SECRET` | ≥32 random chars — signs member/staff access tokens |
| `REFRESH_TOKEN_SECRET` | ≥32 random chars — signs 30-day refresh tokens |
| `FIREBASE_PROJECT_ID` | From Firebase service account JSON |
| `FIREBASE_CLIENT_EMAIL` | From Firebase service account JSON |
| `FIREBASE_PRIVATE_KEY` | From Firebase service account JSON (keep the `\n` line breaks) |
| `EDGE_SHARED_SECRET` | ≥16 random chars — HMAC key shared between API and all edge devices |

### Web Admin (`apps/web-admin/.env`)

```bash
cp apps/web-admin/.env.example apps/web-admin/.env
```

| Variable | Description |
|---|---|
| `VITE_API_URL` | API server URL, e.g. `https://api.yourdomain.com` |
| `VITE_FIREBASE_API_KEY` | Firebase web app `apiKey` |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase web app `authDomain` |
| `VITE_FIREBASE_PROJECT_ID` | Firebase project ID |

### Member App (`apps/member-app/.env`)

```bash
cp apps/member-app/.env.example apps/member-app/.env
```

| Variable | Description |
|---|---|
| `EXPO_PUBLIC_API_URL` | API server URL |
| `EXPO_PUBLIC_FIREBASE_API_KEY` | Firebase web app `apiKey` |
| `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN` | Firebase `authDomain` |
| `EXPO_PUBLIC_FIREBASE_PROJECT_ID` | Firebase project ID |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | OAuth 2.0 Web Client ID (from Google Cloud Console) |
| `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID` | Android OAuth Client ID (optional) |
| `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` | iOS OAuth Client ID (optional) |

### Hardware Adapter (`apps/hardware-adapter/.env`)

```bash
cp apps/hardware-adapter/.env.example apps/hardware-adapter/.env
```

| Variable | Default | Description |
|---|---|---|
| `EDGE_SERVICE_URL` | `http://localhost:8091` | URL of the local edge service |
| `HEALTH_PORT` | `8092` | Port for the adapter's own `/health` endpoint |
| `READERS_CONFIG` | `./readers.config.json` | Path to reader hardware config (see §7) |
| `RELAY_PULSE_MS` | `500` | How long to hold the relay open (ms) |
| `CARD_COOLDOWN_MS` | `3000` | Minimum gap between two reads of the same card (ms) |
| `MOCK_MODE` | `false` | Set `true` to run without GPIO hardware (simulates card scans) |

---

## 4. Build Shared Packages

These must be built before anything else imports them:

```bash
pnpm --filter @edge-gym/shared-types build
pnpm --filter @edge-gym/access-engine build
```

---

## 5. Development — Running Everything Locally

Open four terminals:

**Terminal 1 — API server**
```bash
cd apps/api-server
pnpm dev          # tsx watch, auto-reloads; listens on :3000
```

**Terminal 2 — Edge service**
```bash
cd apps/edge-service
pnpm dev          # listens on :8091 by default
```

**Terminal 3 — Hardware adapter (mock mode)**
```bash
cd apps/hardware-adapter
MOCK_MODE=true pnpm dev    # simulates a card scan every 8 s; no GPIO needed
```

**Terminal 4 — Web admin**
```bash
cd apps/web-admin
pnpm dev          # Vite dev server on http://localhost:5173
                  # proxies /api → http://localhost:3000 automatically
```

**Member app (separate)**
```bash
cd apps/member-app
npx expo start    # opens Expo Go QR for iOS/Android
```

---

## 6. Seed Initial Data

The API has no migration runner. After first start, seed manually via the API or MongoDB shell:

```bash
# Create the first branch (required before adding members/staff)
curl -X POST http://localhost:3000/api/v1/branches \
  -H "Authorization: Bearer <owner-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"name":"Main Branch","city":"Mumbai","timezone":"Asia/Kolkata"}'

# Create at least one MemberPlan (no UI yet — use curl or MongoDB Compass)
# Insert directly into the memberplans collection:
# { name: "Monthly", durationDays: 30, price: 1500, allowedZones: ["MAIN_FLOOR","CARDIO_AREA"] }
```

> **Note:** MemberPlan CRUD endpoints are a known gap — see §12 in PROJECT_STATUS.md.

---

## 7. Hardware Adapter — Reader Configuration

Copy the example and edit it for your physical hardware:

```bash
cp apps/hardware-adapter/readers.config.example.json \
   apps/hardware-adapter/readers.config.json
```

Each entry in the array defines one physical reader + its associated relay:

```jsonc
[
  {
    "name": "main-entrance",       // friendly name for logs
    "type": "wiegand",             // wiegand | serial | tcp | mock
    "zone": "MAIN_FLOOR",          // must match a Zone enum value
    "relayPin": 22,                // BCM GPIO pin for the door relay
    "ledGreenPin": 25,             // (optional) BCM GPIO for green LED
    "ledRedPin": 26,               // (optional) BCM GPIO for red LED
    "buzzerPin": 24,               // (optional) BCM GPIO for buzzer
    "options": {
      "d0Pin": 17,                 // Wiegand D0 data line (BCM)
      "d1Pin": 18,                 // Wiegand D1 data line (BCM)
      "bitFormat": 26              // 26 or 34
    }
  }
]
```

**Zone values** (from `@edge-gym/shared-types`):
`MAIN_FLOOR`, `CARDIO_AREA`, `WEIGHTS_ROOM`, `POOL`, `SAUNA`, `CROSSFIT_BOX`, `YOGA_STUDIO`, `SPIN_CLASS`, `BASKETBALL`, `RECEPTION`

### Reader type options

**`wiegand`**
```jsonc
{ "d0Pin": 17, "d1Pin": 18, "bitFormat": 26 }
```

**`serial`** (RS-485 or USB barcode/QR scanner)
```jsonc
{ "path": "/dev/ttyUSB0", "baudRate": 9600, "delimiter": "\n", "format": "ascii" }
// format: "hex" | "decimal" | "ascii"
// ascii strips common prefixes: CARD:, UID:, ID:, TAG:
```

**`tcp`** (ZKTeco F18, MA300, or generic networked reader)
```jsonc
{ "host": "192.168.1.101", "port": 4370, "protocol": "zkteco", "reconnectMs": 5000 }
// protocol: "zkteco" | "raw"
```

**`mock`** (dev / testing — no hardware needed)
```jsonc
{ "intervalMs": 8000, "cards": ["AABBCCDD", "11223344"] }
```

---

## 8. Hardware Wiring Reference

### Wiegand RFID reader → Raspberry Pi

```
Reader wire   →  RPi physical pin  (BCM)
─────────────────────────────────────────
VCC  (red)    →  Pin 2 or 4         (5V)
GND  (black)  →  Pin 6              (GND)
D0   (green)  →  Pin 11             (GPIO 17)
D1   (white)  →  Pin 12             (GPIO 18)

Add 1 kΩ pull-up resistors on D0/D1 if the reader has no built-in pull-ups.
```

### Relay module (active-HIGH) → Raspberry Pi

```
Relay terminal  →  RPi physical pin  (BCM)
──────────────────────────────────────────
VCC             →  Pin 2             (5V)
GND             →  Pin 6             (GND)
IN1             →  Pin 15            (GPIO 22)   ← main entrance
IN2             →  Pin 16            (GPIO 23)   ← second door (if any)
```

### LED indicators

```
Green LED: RPi GPIO 25 (pin 22) → 330 Ω resistor → LED+ → LED− → GND
Red LED:   RPi GPIO 26 (pin 37) → 330 Ω resistor → LED+ → LED− → GND
```

### Buzzer (active or passive)

```
Active buzzer: RPi GPIO 24 (pin 18) → buzzer+ (buzzer− → GND)
Passive buzzer: same, but drive via NPN transistor (e.g. 2N2222) base → GPIO, collector → buzzer+, emitter → GND
```

---

## 9. Production Deployment

### VPS — API server + worker

```bash
# 1. Build everything
pnpm -r build

# 2. Copy and fill in .env on the VPS
cp .env.example .env
nano .env

# 3. Start with PM2
pm2 start infra/pm2/ecosystem.config.cjs --env production \
  --only edge-gym-api,edge-gym-worker
pm2 save
pm2 startup   # follow the printed command to enable auto-start on reboot

# 4. Verify
curl https://api.yourdomain.com/api/v1/health
```

### Web Admin — build and serve static files

```bash
cd apps/web-admin
pnpm build        # output in dist/

# Serve with Nginx, Caddy, or any static host.
# Example Nginx location block:
#   root /var/www/gym-admin/dist;
#   try_files $uri $uri/ /index.html;
```

### Branch device — Edge service + Hardware adapter

Run these steps **on each Raspberry Pi / mini PC** at each branch:

```bash
# 1. Install Node 18 and pnpm on the device
curl -fsSL https://fnm.vercel.app/install | bash
fnm install 18
npm install -g pnpm@9 pm2

# 2. Clone or rsync the built dist/ to the device
#    (or build on the device if you have Node there)

# 3. Configure the edge service
export EDGE_DEVICE_ID=branch1-edge-01
export EDGE_BRANCH_ID=branch_001
export EDGE_PORT=8091
export EDGE_SYNC_BASE_URL=https://api.yourdomain.com/api/v1/edge
export EDGE_SHARED_SECRET=<same value as in VPS .env>

# Register the device (one-time)
curl -X POST https://api.yourdomain.com/api/v1/edge/register \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"branch1-edge-01","branchId":"branch_001"}'

# 4. Configure the hardware adapter
cd apps/hardware-adapter
cp .env.example .env
cp readers.config.example.json readers.config.json
nano readers.config.json     # edit for your wiring

# 5. Start both via PM2
pm2 start ../../infra/pm2/ecosystem.config.cjs --env production \
  --only edge-service-branch1,hardware-adapter-branch1
pm2 save
pm2 startup
```

### FRP tunnel (branch → VPS)

If the branch device is behind NAT, set up FRP so the VPS can reach the edge service:

```bash
# On VPS: frps already running (see infra/frp/)
# On branch device:
cp infra/frp/frpc.ini.example /etc/frp/frpc.ini
nano /etc/frp/frpc.ini       # set server_addr, token, local_port=8091
frpc -c /etc/frp/frpc.ini
```

### Member App — publish to Expo / build APK

```bash
cd apps/member-app

# Development build (Expo Go)
npx expo start

# Production APK (Android)
eas build --platform android --profile production

# Production IPA (iOS, Mac only)
eas build --platform ios --profile production
```

---

## 10. Running Tests

```bash
# All suites across the monorepo
pnpm test

# Individual suites
pnpm --filter @edge-gym/access-engine test   # Jest — 10 engine unit tests
pnpm --filter @edge-gym/api-server    test   # Vitest — sync contract, RBAC, payment flow
pnpm --filter @edge-gym/edge-service  test   # Vitest — edge DB, decision, sync failure
pnpm --filter @edge-gym/hardware-adapter test # Vitest — Wiegand parser, controller logic
```

---

## 11. PM2 Process Reference

| Process name | Script | Runs on | Port |
|---|---|---|---|
| `edge-gym-api` | `apps/api-server/dist/index.js` | VPS | 3000 |
| `edge-gym-worker` | `apps/api-server/dist/worker/index.js` | VPS | — |
| `edge-service-branch1` | `apps/edge-service/dist/index.js` | branch RPi | 8091 |
| `hardware-adapter-branch1` | `apps/hardware-adapter/dist/index.js` | branch RPi | 8092 (health) |

Add a pair of `edge-service-branchN` + `hardware-adapter-branchN` entries in `infra/pm2/ecosystem.config.cjs` for each additional branch.

```bash
# Useful PM2 commands
pm2 list                                  # status of all processes
pm2 logs edge-service-branch1 --lines 50  # tail logs
pm2 restart hardware-adapter-branch1      # restart one process
pm2 reload ecosystem.config.cjs          # zero-downtime reload all
```

---

## 12. Health Endpoints

| Service | URL | What it checks |
|---|---|---|
| API server | `GET /api/v1/health` | MongoDB ping latency, process uptime |
| API metrics | `GET /api/v1/metrics` | Heap memory, MongoDB state |
| Edge service | `GET http://localhost:8091/health` | Device ID, uptime |
| Edge sync | `GET http://localhost:8091/sync/status` | Last sync time, pending events |
| Hardware adapter | `GET http://localhost:8092/health` | Adapter uptime, configured readers |

---

## 13. Adding a New Branch

1. **Register the branch** — POST `/api/v1/branches` (owner JWT required)
2. **Register the device** — POST `/api/v1/edge/register` with `deviceId` + `branchId`
3. **Set up the branch device** (steps in §9 above)
4. **Add PM2 entries** — duplicate the two branch blocks in `ecosystem.config.cjs`, increment the branch number and port
5. **Add FRP tunnel entry** — add a new `[branch2]` block in `frpc.ini` with the new local port
6. **Reload PM2** — `pm2 reload ecosystem.config.cjs`

---

## 14. Known Gaps

See **§12 of PROJECT_STATUS.md** for the full list. Critical items:

- **No MemberPlan CRUD API** — plans must be seeded directly in MongoDB
- **`activeUntil` bug in edge pull** — set to `createdAt` instead of membership `endDate`; edge time-window rule uses wrong date
- **`POLICY_VERSION` never increments** — edge device won't re-pull on member data changes until this is fixed
- **No rate limiting** — add `@fastify/rate-limit` before going to production

---

## 15. Tech Stack Summary

| Layer | Technology |
|---|---|
| Language | TypeScript 5.4, strict, ESM |
| API framework | Fastify v4 |
| Central DB | MongoDB 6 via Mongoose 8 |
| Edge DB | SQLite via better-sqlite3 (WAL) |
| Auth | Firebase Auth (Google Sign-In) + short-lived JWT |
| Push notifications | Firebase Cloud Messaging (FCM) |
| Web admin | React 18 + Vite + TanStack Query v5 + Zustand + Tailwind CSS |
| Member app | Expo SDK 51 + Expo Router + React Native |
| Hardware GPIO | `onoff` v6 (RPi GPIO) |
| Serial readers | `serialport` v12 |
| Package manager | pnpm 9 workspaces |
| Process manager | PM2 |
| Tunnel | FRP (branch → VPS) |
| Testing | Vitest 1.6 (API, edge, hardware), Jest 29 (access engine) |
