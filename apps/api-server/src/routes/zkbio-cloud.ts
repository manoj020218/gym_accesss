import type { FastifyPluginAsync, FastifyInstance, FastifyRequest } from 'fastify';
import { AccessDevice } from '../models/AccessDevice.js';
import { AccessEvent }  from '../models/AccessEvent.js';
import { ZkbioEmployee } from '../models/ZkbioEmployee.js';
import { broadcaster }  from '../lib/event-broadcaster.js';

// ZKBio Cloud Server API — Face Recognition 3.0 HTTP polling protocol
//
// Machine connects to cloudserver_address (http://smartgym.iotsoft.in) on port 80.
// nginx proxies paths /device/ /parameter/ /devicePass/ /personnelInfo/ /record/ → Fastify.
//
// Polling cycle (every `parameterPolling` seconds, default ~30s):
//   POST /device/updateStateDevice        — heartbeat
//   POST /parameter/inertParameter        — machine pushes its full config JSON
//   POST /parameter/selectParameterInfo   — machine polls for pending config changes
//   POST /devicePass/selectDeleteInfo     — machine polls for faces to delete
//   POST /device/selectRestart            — machine polls for restart command
//   POST /devicePass/selectPassInfo       — machine polls for employees to enroll (face sync)
//
// When machine recognises a face it pushes an attendance record. The exact path is
// discovered via the wildcard handler; likely /devicePass/inertPersonnel.

const OK         = { code: 0, message: 'success', data: null };
const ROUTE_OPTS = { config: { skipAuth: true }, schema: { body: {} } } as const;

type Req = FastifyRequest & { url: string };

