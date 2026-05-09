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
        _id:             d._id,
        deviceId:        d.deviceCode,
        name:            d.name,
        branchId:        d.branchId,
        zone:            d.zone,
        type:            d.type,
        isOnline:        !!(d.lastHeartbeatAt && d.lastHeartbeatAt > fiveMinAgo),
        lastHeartbeat:   d.lastHeartbeatAt?.toISOString(),
        pendingEventCount: 0,
        createdAt:       d.createdAt.toISOString(),
      })),
    );
  });

  // POST /access-devices/:deviceCode/fast-connect
  // Admin enters the device's IP+SN from its display; cloud reaches out, verifies, marks online immediately
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
      sessionId:  `fast_${Date.now().toString(36)}`,
      branchId:   device.branchId,
      deviceCode,
      adminIp:    req.ip,
    };

    try {
      const res = await fetch(`http://${deviceIp}:${devicePort}/health`, {
        signal: AbortSignal.timeout(6000),
      });

      if (!res.ok) {
        await DeviceSetupLog.create({ ...logBase, step: 'FAST_CONNECT_FAILED',
          metadata: { deviceIp, devicePort, httpStatus: res.status } });
        return reply.status(503).send({ error: `Device responded with HTTP ${res.status}` });
      }

      const health = (await res.json()) as { deviceId?: string; uptime?: number };

      // SN check — if user provided one, it must match the device's reported ID
      if (sn && health.deviceId && health.deviceId !== sn) {
        await DeviceSetupLog.create({ ...logBase, step: 'FAST_CONNECT_SN_MISMATCH',
          metadata: { deviceIp, devicePort, enteredSn: sn, foundId: health.deviceId } });
        return reply.status(400).send({
          error: 'Serial number mismatch',
          hint:  `The device at ${deviceIp}:${devicePort} reports ID "${health.deviceId}" but you entered "${sn}". Check the display and try again.`,
        });
      }

      // Mark online — update IP and heartbeat timestamp so the GET /access-devices picks it up immediately
      await AccessDevice.findOneAndUpdate(
        { deviceCode },
        { ipAddress: deviceIp, port: devicePort, lastHeartbeatAt: new Date() },
      );

      await DeviceSetupLog.create({ ...logBase, step: 'FAST_CONNECT_SUCCESS',
        confirmedValue: health.deviceId ?? deviceIp,
        metadata: { deviceIp, devicePort, username, sn, foundDeviceId: health.deviceId, uptimeS: health.uptime } });

      return reply.send({ success: true, deviceId: health.deviceId, uptime: health.uptime });

    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      await DeviceSetupLog.create({ ...logBase, step: 'FAST_CONNECT_FAILED',
        metadata: { deviceIp, devicePort, error: detail } });
      return reply.status(503).send({
        error: 'Cannot reach device',
        detail,
        hint: `Make sure the device at ${deviceIp}:${devicePort} is powered on and on the same network as this server.`,
      });
    }
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
