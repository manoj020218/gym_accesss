# EDGE-PC — Gap Analysis (Updated 2026-05-18)

---

## Architecture

```
Wiegand reader / RFID card
    │  Wiegand26/34 signal
    ▼
Edge-Bridge-Mini-C3 (ESP32 hardware)
    │  MQTT  {topicBase}/attendance  {type:"attendance",card_id:"8-12345"}
    ▼
Local Mosquitto broker (192.168.1.x:1883)
    │                    │
    │  subscribed        │  subscribed
    ▼                    ▼
BridgeMqttListener    MqttAttendanceListener   ← already in mqtt/client.ts
(Wiegand card swipes)  (U5 face/card via MQTT)
    │                    │
    ▼                    ▼
decide() — access engine (blocklist, plan, time windows, anti-passback)
    │
    ▼
SQLite event queue  ─→  push to VPS every 30s
    │
    ▼  (also)
U5Adapter.getAttendanceLogs()  ← polled every 30s from sync/worker.ts

U5 machine (192.168.1.92)
 - triggers its OWN relay for face/card scans ← hardware handles this, NOT software
 - /openDoor HTTP endpoint (if firmware supports) ← for desktop operator manual unlock
```

---

## What is Done ✅

| Component | File | Notes |
|---|---|---|
| U5 Adapter | `edge-service/src/hardware/u5/index.ts` | enrollFace, getEmployeeList, getAttendanceLogs, deleteEmployee, openDoor, ping, onboard |
| Access Decision Engine | `edge-service/src/access/decision.ts` | 5-rule engine, RFID/QR/face, blocklist, anti-passback, time windows |
| SQLite Schema + DB | `edge-service/src/db/` | members, staff, policies, blocklist, events queue, sync_state, device_config |
| U5 MQTT Listener | `edge-service/src/mqtt/client.ts` | U5 face/card scan events → SQLite via MQTT |
| **Bridge MQTT Listener** ✅ NEW | `edge-service/src/mqtt/client.ts` | Wiegand card swipes → decide() → SQLite. Handles "8-12345" and "12345" card formats |
| Sync Worker | `edge-service/src/sync/worker.ts` | pull (VPS→SQLite), push (events→VPS), heartbeat, U5 attendance poll |
| **Employee JSON Backup** ✅ NEW | `edge-service/src/sync/worker.ts` | Written to `EMPLOYEE_BACKUP_DIR/{deviceSn}/employees_YYYYMMDD.json` after each face sync |
| Face File Server | `edge-service/src/index.ts` | Serves JPEG faces by memberCode. VPS stores URL reference only |
| **Door Unlock Endpoint** ✅ NEW | `edge-service/src/index.ts` | `POST /machines/u5/open-door` — operator manual guest unlock |
| **Machine Status Endpoint** ✅ NEW | `edge-service/src/index.ts` | `GET /machines/u5/status` — online check + device info for desktop dashboard |
| **FRPC Auto-Spawn** ✅ NEW | `edge-service/src/index.ts` | Writes frpc.toml + spawns frpc binary if FRPC_* env vars set |
| Config (Zod) | `edge-service/src/config.ts` | All env vars, Bridge MQTT, FRPC all added |
| Hardware Adapter | `hardware-adapter/src/` | Wiegand/serial/TCP reader bridge, relay/LED/buzzer (for future custom integrations) |

---

## GAP 9 — Relay (CORRECTED understanding)

**Wrong understanding before:** Edge-PC software triggers a relay pin.  
**Correct:** The U5 machine triggers its own built-in relay for every face/card scan. No software relay needed for normal operation.

**What IS needed (desktop use case):**
- Operator sees a guest/visitor at the door
- Clicks "Open Door" in desktop UI
- UI calls `POST /machines/u5/open-door` on the local edge service
- Edge service calls `/openDoor` on U5 machine HTTP API
- Machine triggers its relay → door opens
- If machine firmware doesn't expose `/openDoor`: UI shows "Machine does not support remote open — ask operator to press the physical button"

This is implemented. See `U5Adapter.openDoor()` and `/machines/u5/open-door` endpoint.

---

## GAP 6 — Multi-Machine (SCOPED)