function extractIp(req: Req) {
  return (req.headers['x-real-ip'] as string | undefined)
    ?? (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim()
    ?? req.socket.remoteAddress;
}

async function resolveDevice(deviceId: string | undefined, machineIp: string | undefined) {
  let device = null;
  if (deviceId) device = await AccessDevice.findOne({ machineSn: deviceId, isActive: true });
  // Only fall back to IP when the machine sent no SN — ZKBio always sends SN, so skip IP
  // matching for them. Multiple ZKBio machines on the same LAN share a public IP; matching
  // by IP would route every machine to whichever device claimed that IP first.
  if (!device && !deviceId && machineIp) device = await AccessDevice.findOne({ ipAddress: machineIp, isActive: true });
  if (!device) {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    device = await AccessDevice.findOne({
      createdAt:       { $gte: twoHoursAgo },
      lastHeartbeatAt: { $exists: false },
      isActive:        true,
    }).sort({ createdAt: -1 });
  }
  return device;
}

// Process an attendance/punch record pushed by the machine.
// Called from the wildcard handler whenever body contains checkin_time.
async function processAttendanceRecord(
  fastify: FastifyInstance,
  req: Req,
  body: Record<string, unknown>,
) {
  const machineUserId = body.userid       as string | undefined;
  const name          = body.name         as string | undefined;
  const checkinTime   = body.checkin_time as string;
  const ispass        = (body.ispass      as number | undefined) ?? 1;
  const deviceId      = body.deviceId     as string | undefined;
  const machineIp     = extractIp(req);

  fastify.log.info({
    event: 'zkbio_attendance',
    path:  req.url,
    deviceId, machineUserId, name, checkinTime, ispass,
  }, 'ZKBio attendance record');

  const device = await resolveDevice(deviceId, machineIp);
  if (!device) {
    fastify.log.warn({ deviceId, ip: machineIp }, 'ZKBio attendance: no device matched');
    return;
  }

  // Try to link to a known member via ZkbioEmployee
  let subjectId   = machineUserId ?? 'unknown';
  let subjectType: 'member' | 'visitor' = 'visitor';

  if (machineUserId && deviceId) {
    const emp = await ZkbioEmployee.findOne({ deviceSn: deviceId, machineUserId }).lean();
    if (emp?.memberId) {
      subjectId   = emp.memberId;
      subjectType = 'member';
    }
  }

  // Parse "YYYY-MM-DD HH:MM:SS" → Date
  const eventTime = new Date(checkinTime.replace(' ', 'T'));
  const localSeq  = isNaN(eventTime.getTime()) ? Date.now() : eventTime.getTime();

  try {
    await AccessEvent.create({
      edgeDeviceId:   device.id as string,
      branchId:       device.branchId,
      zone:           device.zone,
      subjectType,
      subjectId,
      subjectName:    name,
      decision:       ispass ? 'granted' : 'denied',
      identifierUsed: 'face',
      localSeq,
      eventTime:      isNaN(eventTime.getTime()) ? new Date() : eventTime,
    });

    broadcaster.broadcast('access_event', {
      deviceCode:  device.deviceCode,
      branchId:    device.branchId,
      subjectName: name,
      decision:    ispass ? 'granted' : 'denied',
      ts:          checkinTime,
    });
  } catch (err: unknown) {
    const isDup = (err as { code?: number })?.code === 11000;
    if (!isDup) fastify.log.error({ err }, 'ZKBio attendance: AccessEvent create failed');
  }
}

export const zkbioCloudRoutes: FastifyPluginAsync = async (fastify) => {

  // ── Heartbeat ─────────────────────────────────────────────────────────────
  fastify.post('/device/updateStateDevice', ROUTE_OPTS, async (req, reply) => {
    const body      = (req.body ?? {}) as Record<string, unknown>;
    const deviceId  = body.deviceId as string | undefined;
    const machineIp = extractIp(req as Req);

    fastify.log.info({ event: 'zkbio_heartbeat', deviceId, ip: machineIp }, 'ZKBio heartbeat');

    const device = await resolveDevice(deviceId, machineIp);
    if (device) {
      const updates: Record<string, unknown> = { lastHeartbeatAt: new Date() };
      if (machineIp && !device.ipAddress) updates.ipAddress = machineIp;
      if (deviceId   && !device.machineSn) updates.machineSn = deviceId;
      await AccessDevice.findByIdAndUpdate(device.id, updates);
      broadcaster.broadcast('device_online', {
        deviceId:   device.id,
        deviceCode: device.deviceCode,
        branchId:   device.branchId,
        ts:         new Date().toISOString(),
      });
    } else {
      fastify.log.warn({ event: 'zkbio_heartbeat_no_match', deviceId, ip: machineIp },
        'No device matched for ZKBio heartbeat');
    }

    return reply.send(OK);
  });

  // ── Machine pushes its own config parameters ──────────────────────────────
  fastify.post('/parameter/inertParameter', ROUTE_OPTS, async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    fastify.log.info({ event: 'zkbio_param_push', deviceId: body.deviceId }, 'ZKBio parameter push');
    return reply.send(OK);
  });

  // ── Machine polls for server-side parameter updates ───────────────────────
  fastify.post('/parameter/selectParameterInfo', ROUTE_OPTS, async (_req, reply) => {
    return reply.send(OK);
  });

  // ── Machine polls for faces to delete ────────────────────────────────────
  // Returns employees whose deletedAt was set within the last 7 days so the machine removes their templates.
  fastify.post('/devicePass/selectDeleteInfo', ROUTE_OPTS, async (req, reply) => {
    const body     = (req.body ?? {}) as Record<string, unknown>;
    const deviceId = body.deviceId as string | undefined;

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const pending = deviceId
      ? await ZkbioEmployee.find(
          { deviceSn: deviceId, deletedAt: { $gte: sevenDaysAgo } },
          { machineUserId: 1 },
        ).lean()
      : [];

    return reply.send({
      code: 0, message: 'success',
      data: { total: pending.length, deleteList: pending.map(e => ({ userid: e.machineUserId })) },
    });
  });

  // ── Machine polls for employees/faces to enroll ───────────────────────────
  // Machine sends: { deviceId, last_employee_number, needBase64 }
  // Returns active (non-deleted) employees for that device.
  // pic_large is always included when available so new enrollments get synced on every poll.
  fastify.post('/devicePass/selectPassInfo', ROUTE_OPTS, async (req, reply) => {
    const body     = (req.body ?? {}) as Record<string, unknown>;
    const deviceId = body.deviceId as string | undefined;

    const employees = deviceId
      ? await ZkbioEmployee.find({ deviceSn: deviceId, deletedAt: { $exists: false } }).lean()
      : [];

    fastify.log.info(
      { event: 'zkbio_select_pass_info', deviceId, count: employees.length },
      'ZKBio selectPassInfo',
    );

    return reply.send({
      code:    0,
      message: 'success',
      data: {
        total:    employees.length,
        dataList: employees.map(e => ({
          userid:    e.machineUserId,
          name:      e.name,
          pic_large: e.picLarge ?? '',
          pass_date: e.passDate,
          pass_time: e.passTime,
        })),
      },
    });
  });

  // ── Machine polls for restart command ────────────────────────────────────
  fastify.post('/device/selectRestart', ROUTE_OPTS, async (_req, reply) => {
    return reply.send({ code: 0, message: 'success', data: { restart: 0 } });
  });

  // ── Attendance push + unknown-path discovery ──────────────────────────────
  // Catches any unhandled paths under the ZKBio prefixes.
  // If body contains checkin_time → attendance record → process it.
  // Otherwise → log for discovery of new protocol paths.
  for (const prefix of ['/devicePass/*', '/personnelInfo/*', '/record/*']) {
    fastify.post(prefix, ROUTE_OPTS, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;

      if (body.checkin_time) {
        await processAttendanceRecord(fastify, req as Req, body);
        return reply.send(OK);
      }

      fastify.log.info(
        { event: 'zkbio_unknown', path: (req as Req).url, body },
        'ZKBio unknown path — logging for discovery',
      );
      return reply.send(OK);
    });
  }
};
