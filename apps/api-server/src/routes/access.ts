import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { createHmac, randomBytes } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { AccessEvent } from '../models/AccessEvent.js';
import { AccessDevice } from '../models/AccessDevice.js';
import { DeviceSetupLog } from '../models/DeviceSetupLog.js';
import { AccessDecision, Zone, SubjectType, StaffRole } from '@edge-gym/shared-types';

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

  // GET /access-devices — list devices with live online status derived from heartbeat
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

    return reply.send(
      devices.map((d) => ({
        _id:              d._id,
        deviceId:         d.deviceCode,
        name:             d.name,
        branchId:         d.branchId,
        zone:             d.zone,
        type:             d.type,
        isOnline:         !!(d.lastHeartbeatAt && d.lastHeartbeatAt > fiveMinAgo),
        lastHeartbeat:    d.lastHeartbeatAt?.toISOString(),
        ipAddress:        d.ipAddress,
        port:             d.port,
        pendingEventCount: 0,
        createdAt:        d.createdAt.toISOString(),
      })),
    );
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
  fastify.get<{ Params: { deviceId: string } }>(
    '/access-devices/:deviceId/u5-employees',
    async (req, reply) => {
      const device = await AccessDevice.findOne({ deviceCode: req.params.deviceId, isActive: true });
      if (!device?.ipAddress) {
        return reply.status(404).send({ error: 'Device not found or no IP stored' });
      }

      try {
        const res = await fetch(`http://${device.ipAddress}:${device.port ?? 80}/getEmployeeList`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ password: device.machinePassword ?? '123456' }),
          signal:  AbortSignal.timeout(10_000),
        });

        if (!res.ok) return reply.status(502).send({ error: `Machine responded with HTTP ${res.status}` });

        const data = await res.json() as { data?: Array<{ userId: string; name: string; id_number?: string }> };
        return reply.send({ employees: data.data ?? [] });
      } catch (err) {
        const isTimeout = err instanceof Error && err.name === 'TimeoutError';
        return reply.status(503).send({ error: isTimeout ? 'Machine timed out' : 'Cannot reach machine' });
      }
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
    if (edgePorts.length > 0) {
      return reply.status(409).send({
        error:     'Wrong port — edge service found on a different port',
        foundEdge: true,
        suggestPort: edgePorts[0].port,
        hint:      `Edge service is running on port ${edgePorts[0].port}, not ${devicePort}. Use that port instead.`,
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
