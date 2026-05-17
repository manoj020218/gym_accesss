# EDGE-PC — Gap Analysis
**Date:** 2026-05-17  
**Reference commit:** `d730a29` (2026-05-15 — last complete state)

---

## What Already Exists (in `apps/edge-service/`)

The core engine is fully built and working at the May-15 commit.

| Component | File | Status |
|---|---|---|
| **U5 Adapter** | `src/hardware/u5/index.ts` | ✅ Complete — enrollFace, getEmployeeList, getAttendanceLogs, deleteEmployee, onboard, ping, serverSetting |
| **Access Decision Engine** | `src/access/decision.ts` | ✅ Complete — 5-rule engine, RFID/QR/face, anti-passback, zone check |
| **SQLite Schema** | `src/db/schema.ts` | ✅ Complete — members, staff, policies, blocklist, events queue, sync_state |
| **Sync Worker** | `src/sync/worker.ts` | ✅ Complete — pull (VPS → SQLite), push (events → VPS), heartbeat, U5 attendance poll, face sync |
| **MQTT Listener** | `src/mqtt/client.ts` | ✅ Built — listens for live machine push events |
| **Face File Server** | `src/index.ts` `/faces/*` routes | ✅ Complete — serves JPEG faces by memberCode/filename |
| **Fastify HTTP server** | `src/index.ts` | ✅ Running — `/access/decide`, `/enroll-face`, `/u5/employees`, `/sync-faces`, `/health` |
| **Config (Zod)** | `src/config.ts` | ✅ Complete — all env vars validated on startup |
| **FRPC template** | `infra/frp/frpc.ini.example` | ✅ Template exists |

**The sync loop (`startSyncWorker`) already does:**
- Every 30 s: poll U5 machine → import attendance → push events to VPS → pull members/policies from VPS
- Every 60 s: heartbeat to VPS (registers edgeServiceIp so VPS knows where to forward enroll requests)
- On startup: immediate pull + heartbeat

---

## Root Cause — Why Access Monitor Shows Nothing

The VPS's `POST /access-devices/:code/sync-attendance` tries to reach `192.168.x.x` directly from the internet.  
That fails with **503** because the VPS is not on the gym's LAN.

**Fix:** Run `apps/edge-service` on any PC on the same LAN as the U5 machine.  
`syncU5Attendance()` in the sync worker already does exactly this poll — it just needs to be running.

---

## What is Missing (Gaps to Build)

### GAP 1 — Packaging: Electron or Tauri desktop app
**Note says:** "use Electron or Tauri so no cost should be to developer"  
**Current state:** `edge-service` is a plain Node.js process, run via `npm start` or PM2. No installer, no system tray, no auto-launch on Windows boot.  
**What to build:**
- Wrap edge-service in Electron (simpler) or Tauri (lighter, Rust)
- System tray icon: green = syncing, red = machine unreachable, yellow = no VPS
- Auto-launch on Windows startup (registry key or startup folder)
- One-click `.exe` / `.msi` installer (electron-builder or Tauri bundler)
- No additional cost — both are free/open-source

---

### GAP 2 — Local Admin UI (offline-first web panel)
**Note says:** "local admin or owner or role-based login system — even no VPS, all can work fully independent"  
**Current state:** Web admin (`apps/web-admin`) is designed for VPS + internet. No local UI exists.  
**What to build:**
- A local React panel served by the edge-service Fastify server (or Electron shell)
- Routes needed:
  - Login (local JWT, no Firebase — simple username+password stored in SQLite)
  - Dashboard: today's punches, members in gym now, machine status
  - Members: view/add/edit (local SQLite, offline)
  - Access Log: today's events, who entered, allow/deny
  - Machine Management: configure U5 IP, test connection, sync employees
  - Employee folder: view/export the employee JSON backup
- Role-based: Owner sees everything; Staff sees only access log and member check-in

---

### GAP 3 — Local SQLite for Full Member Data (not just access cache)
**Note says:** "even no VPS, all can work fully independent"  
**Current state:** SQLite schema has `local_members` with only access fields (rfid, qr, status, active_until). No name, photo, membership plan details, payments.  
**What to build:**
- Extend `local_members` table: add `first_name`, `last_name`, `phone`, `email`, `photo_path`
- Add `local_memberships` table: plan name, start_date, end_date, amount
- Add `local_payments` table: amount, date, method
- VPS `pull` response already sends member data — extend it to include these fields
- If VPS unavailable: seed from last-pulled data or from employee JSON backup files

---

