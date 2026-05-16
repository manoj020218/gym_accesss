import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { createHmac, randomBytes, createHash } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { AccessEvent } from '../models/AccessEvent.js';
import { AccessDevice } from '../models/AccessDevice.js';
import { DeviceSetupLog } from '../models/DeviceSetupLog.js';
import { AccessDecision, Zone, SubjectType, StaffRole } from '@edge-gym/shared-types';
import { Member } from '../models/Member.js';
import { Staff }  from '../models/Staff.js';
import { ZkbioEmployee } from '../models/ZkbioEmployee.js';

const ListQuery = z.object({
  branchId:    z.string().optional(),
  memberId:    z.string().optional(),
  deviceId:    z.string().optional(),
  zone:        z.nativeEnum(Zone).optional(),
  decision:    z.nativeEnum(AccessDecision).optional(),
  subjectType: z.nativeEnum(SubjectType).optional(),
  from:        z.string().optional(),
  to:          z.string().optional(),
  page:        z.coerce.number().default(1),
  limit:       z.coerce.number().default(50),
});

const AttendanceQuery = z.object({
  from:  z.string().optional(),
  to:    z.string().optional(),
});

const accessRoutes: FastifyPluginAsync = async (fastify) => {

  // GET /access/events
  fastify.get('/access/events', async (req, reply) => {
    const q = ListQuery.parse(req.query);
    const filter: Record<string, unknown> = {};

    if (req.actor.role !== StaffRole.Owner) {
      filter['branchId'] = { $in: req.actor.branchIds };
    } else if (q.branchId) {
      filter['branchId'] = q.branchId;
    }

    if (q.memberId)    filter['subjectId']    = q.memberId;
    if (q.deviceId)    filter['edgeDeviceId'] = q.deviceId;
    if (q.zone)        filter['zone']         = q.zone;
    if (q.decision)    filter['decision']     = q.decision;
    if (q.subjectType) filter['subjectType']  = q.subjectType;

    if (q.from || q.to) {
      const timeFilter: Record<string, unknown> = {};
      if (q.from) timeFilter['$gte'] = new Date(q.from);
      if (q.to)   timeFilter['$lte'] = new Date(q.to);
      filter['eventTime'] = timeFilter;
    }

    const skip  = (q.page - 1) * q.limit;
    const total = await AccessEvent.countDocuments(filter);
    const data  = await AccessEvent.find(filter).skip(skip).limit(q.limit).sort({ eventTime: -1 });

    return reply.send({ data, total, page: q.page, limit: q.limit, pages: Math.ceil(total / q.limit) });
  });

  // POST /access/events/:eventId/link-to-member — link an unidentified visitor event to a member.
  // Works for both ZKBio (upserts ZkbioEmployee) and U5 (adds to member.machineUsers).
  // After linking, the event itself is updated so future attendance reports show the member.
  fastify.post<{ Params: { eventId: string }; Body: { memberId: string } }>(
    '/access/events/:eventId/link-to-member',
    { schema: { body: {} } },
    async (req, reply) => {
      const { eventId } = req.params;
      const { memberId } = req.body ?? {} as { memberId: string };
      if (!memberId) return reply.status(400).send({ error: 'memberId required' });

      const [event, member] = await Promise.all([
        AccessEvent.findById(eventId),
        Member.findById(memberId),
      ]);
      if (!event)  return reply.status(404).send({ error: 'Event not found' });
      if (!member) return reply.status(404).send({ error: 'Member not found' });

      const machineUserId = event.subjectId; // may be raw machine integer ID
      const device = await AccessDevice.findById(event.edgeDeviceId);

      if (device) {
        const isZkbio = !!device.machineSn && device.make !== 'u5';
        const isU5    = device.make === 'u5' || (!device.make && !!device.ipAddress);

        if (isZkbio && device.machineSn) {
          // Upsert ZkbioEmployee and set memberId so future events match
          await ZkbioEmployee.updateOne(
            { deviceSn: device.machineSn, machineUserId },
            {
              $set: { memberId, name: `${member.firstName} ${member.lastName}`.slice(0, 24) },
              $setOnInsert: { deviceSn: device.machineSn, machineUserId, importedAt: new Date() },
            },
            { upsert: true },
          );
          await Member.findByIdAndUpdate(memberId, { $set: { faceEnrolled: true } });
        } else if (isU5) {
          await Member.findByIdAndUpdate(memberId, {
            $addToSet: { machineUsers: { deviceCode: device.deviceCode, machineUserId } },
          });
        }
      }

      // Re-attribute the event itself
      await AccessEvent.findByIdAndUpdate(eventId, {
        $set: { subjectId: memberId, subjectType: 'member', subjectName: `${member.firstName} ${member.lastName}` },
      });

      return reply.send({ ok: true });
    },
  );

  // GET /access/attendance/:memberId — aggregate check-in/out sessions from main_entry events
  fastify.get<{ Params: { memberId: string }; Querystring: z.infer<typeof AttendanceQuery> }>(
    '/access/attendance/:memberId',
    async (req, reply) => {
      const q = AttendanceQuery.parse(req.query);
      const filter: Record<string, unknown> = {
        subjectId: req.params.memberId,
        decision:  AccessDecision.Allow,
      };

      if (q.from || q.to) {
        const timeFilter: Record<string, unknown> = {};
        if (q.from) timeFilter['$gte'] = new Date(q.from);
        if (q.to)   timeFilter['$lte'] = new Date(q.to);
        filter['eventTime'] = timeFilter;
      }

      const events = await AccessEvent.find(filter).sort({ eventTime: 1 }).lean();

      // Each main_entry allow event starts a new visit session
      const sessions: Array<{
        checkIn: Date;
        checkOut?: Date;
        durationMinutes?: number;
        zone: string;
      }> = [];

      let current: { checkIn: Date; zone: string } | null = null;

      for (const ev of events) {
        if (ev.zone === Zone.MainEntry) {
          if (current) {
            const durationMinutes = Math.round(
              (ev.eventTime.getTime() - current.checkIn.getTime()) / 60_000,
            );
            sessions.push({ checkIn: current.checkIn, checkOut: ev.eventTime, durationMinutes, zone: current.zone });
          }
          current = { checkIn: ev.eventTime, zone: ev.zone };
        }
      }

      if (current) sessions.push({ checkIn: current.checkIn, zone: current.zone });

      return reply.send({
        memberId:    req.params.memberId,
        totalVisits: sessions.length,
        sessions,
      });
    },
  );
  // POST /access-devices — admin registers a new edge device for a branch
  fastify.post<{ Body: { branchId: string; name: string } }>('/access-devices', async (req, reply) => {
    const { branchId, name } = req.body as { branchId: string; name: string };
    if (!branchId || !name) return reply.status(400).send({ error: 'branchId and name required' });

    const deviceCode = `DEV-${branchId.slice(-4).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
    const secret     = `sk_edge_${randomBytes(12).toString('hex')}`;
    const secretHash = createHmac('sha256', secret).update(deviceCode).digest('hex');

    const device = await AccessDevice.create({
      deviceCode, name, branchId,
      zone: 'main_entry', type: 'rfid', protocol: 'tcp_ip',
      secretKeyHash: secretHash, relayEnabled: true, antiPassback: 'disabled',
      isActive: true, registeredAt: new Date(),
    });

    return reply.status(201).send({ deviceId: device.id, deviceCode, secret });
  });

  // GET /access-devices — list devices; if heartbeat is stale, ping machine directly before declaring offline
  fastify.get('/access-devices', async (req, reply) => {
    const { branchId } = req.query as { branchId?: string };
    const filter: Record<string, unknown> = { isActive: true };

    if (req.actor.role !== StaffRole.Owner) {
      filter['branchId'] = { $in: req.actor.branchIds };
    } else if (branchId) {
      filter['branchId'] = branchId;
    }

    const devices = await AccessDevice.find(filter).lean();
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);

    const results = await Promise.all(devices.map(async (d) => {
      let isOnline = !!(d.lastHeartbeatAt && d.lastHeartbeatAt > fiveMinAgo);

      // For ZKBio/cloud machines the IP is a public ISP address — don't try to ping it
      // from the VPS (unreachable). Heartbeat from the ZKBio polling cycle is the only signal.
      const isCloudMachine = d.make === 'zkteco';

      if (!isOnline && d.ipAddress && !isCloudMachine) {
        try {
          const r = await fetch(`http://${d.ipAddress}:${d.port ?? 80}/`, {
            signal: AbortSignal.timeout(2000),
          });
          isOnline = r.ok || r.status < 500;
          if (isOnline) {
            void AccessDevice.findByIdAndUpdate(d._id, { lastHeartbeatAt: new Date() });
          }
        } catch { /* machine not reachable */ }
      }

      return {
        _id:              d._id,
        deviceId:         d.deviceCode,
        name:             d.name,
        branchId:         d.branchId,
        zone:             d.zone,
        type:             d.type,
        make:             d.make,
        isOnline,
        lastHeartbeat:    d.lastHeartbeatAt?.toISOString(),
        ipAddress:        d.ipAddress,
        port:             d.port,
        machineSn:        d.machineSn,
        localIp:          d.localIp,
        mqttLiveEnabled:  d.mqttLiveEnabled,
        mqttBrokerUrl:    d.mqttBrokerUrl,
        mqttInfoTopic:    d.mqttInfoTopic,
        mqttConnected:    d.mqttConnected,
        pendingEventCount: 0,
        createdAt:        d.createdAt.toISOString(),
      };
    }));

    return reply.send(results);
  });

  // POST /access-devices/:deviceCode/ping — quick reachability check, marks device online if any HTTP response
  fastify.post<{ Params: { deviceCode: string }; Body: { deviceIp: string; devicePort?: number; machinePassword?: string } }>(
    '/access-devices/:deviceCode/ping',
    async (req, reply) => {
      const { deviceCode } = req.params;
      const { deviceIp, devicePort, machinePassword } = req.body as { deviceIp: string; devicePort?: number; machinePassword?: string };

      if (!deviceIp) return reply.status(400).send({ error: 'deviceIp required' });

      const device = await AccessDevice.findOne({ deviceCode });
      if (!device) return reply.status(404).send({ error: 'Device not found' });

      const port = devicePort ?? device.port ?? 80;

      // Try specified port first, then common ports
      const portsToTry = [port, 80, 8090, 8080].filter((v, i, a) => a.indexOf(v) === i);
      let foundPort: number | null = null;
      let deviceId: string | undefined;

      for (const p of portsToTry) {
        try {
          const res = await fetch(`http://${deviceIp}:${p}/health`, { signal: AbortSignal.timeout(3000) });
          if (res.ok) {
            const body = await res.json().catch(() => ({})) as { deviceId?: string };
            deviceId = body.deviceId;
            foundPort = p;
            break;
          }
        } catch { /* try next */ }

        try {
          await fetch(`http://${deviceIp}:${p}/`, { signal: AbortSignal.timeout(2000) });
          foundPort = p;
          break;
        } catch { /* try next */ }
      }

      if (foundPort === null) {
        return reply.status(503).send({
          error: 'Device not reachable',
          hint:  `Nothing responded at ${deviceIp} on ports ${portsToTry.join(', ')}. Check power and network.`,
        });
      }

      const update: Record<string, unknown> = { ipAddress: deviceIp, port: foundPort, lastHeartbeatAt: new Date() };
      if (machinePassword) update['machinePassword'] = machinePassword;

      await AccessDevice.findOneAndUpdate({ deviceCode }, update);

      await DeviceSetupLog.create({
        sessionId:      `ping_${Date.now().toString(36)}`,
        branchId:       device.branchId,
        deviceCode,
        step:           'PING_SUCCESS',
        confirmedValue: deviceId ?? deviceIp,
        metadata:       { deviceIp, foundPort, deviceId, hasPassword: !!machinePassword },
        adminIp:        req.ip,
      });

      return reply.send({ ok: true, deviceIp, foundPort, deviceId });
    },
  );

  // GET /access-devices/:deviceId/u5-employees — proxy getEmployeeList from U5 machine
  // Device is looked up by our deviceCode; machine is contacted via its IP + port + password.
  // The machine returns its own internal integer keys as "userid"/"userId" (u5UserId here),
  // NOT our MongoDB _id. id_number = our memberCode.
  fastify.get<{ Params: { deviceId: string } }>(
    '/access-devices/:deviceId/u5-employees',
    async (req, reply) => {
      const device = await AccessDevice.findOne({ deviceCode: req.params.deviceId, isActive: true });
      if (!device?.ipAddress) {
        return reply.status(404).send({ error: 'Device not found or no IP stored' });
      }

      // Machine connection — identified by machineSn/IP, NOT MongoDB _id
      const machineUrl     = `http://${device.ipAddress}:${device.port ?? 80}`;
      const machinePasswd  = device.machinePassword ?? '123456';

      type RawEmployee = {
        userid?:              string | number; // machine's internal auto-increment key (u5UserId)
        userId?:              string | number; // some firmware versions use uppercase i
        name:                 string;
        id_number?:           string;  // = our memberCode
        access_card_number?:  string;  // RFID / NFC card number (may be "0" for none)
        pic_large?:           string;  // base64 photo — present for card-only users too
      };

      try {
        const res = await fetch(`${machineUrl}/getEmployeeList`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ password: machinePasswd }),
          signal:  AbortSignal.timeout(10_000),
        });

        if (!res.ok) return reply.status(502).send({ error: `Machine responded with HTTP ${res.status}` });

        const raw  = await res.text();
        req.log.info({ endpoint: '/getEmployeeList', machineSn: device.machineSn, machineUrl, raw }, '[u5] getEmployeeList response');
        const data = JSON.parse(raw) as { data?: RawEmployee[] };
        const employees = (data.data ?? []).map(e => {
          const cardNo = e.access_card_number && e.access_card_number !== '0' ? e.access_card_number : undefined;
          const hasFace = !!(e.pic_large && e.pic_large.length > 10);
          return {
            u5UserId:  String(e.userid ?? e.userId ?? ''),
            name:      e.name,
            id_number: e.id_number ?? undefined,
            accessCardNumber: cardNo,
            hasFace,
          };
        });
        return reply.send({ employees });
      } catch (err) {
        const isTimeout = err instanceof Error && err.name === 'TimeoutError';
        return reply.status(503).send({ error: isTimeout ? 'Machine timed out' : 'Cannot reach machine' });
      }
    },
  );

  // POST /access-devices/:deviceId/u5-employees/:userId/link — link a U5 machine employee to a Member
  // Sets rfidCardId if the employee has a card; marks faceEnrolled if the employee has a face photo.
  fastify.post<{ Params: { deviceId: string; userId: string }; Body: { memberId: string | null; accessCardNumber?: string; hasFace?: boolean } }>(
    '/access-devices/:deviceId/u5-employees/:userId/link',
    { schema: { body: {} } },
    async (req, reply) => {
      const { deviceId, userId } = req.params;
      const { memberId, accessCardNumber, hasFace } = req.body ?? {} as { memberId: string | null; accessCardNumber?: string; hasFace?: boolean };

      if (memberId) {
        const updates: Record<string, unknown> = {};
        if (accessCardNumber) updates.rfidCardId  = accessCardNumber;
        if (hasFace)          updates.faceEnrolled = true;

        await Member.findByIdAndUpdate(memberId, {
          $set:     updates,
          $addToSet: { machineUsers: { deviceCode: deviceId, machineUserId: userId } },
        });
      } else {
        // Unlink: remove this machine user entry from whichever member has it
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (Member as any).updateOne(
          { 'machineUsers.deviceCode': deviceId, 'machineUsers.machineUserId': userId },
          { $pull: { machineUsers: { deviceCode: deviceId, machineUserId: userId } } },
        );
      }

      return reply.send({ ok: true });
    },
  );

  // POST /access-devices/:deviceCode/sync-attendance — pull U5 attendance logs directly into MongoDB
  //
  // Matching strategy (two-step):
  //   Step 1 — call getEmployeeList to build { u5UserId → id_number (= memberCode) } map.
  //            This only covers CURRENTLY enrolled employees.
  //   Step 2 — call getWorkNoteList for punch records. For each punch:
  //            a) look up punch.userid in the map → get id_number → find Member by memberCode  (reliable)
  //            b) if not in map (employee was deleted after punching in) → fall back to name match  (best-effort)
  //            c) neither → store as unmatched ghost record
  //
  // Note: deleted employees keep their old punch records forever with the old userid.
  //       Re-enrolling the same person always creates a NEW userid, so old punches are
  //       permanently orphaned from the employee list — name is the only fallback.
  //
  // Deduplication: machine can return duplicate pages (firmware quirk observed in testing).
  //   Key: deviceCode + u5UserId + checkin_time — deduplicated before processing.
  fastify.post<{ Params: { deviceCode: string } }>(
  '/access-devices/:deviceCode/sync-attendance',
  async (req, reply) => {
    const device = await AccessDevice.findOne({ deviceCode: req.params.deviceCode, isActive: true });
    if (!device?.ipAddress) {
      return reply.status(404).send({ error: 'Device not found or no IP configured' });
    }

    // Machine connection — IP/port/password from AccessDevice doc; machineSn for log correlation
    const machineUrl = `http://${device.ipAddress}:${device.port ?? 80}`;
    const password   = device.machinePassword ?? '123456';

    type RawEmployee = {
      userid?:    string | number;
      userId?:    string | number;
      name:       string;
      id_number?: string; // = our memberCode, only present on current enrollments
    };

    type WorkNote = {
      userid?:      string | number; // machine's internal key per enrollment (NOT MongoDB _id)
      userId?:      string | number; // firmware variant
      checkin_time: string;
      ispass?:      number;
      pic_large?:   string;          // machine sends pic_large (not pic)
      temp?:        string;
    };

    // ── Step 1: build u5UserId → memberCode map from current employee list ────
    // Records from deleted employees will NOT be in this map — handled by name fallback below.
    const u5ToMemberCode = new Map<string, string>();
    try {
      const er = await fetch(`${machineUrl}/getEmployeeList`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
        signal: AbortSignal.timeout(10_000),
      });
      if (er.ok) {
        const ed = JSON.parse(await er.text()) as { data?: RawEmployee[] };
        for (const emp of ed.data ?? []) {
          const uid = String(emp.userid ?? emp.userId ?? '');
          if (uid && emp.id_number) u5ToMemberCode.set(uid, emp.id_number);
        }
        req.log.info({ machineSn: device.machineSn, mapped: u5ToMemberCode.size }, '[u5] employee map built');
      }
    } catch {
      // Non-fatal — fall through to name-only matching
      req.log.warn({ machineSn: device.machineSn }, '[u5] getEmployeeList failed, will use name fallback only');
    }

    // ── Step 2: fetch all punch pages, deduplicate ────────────────────────────
    const seen     = new Set<string>();
    let attRecords: WorkNote[] = [];
    try {
      let pageIndex = 0;
      let pageSum   = 1;
      const MAX_PAGES = 200;
      do {
        const r = await fetch(`${machineUrl}/getWorkNoteList`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password, type: 2, index: pageIndex }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!r.ok) return reply.status(502).send({ error: `Machine HTTP ${r.status}` });

        const raw = await r.text();
        req.log.info({ endpoint: '/getWorkNoteList', type: 2, page: pageIndex, machineSn: device.machineSn }, '[u5] attendance page received');

        const d = JSON.parse(raw) as { code?: number; page_sum?: number; data?: WorkNote[] };
        if (d.code !== undefined && d.code !== 200) {
          return reply.status(502).send({ error: `Machine error code ${d.code}` });
        }
        pageSum = d.page_sum ?? 1;

        for (const rec of d.data ?? []) {
          const uid = String(rec.userid ?? rec.userId ?? '');
          const key = `${uid}::${rec.checkin_time}`;
          if (!seen.has(key)) { seen.add(key); attRecords.push(rec); }
        }

        pageIndex++;
        // Give Mongoose/6.18 single-connection server time to recover between requests
        if (pageIndex < pageSum && pageIndex < MAX_PAGES) {
          await new Promise<void>(resolve => setTimeout(resolve, 600));
        }
      } while (pageIndex < pageSum && pageIndex < MAX_PAGES);
    } catch (e) {
      return reply.status(503).send({ error: 'Cannot reach machine', hint: `${machineUrl} — ${(e as Error).message}` });
    }

    req.log.info({ machineSn: device.machineSn, total: attRecords.length }, '[u5] attendance records after dedup');

    if (attRecords.length === 0) return reply.send({ imported: 0, total: 0, records: [] });

    // ── Step 3: resolve members and upsert AccessEvents ──────────────────────
    type SyncRecord = {
      subjectName?: string;
      eventTime:    string;
      faceUrl?:     string; // edge storage URL for matched members
      pic?:         string; // inline base64 only for unmatched faces (no edge storage)
      isNew:        boolean;
      matched:      boolean;
      ispass:       number;
    };
    const results: SyncRecord[] = [];
    let imported = 0;

    for (const rec of attRecords) {
      const eventTime = new Date(rec.checkin_time);
      if (isNaN(eventTime.getTime())) continue;

      // u5UserId = machine's immutable key for this specific enrollment.
      // Each enrollment (even same person re-enrolled after deletion) gets a brand-new u5UserId.
      const u5UserId = String(rec.userid ?? rec.userId ?? '');

      let member = null;
      let staffSubject = null;

      // 3a. Primary: map lookup → id_number → Member (covers active enrollments)
      // Staff enroll-face stores staff._id as id_number, so check both.
      const idNumber = u5UserId ? u5ToMemberCode.get(u5UserId) : undefined;
      if (idNumber) {
        member = await Member.findOne({ memberCode: idNumber, branchId: device.branchId });
        if (!member) {
          staffSubject = await Staff.findOne({ _id: idNumber, branchId: device.branchId });
        }
      }

      // 3b. Fallback: machineUserId stored on the document (catches re-enrolled or deleted-then-re-added)
      if (!member && !staffSubject && u5UserId && u5UserId !== '-1') {
        member = await Member.findOne({ branchId: device.branchId, 'machineUsers.machineUserId': u5UserId });
        if (!member) {
          staffSubject = await Staff.findOne({ branchId: device.branchId, 'machineUsers.machineUserId': u5UserId });
        }
      }

      const subjectType = member ? 'member' : staffSubject ? 'staff' : 'unknown';
      const subjectId   = member ? member._id.toString() : staffSubject ? staffSubject._id.toString() : null;
      const subjectName = member
        ? `${member.firstName} ${member.lastName}`
        : staffSubject ? `${staffSubject.firstName} ${staffSubject.lastName}` : null;
      const decision    = rec.ispass === 0 ? 'DENY' : 'ALLOW';

      const seqHash = parseInt(
        createHash('md5')
          .update(`${device.deviceCode}:${u5UserId}:${eventTime.getTime()}`)
          .digest('hex')
          .slice(0, 10),
        16,
      );

      try {
        const res = await AccessEvent.findOneAndUpdate(
          { edgeDeviceId: device.deviceCode, eventTime, subjectId: subjectId ?? 'unknown' },
          {
            $setOnInsert: {
              edgeDeviceId:   device.deviceCode,
              branchId:       device.branchId,
              zone:           'main_entry',
              subjectType,
              subjectId,
              subjectName,
              decision,
              identifierUsed: 'face',
              localSeq:       -seqHash,
              eventTime,
              syncedAt:       new Date(),
            },
          },
          { upsert: true, rawResult: true },
        ) as unknown as { lastErrorObject?: { upserted?: unknown } };

        const isNew = !!(res?.lastErrorObject?.upserted);
        if (isNew) imported++;

        // Prefer edge storage URL for matched members (persistent, already synced).
        // Fall back to inline pic_large from the punch record when edge service
        // hasn't registered its IP yet (edge PC offline or first boot).
        let faceUrl: string | undefined;
        let facePic: string | undefined;
        if (member && device.edgeServiceIp && device.edgeServicePort) {
          faceUrl = `http://${device.edgeServiceIp}:${device.edgeServicePort}/faces/${member.memberCode}/latest`;
        } else if (rec.pic_large != null) {
          facePic = rec.pic_large;
        }

        results.push({
          ...(subjectName != null ? { subjectName } : {}),
          ...(faceUrl != null ? { faceUrl } : {}),
          ...(facePic != null ? { pic: facePic } : {}),
          eventTime: rec.checkin_time,
          isNew,
          matched: !!member,
          ispass:  rec.ispass ?? 1,
        });
      } catch {
        // duplicate key on concurrent call — safe to ignore
      }
    }

    void AccessDevice.findByIdAndUpdate(device._id, { lastHeartbeatAt: new Date() });
    return reply.send({ imported, total: attRecords.length, records: results });
  },
);

  // GET /access-devices/:deviceCode/sync-status — compare machine employees vs our enrolled members
  // Machine is contacted via IP/port/password (from AccessDevice doc, found by deviceCode).
  // u5UserId = machine's own integer key per employee. id_number = our memberCode.
  fastify.get<{ Params: { deviceCode: string } }>(
    '/access-devices/:deviceCode/sync-status',
    async (req, reply) => {
      const device = await AccessDevice.findOne({ deviceCode: req.params.deviceCode, isActive: true });
      if (!device?.ipAddress) {
        return reply.status(404).send({ error: 'Device not found or no IP configured' });
      }
      // sync-status uses the machine's local HTTP API — only valid for U5/LAN devices
      if (device.make === 'zkteco') {
        return reply.status(404).send({ error: 'sync-status not applicable for ZKBio cloud devices' });
      }

      // Machine connection — IP/port/password from AccessDevice doc; NOT MongoDB _id
      const machineUrl = `http://${device.ipAddress}:${device.port ?? 80}`;

      // u5UserId = machine's own auto-incremented integer key. NOT our MongoDB _id.
      let machineEmployees: Array<{ u5UserId: string; name: string; id_number?: string }> = [];
      try {
        const r = await fetch(`${machineUrl}/getEmployeeList`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: device.machinePassword ?? '123456' }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!r.ok) return reply.status(502).send({ error: `Machine HTTP ${r.status}` });
        const raw = await r.text();
        req.log.info({ endpoint: '/getEmployeeList', machineSn: device.machineSn, machineUrl, raw }, '[u5] sync-status getEmployeeList response');
        type RawEmployee = { userId?: string; userid?: string; name: string; id_number?: string };
        const d = JSON.parse(raw) as { data?: RawEmployee[] };
        machineEmployees = (d.data ?? []).map(e => ({
          u5UserId: String(e.userid ?? e.userId ?? ''),
          name:     e.name,
          ...(e.id_number != null ? { id_number: e.id_number } : {}),
        }));
      } catch {
        return reply.status(503).send({ error: 'Cannot reach machine' });
      }

      const enrolledMembers = await Member.find({ branchId: device.branchId, faceEnrolled: true })
        .select('_id memberCode firstName lastName')
        .lean();

      const machineCodes = new Set(machineEmployees.map(e => e.id_number).filter(Boolean) as string[]);
      const memberCodes  = new Set(enrolledMembers.map(m => m.memberCode));

      // Enrolled in our software but photo missing from machine
      const missingFromMachine = enrolledMembers
        .filter(m => !machineCodes.has(m.memberCode))
        .map(m => ({ memberId: m._id.toString(), memberCode: m.memberCode, name: `${m.firstName} ${m.lastName}` }));

      // Present in machine but no matching member in our software
      const orphans = machineEmployees
        .filter(e => !e.id_number || !memberCodes.has(e.id_number))
        .map(e => ({ u5UserId: e.u5UserId, name: e.name, id_number: e.id_number }));

      return reply.send({
        totalOnMachine:   machineEmployees.length,
        totalEnrolled:    enrolledMembers.length,
        missingFromMachine,
        orphans,
      });
    },
  );

  // GET /access-devices/:deviceCode/stranger-logs — fetch unregistered face attempts (type:1) from U5
  fastify.get<{ Params: { deviceCode: string } }>(
    '/access-devices/:deviceCode/stranger-logs',
    async (req, reply) => {
      const device = await AccessDevice.findOne({ deviceCode: req.params.deviceCode, isActive: true });
      if (!device?.ipAddress) {
        return reply.status(404).send({ error: 'Device not found or no IP configured' });
      }

      const machineUrl = `http://${device.ipAddress}:${device.port ?? 80}`;
      const password   = device.machinePassword ?? '123456';

      type StrangerNote = {
        userId?:      string | number; // raw machine field — always -1 for unrecognised faces
        userid?:      string | number; // machine sends lowercase variant in some firmware versions
        name?:        string;
        checkin_time: string;
        ispass?:      number;
        pic_large?:   string;          // machine sends pic_large (not pic)
      };

      try {
        const all: StrangerNote[] = [];
        let pageIndex = 0;
        let pageSum   = 1;
        const MAX_STRANGER_PAGES = 200;
        do {
          const r = await fetch(`${machineUrl}/getWorkNoteList`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password, type: 1, index: pageIndex }),
            signal: AbortSignal.timeout(15_000),
          });
          if (!r.ok) return reply.status(502).send({ error: `Machine HTTP ${r.status}` });

          const raw = await r.text();
          req.log.info({ endpoint: '/getWorkNoteList', type: 1, page: pageIndex, machineSn: device.machineSn }, '[u5] stranger-logs page received');

          const d = JSON.parse(raw) as { code?: number; page_sum?: number; data?: StrangerNote[] };
          if (d.code !== undefined && d.code !== 200) {
            return reply.status(502).send({ error: `Machine error code ${d.code}` });
          }
          pageSum = d.page_sum ?? 1;
          all.push(...(d.data ?? []));
          pageIndex++;
          if (pageIndex < pageSum && pageIndex < MAX_STRANGER_PAGES) {
            await new Promise<void>(resolve => setTimeout(resolve, 600));
          }
        } while (pageIndex < pageSum && pageIndex < MAX_STRANGER_PAGES);

        const strangers = all
          .filter(e => String(e.userid ?? e.userId ?? '') === '-1' || e.name === 'stranger')
          .map(e => ({
            userid:       e.userid ?? e.userId,
            checkin_time: e.checkin_time,
            ...(e.pic_large != null ? { pic: e.pic_large } : {}),
          }));
        return reply.send({ total: strangers.length, data: strangers });
      } catch (e) {
        return reply.status(503).send({
          error: 'Cannot reach machine',
          hint:  `${machineUrl} — ${(e as Error).message}`,
        });
      }
    },
  );

  // PUT /access-devices/:deviceCode/mqtt-config — save MQTT live-access config (set via Settings wizard)
  fastify.put<{
    Params: { deviceCode: string };
    Body: {
      machineSn:     string;
      mqttBrokerUrl: string;
      mqttInfoTopic: string;
      mqttUsername?: string;
      mqttPassword?: string;
    };
  }>('/access-devices/:deviceCode/mqtt-config', async (req, reply) => {
    const { machineSn, mqttBrokerUrl, mqttInfoTopic, mqttUsername, mqttPassword } = req.body;
    if (!mqttBrokerUrl || !mqttInfoTopic) {
      return reply.status(400).send({ error: 'mqttBrokerUrl and mqttInfoTopic are required' });
    }

    const device = await AccessDevice.findOneAndUpdate(
      { deviceCode: req.params.deviceCode, isActive: true },
      { machineSn, mqttBrokerUrl, mqttInfoTopic, mqttUsername, mqttPassword, mqttLiveEnabled: true },
      { new: true },
    );
    if (!device) return reply.status(404).send({ error: 'Device not found' });

    return reply.send({ ok: true, mqttInfoTopic, machineSn });
  });

  // PATCH /access-devices/:deviceCode — update mutable fields (localIp, name)
  fastify.patch<{ Params: { deviceCode: string }; Body: { localIp?: string; name?: string } }>(
    '/access-devices/:deviceCode',
    async (req, reply) => {
      const updates: Record<string, unknown> = {};
      if (req.body.localIp  !== undefined) updates.localIp = req.body.localIp;
      if (req.body.name     !== undefined) updates.name    = req.body.name;
      if (!Object.keys(updates).length) return reply.status(400).send({ error: 'nothing to update' });
      const device = await AccessDevice.findOneAndUpdate(
        { deviceCode: req.params.deviceCode, isActive: true },
        updates,
        { new: true },
      );
      if (!device) return reply.status(404).send({ error: 'Device not found' });
      return reply.send({ ok: true });
    },
  );

  // POST /access-devices/:deviceCode/fast-connect
  // Tries specified port first, then auto-scans common ports if that fails.
  // Returns either success or a list of reachable ports so the user can pick the right one.
  fastify.post<{ Params: { deviceCode: string }; Body: {
    deviceIp: string; devicePort?: number;
    username?: string; password?: string; sn?: string;
  } }>('/access-devices/:deviceCode/fast-connect', async (req, reply) => {
    const { deviceCode } = req.params;
    const { deviceIp, devicePort = 8090, username = 'admin', password = '123456', sn } = req.body;

    if (!deviceIp) return reply.status(400).send({ error: 'deviceIp required' });

    const device = await AccessDevice.findOne({ deviceCode });
    if (!device) return reply.status(404).send({ error: 'Device not registered' });

    const logBase = {
      sessionId: `fast_${Date.now().toString(36)}`,
      branchId:  device.branchId,
      deviceCode,
      adminIp:   req.ip,
    };

    // Helper: try one port, return null if unreachable or not our edge service
    async function probePort(ip: string, port: number, timeoutMs = 3000) {
      try {
        const res = await fetch(`http://${ip}:${port}/health`, {
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) return { port, reachable: true, isEdge: false, body: null };
        const body = await res.json() as Record<string, unknown>;
        const isEdge = typeof body['deviceId'] === 'string';
        return { port, reachable: true, isEdge, body };
      } catch {
        // Connection refused or timeout — also try root path to see if anything is listening
        try {
          await fetch(`http://${ip}:${port}/`, { signal: AbortSignal.timeout(timeoutMs) });
          return { port, reachable: true, isEdge: false, body: null };
        } catch {
          return { port, reachable: false, isEdge: false, body: null };
        }
      }
    }

    // 1. Try the user-specified port first
    const primary = await probePort(deviceIp, devicePort, 5000);

    if (primary.reachable && primary.isEdge) {
      // Our edge service answered — verify SN if provided
      const health = primary.body as { deviceId?: string; uptime?: number };
      if (sn && health.deviceId && health.deviceId !== sn) {
        await DeviceSetupLog.create({ ...logBase, step: 'FAST_CONNECT_SN_MISMATCH',
          metadata: { deviceIp, devicePort, enteredSn: sn, foundId: health.deviceId } });
        return reply.status(400).send({
          error: 'Serial number mismatch',
          hint:  `Device at ${deviceIp}:${devicePort} reports ID "${health.deviceId}" — you entered "${sn}". Check the display and try again.`,
        });
      }

      await AccessDevice.findOneAndUpdate({ deviceCode },
        { ipAddress: deviceIp, port: devicePort, lastHeartbeatAt: new Date() });
      await DeviceSetupLog.create({ ...logBase, step: 'FAST_CONNECT_SUCCESS',
        confirmedValue: health.deviceId ?? deviceIp,
        metadata: { deviceIp, devicePort, username, sn, foundDeviceId: health.deviceId } });

      return reply.send({ success: true, deviceId: health.deviceId, port: devicePort });
    }

    // 2. Primary port failed — parallel scan of common ports (skip the one already tried)
    const SCAN_PORTS = [80, 443, 8080, 8090, 8000, 3000, 4370, 4000].filter((p) => p !== devicePort);
    const results = await Promise.all(SCAN_PORTS.map((p) => probePort(deviceIp, p, 2000)));
    const reachable = results.filter((r) => r.reachable);
    const edgePorts = reachable.filter((r) => r.isEdge);

    await DeviceSetupLog.create({ ...logBase, step: 'FAST_CONNECT_SCAN',
      metadata: {
        deviceIp, triedPort: devicePort, primaryReachable: primary.reachable,
        reachablePorts: reachable.map((r) => r.port),
        edgePorts: edgePorts.map((r) => r.port),
      },
    });

    // 3a. Found our edge service on a different port — return it so the UI can suggest it
    const foundEdgePort = edgePorts[0];
    if (foundEdgePort) {
      return reply.status(409).send({
        error:       'Wrong port — edge service found on a different port',
        foundEdge:   true,
        suggestPort: foundEdgePort.port,
        hint:        `Edge service is running on port ${foundEdgePort.port}, not ${devicePort}. Use that port instead.`,
      });
    }

    // 3b. Device is reachable but no edge service found on any port
    if (reachable.length > 0) {
      return reply.status(409).send({
        error:          'Device reachable but edge service not found',
        foundEdge:      false,
        reachablePorts: reachable.map((r) => r.port),
        hint:           `The machine responded on port${reachable.length > 1 ? 's' : ''} ${reachable.map((r) => r.port).join(', ')} — these are likely its built-in web interface. The edge service (port 8090 by default) is not running yet. Start the edge service on the device, then try again.`,
      });
    }

    // 3c. Nothing reachable at all
    return reply.status(503).send({
      error: 'Device not reachable',
      hint:  `Scanned ${SCAN_PORTS.length + 1} ports on ${deviceIp} — nothing responded. Check that the device is powered on and on the same network as this server.`,
    });
  });

  // GET /network-info — returns server's non-loopback IPv4 addresses so the wizard can show them
  fastify.get('/network-info', { config: { skipAuth: true } }, async (_req, reply) => {
    const nets = networkInterfaces();
    const addresses: string[] = [];
    for (const iface of Object.values(nets)) {
      for (const addr of (iface ?? [])) {
        if (addr.family === 'IPv4' && !addr.internal) addresses.push(addr.address);
      }
    }
    return reply.send({ addresses, port: Number(process.env['PORT'] ?? 8080) });
  });

  // POST /device-setup-log — wizard calls this at every user confirmation (skipAuth: used before device auth)
  fastify.post('/device-setup-log', { config: { skipAuth: true } }, async (req, reply) => {
    const { sessionId, branchId, deviceCode, step, confirmedValue, metadata } =
      req.body as {
        sessionId: string; branchId: string; deviceCode: string;
        step: string; confirmedValue?: string; metadata?: Record<string, unknown>;
      };
    if (!sessionId || !branchId || !deviceCode || !step) {
      return reply.status(400).send({ error: 'sessionId, branchId, deviceCode, step required' });
    }
    await DeviceSetupLog.create({
      sessionId, branchId, deviceCode, step,
      confirmedValue,
      metadata: metadata ?? {},
      adminIp: req.ip,
    });
    return reply.send({ ok: true });
  });

  // GET /device-setup-log — support/admin views logs for a device to diagnose setup issues
  fastify.get('/device-setup-log', async (req, reply) => {
    const { deviceCode, branchId, sessionId } = req.query as {
      deviceCode?: string; branchId?: string; sessionId?: string;
    };
    const filter: Record<string, unknown> = {};
    if (deviceCode) filter['deviceCode'] = deviceCode;
    if (branchId)   filter['branchId']   = branchId;
    if (sessionId)  filter['sessionId']  = sessionId;
    const logs = await DeviceSetupLog.find(filter).sort({ createdAt: -1 }).limit(200).lean();
    return reply.send(logs);
  });

};

export default accessRoutes;