**Current scope:** Single U5 machine per edge PC instance (one `U5_MACHINE_IP`).  
**Coming soon:** Multi-machine support. Pattern from EDGEFOLIO project:
- Config changes to `MACHINES=[{type, ip, port, password, zone, deviceId}]` array
- Sync worker loops over each machine
- UI shows per-machine status with a "Coming Soon — Additional Machines" card for machines beyond the first

No code changes needed now. When multi-machine is built, only `config.ts` and `sync/worker.ts` need updating. The U5Adapter is already instantiable with any IP.

---

## GAP 5 — Bridge Hardware (DONE ✅)

Bridge hardware already exists: `D:\IOT Device\Salary_On\smart_salary\Bridge\edge-bridge-mini-c3`  
ESP32-C3 firmware reads Wiegand26/34, publishes to `{topicBase}/attendance` via MQTT.

**Integration:** `BridgeMqttListener` in `mqtt/client.ts` subscribes to `{BRIDGE_MQTT_TOPIC_BASE}/attendance`, normalizes card_id (handles both "8-12345" and "12345" formats), calls `decide()`, queues event.

**To connect a Bridge device:**
```env
BRIDGE_MQTT_BROKER_URL=mqtt://192.168.1.100:1883
BRIDGE_MQTT_TOPIC_BASE=gym/door1
```

---

## Still Pending (Next Phase)

### GAP 1 — Electron/Tauri Desktop Packaging
Wrap edge-service in an Electron shell so it:
- Shows a system tray icon (green=syncing, red=machine down, yellow=no VPS)
- Auto-launches on Windows boot
- Distributes as a one-click `.exe` / `.msi` installer
- Electron-builder for packaging; electron-updater for auto-updates

### GAP 2 — Local Admin UI
A React panel served by the edge-service (or inside Electron):
- Local login (simple username+password, no Firebase)
- Dashboard: today's punches, members currently in gym, machine online/offline
- Access Log: real-time event feed, allow/deny, member name
- **Open Door button**: calls `POST /machines/u5/open-door`
- Members: view enrolled members + their face status
- Machine settings: configure IP, password, test connection

### GAP 3 — Full Member Data in SQLite
Currently `local_members` stores access fields only (rfid, qr, status, active_until).  
For offline-first local UI: extend pull to include first_name, last_name, phone, photo_path.  
Needs VPS edge-sync route to return these extra fields.

### GAP 7 — Auto-Update
Check VPS endpoint `GET /edge-version` on startup. If newer version available:
- Electron: use `electron-updater` (handles delta updates automatically)
- Bare Node: download new zip, extract, restart via PM2

### GAP 8 — FRPC Config
FRPC spawning is coded. What's needed:
- VPS side: set up `frps` with `vhostHTTPPort` and matching `token`
- Each edge PC gets a unique subdomain: `edge-DEV-217C.smartgym.iotsoft.in`
- VPS then routes enrollment/face-sync calls through the tunnel

---

## Minimum .env to Run (with U5 + Bridge)

```env
NODE_ENV=production
EDGE_DEVICE_ID=DEV-217C-MP83PUF8
EDGE_BRANCH_ID=6a070f427e6ea80192d2217c
EDGE_SYNC_BASE_URL=https://smartgym.iotsoft.in/api/v1/edge
EDGE_SHARED_SECRET=<from VPS .env>
EDGE_PORT=8090

# U5 machine
U5_MACHINE_IP=192.168.1.92
U5_MACHINE_PASSWORD=123456

# Storage
FACE_STORAGE_DIR=./storage/faces
EMPLOYEE_BACKUP_DIR=./storage/employees

# Bridge MQTT (only if Wiegand bridge is connected)
BRIDGE_MQTT_BROKER_URL=mqtt://127.0.0.1:1883
BRIDGE_MQTT_TOPIC_BASE=gym/door1

# FRPC tunnel (only if VPS-initiated enrollments needed)
# FRPC_BINARY=C:\frp\frpc.exe
# FRPC_SERVER_ADDR=154.61.69.200
# FRPC_TOKEN=<frps token>
# FRPC_SUBDOMAIN=edge-dev217c
```
