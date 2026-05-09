# Project Q&A — EDGE Gym Access Control System

Common questions and answers about how the system works.
New answers are added here as questions come up.

---

## Q: New member aaya gym mein — usse system mein kaise add karein?

**Step-by-step full flow:**

---

### Step 1 — Member Profile banao (Web Admin Panel)

Admin Panel pe jao → Members → Add Member

Ye fields bhari jaati hain:

| Field | Required? | Notes |
|---|---|---|
| Branch | Yes | Konse gym branch ka member hai |
| First Name | Yes | |
| Last Name | Yes | |
| Phone | Yes | Login ke liye bhi use hoga |
| Email | No | |
| Date of Birth | No | |
| Emergency Contact | No | |
| Allowed Branches | No | Default: sirf apni branch |

**API ke andar kya hota hai:**
- `POST /members` call hoti hai
- Member ka unique code generate hota hai: `MEM123456` (timestamp based)
- Status hoti hai: `Pending` (abhi tak payment nahi hui)
- Access zone default: `main_entry` only
- `faceEnrolled: false`, `healthDeclarationSigned: false` set hota hai

---

### Step 2 — Membership assign karo (Plan + Payment)

Admin Panel → Members → [Member select karo] → Add Membership

| Field | Required? | Notes |
|---|---|---|
| Plan | Yes | Monthly / Quarterly / Yearly etc. |
| Start Date | Yes | |
| Payment Mode | Yes | Cash / UPI / Card |
| Amount Paid | Yes | |
| Discount | No | |

**API ke andar kya hota hai:**
- `POST /memberships` call hoti hai
- Plan ki duration se end date calculate hoti hai automatically
- Payment record banta hai with receipt number (`RCP...`)
- GST amount bhi calculate hoti hai
- Member ka status `Pending` → `Active` ho jaata hai

---

### Step 3 — Access Identifier set karo (RFID / QR / Face)

Member ko door open karne ke liye ek identifier chahiye. Teen options hain:

#### Option A — RFID Card
- Admin Panel → Member → Edit → RFID Card field mein card number enter karo
- API: `PUT /members/:id` with `{ rfidCardId: "CARD123" }`

#### Option B — QR Code (Member App)
- Admin Panel → Member → Generate QR Token
- API: `POST /members/:id/qr-token`
- Ek random secure token generate hota hai
- Member apni app mein ye QR code dikhata hai door pe

#### Option C — Face Recognition (U5 Machine)
- Face machine pe seedha face enroll karo (machine UI ya u5-monitor UI se)
- Phir Member record mein `faceEnrolled: true` update karo
- API: `PUT /members/:id` with `{ faceEnrolled: true }`

**Ek member ke paas teeno ho sakte hain ek saath.**

---

### Step 4 — Edge Device sync hoti hai (Automatic)

Gym location pe Edge Service chal raha hota hai. Wo automatically VPS se data pull karta hai:

- `GET /edge/pull?branchId=X` — ye call Edge Service karta hai VPS pe
- VPS us branch ke saare active members bhejta hai:
  - memberCode, rfidCardId, qrToken
  - status (active/blocked/frozen)
  - allowedZones
- Ye data local SQLite mein save hota hai Edge Device pe

**Internet nahi hai toh bhi kaam karta hai** — Edge Device ne jo data last sync mein liya tha, usi se decision leta hai.

---

### Step 5 — Member ab door pe aa sakta hai

- RFID swipe kare / QR dikhaye / Face scanner ke saamne aaye
- Edge Service local SQLite check karta hai:
  - Status `Active` hai?
  - Plan expire nahi hua?
  - Allowed zone hai?
  - Blocklist mein nahi hai?
- Allow → Relay/door open hota hai
- Deny → Door band rahta hai, reason log hota hai
- Event locally store hota hai
- Internet aane par event VPS ko sync hota hai (`POST /edge/push-events`)

---

### Step 6 — Member App (Optional)

- Member apni phone pe Member App install kare
- Login kare phone number se
- App FCM token register karti hai: `PUT /members/:id/fcm-token`
- Ab member ko milega:
  - QR Code for entry
  - Membership status
  - Renewal reminders
  - Payment history
  - Gym notifications

---

### Summary Flow Diagram

```
Receptionist / Admin
       ↓
  Web Admin Panel
       ↓
  POST /members          → Member profile create (status: Pending)
       ↓
  POST /memberships      → Plan assign + Payment record + status: Active
       ↓
  RFID / QR / Face       → Access identifier set karo
       ↓
  Edge Service (auto)
       ↓
  GET /edge/pull         → VPS se member data local SQLite mein
       ↓
  Member door pe aaya    → Local decision (offline capable)
       ↓
  POST /edge/push-events → Access log VPS ko sync
       ↓
  Owner App / Reports    → Attendance, Revenue, Alerts
```

---

### Common Mistakes / Watch Out

| Mistake | Fix |
|---|---|
| Membership add karna bhool gaye | Member status `Pending` rahega, door pe deny hoga |
| RFID / QR / Face set nahi kiya | Member ke paas koi identifier nahi, access nahi milega |
| Edge Service internet pe nahi | Pull nahi hua, naya member edge pe nahi gaya — wait karo ya manual restart karo |
| Plan expire ho gaya | Member status `Expired`, door pe deny — renew karna hoga |
| Member block hai | Admin Panel se unblock karo: `POST /members/:id/unblock` |

---

*Last updated: 2026-05-09*