### GAP 4 — Employee JSON Backup Folder
**Note says:** "save employee detail in employee folder with employee JSON — all employee detail backup here only"  
**Current state:** Face photos are saved to `./storage/faces/{memberCode}/{userId}_{date}.jpg` ✅  
But no JSON backup of the employee list exists.  
**What to build:**
- After each `getEmployeeList` from machine: write `./storage/employees/{deviceSn}/employees_{date}.json`
- Format: `[{ userId, name, id_number, accessCardNumber, hasFace, pic_large_path }]`
- Also write `./storage/employees/members_{date}.json` — local member records snapshot
- This is the "airgap backup" — if VPS is deleted, gym still has all data

---

### GAP 5 — Hardware Bridge (Wiegand / USB / Serial readers)
**Note says:** "add any type of machine in LAN or using Bridge Hardware to bring them LAN if they are working on Wiegand or USB"  
**Current state:** `apps/hardware-adapter/` exists in repo. U5 is TCP/HTTP. Wiegand/USB readers need a physical bridge (Pi + Wiegand reader board, or USB HID reader).  
**What to build:**
- Bridge reads card swipe → calls `POST /access/decide` on local edge-service → gets ALLOW/DENY → triggers relay
- The decision engine already accepts `identifierType: 'rfid'` — just needs a reader feeding it
- For USB HID readers: a small Node.js `node-hid` listener in hardware-adapter
- For Wiegand: Pi GPIO reader → serial → bridge process

---

### GAP 6 — Multi-Machine Support
**Current state:** Config has a single `U5_MACHINE_IP`. Only one U5 machine per edge-service instance.  
**What to build:**
- `MACHINES` config: array of `{ type, ip, port, password, zone, deviceId }`
- Sync worker runs `syncU5Attendance` for each machine in parallel
- Each machine's events tagged with its `deviceId`
- Local admin UI shows per-machine status

---

### GAP 7 — Auto-Update / Version Control for Local Software
**Note says:** "Update and version control of local software"  
**Current state:** No update mechanism.  
**What to build:**
- Edge service checks a VPS endpoint `GET /edge-version` on each startup
- If newer version available: download `.exe` from VPS (or GitHub Releases), prompt user to update
- For Electron: `electron-updater` handles delta updates automatically
- For manual: show tray notification "Update available — click to install"

---

### GAP 8 — FRPC Tunnel Setup Automation
**Current state:** `infra/frp/frpc.ini.example` is a template. User must manually configure and run frpc.  
**What to build:**
- Edge-service reads `FRPC_SERVER`, `FRPC_TOKEN`, `FRPC_LOCAL_PORT` from `.env`
- On startup: auto-generates `frpc.ini` and spawns `frpc.exe` as a child process
- VPS then reaches `http://edge.yourdomain.com/enroll-face` instead of the LAN IP
- This allows VPS-triggered enrollments and real-time face sync without admin knowing frpc details

---

### GAP 9 — Offline Access Decision → Relay Trigger (RFID without U5)
**Current state:** `decide()` function returns `{ decision, triggerRelay }`. But nothing in index.ts actually triggers a physical relay.  
U5 handles its own relay for face scans. But for external RFID readers (not U5), the relay must be triggered by the edge PC.  
**What to build:**
- For USB relay board: `usb-relay` npm package or GPIO (Pi)
- For TCP relay: open a socket to the relay controller and send OPEN command
- Wire into the `/access/decide` handler: if `triggerRelay === true` → fire relay

---

## Priority Order to Get Punches Flowing Today

The fastest path to see events in Access Monitor:

1. **Copy `apps/edge-service/` to the gym LAN PC** (or run on any Windows/Linux PC on LAN)
2. **Create `.env`** (template below)
3. **Run `npm install && npm start`**
4. Within 30 seconds, U5 attendance will be polled and events pushed to VPS
5. Refresh Access Monitor → punches appear

### Minimum `.env` for the gym LAN PC:
```
NODE_ENV=production
EDGE_DEVICE_ID=DEV-217C-MP83PUF8
EDGE_BRANCH_ID=6a070f427e6ea80192d2217c
EDGE_SYNC_BASE_URL=https://smartgym.iotsoft.in/api/v1/edge
EDGE_SHARED_SECRET=<from VPS .env EDGE_SHARED_SECRET>
U5_MACHINE_IP=192.168.1.92
U5_MACHINE_PORT=80
U5_MACHINE_PASSWORD=123456
FACE_STORAGE_DIR=./storage/faces
EDGE_SQLITE_PATH=./data/edge.db
```

---

## Architecture Reminder

```
U5 Machine (192.168.1.92)
    │  HTTP poll every 30s
    ▼
EDGE-PC (this service, same LAN)
    │  decide + store in SQLite
    │  push events every 30s
    ▼
VPS API (smartgym.iotsoft.in)
    │  MongoDB, web admin
    ▼
Web Admin (browser)
    Access Monitor → shows punches ✅
```

The VPS never calls the machine directly. Only the edge PC does.
