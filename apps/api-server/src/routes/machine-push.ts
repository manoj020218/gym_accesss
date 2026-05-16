import type { FastifyPluginAsync, RouteHandlerMethod } from 'fastify';
import { AccessDevice } from '../models/AccessDevice.js';
import { broadcaster } from '../lib/event-broadcaster.js';

// Shared handler for all machine push paths.
// The machine connects directly on port 3000 (Fastify) since it cannot use HTTPS.
// Handles ZKBio/U5 "Third Party Record Push" — machine POSTs attendance records
// to a hardcoded path; we register all common paths so we catch whichever one
// this firmware uses.
const handlePush: RouteHandlerMethod = async function (req, reply) {
  const machineIp =
    (req.headers['x-real-ip'] as string | undefined)
    ?? (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim()
    ?? req.socket.remoteAddress;

  const body = (req.body ?? {}) as Record<string, unknown>;
  const originalUri = req.headers['x-original-uri'] ?? req.url;

  // Log everything so we can see the exact payload the machine sends
  this.log.info({
    event: 'machine_push',
    ip:    machineIp,
    path:  originalUri,
    body,
  }, 'Machine push received');

  // Extract SN from common field names used by ZKBio/U5 devices
  const machineSn = (
    body.SN ?? body.sn ?? body.deviceSn ?? body.device_sn ?? body.DeviceSN
  ) as string | undefined;

  // ── Find the matching AccessDevice ─────────────────────────────────────────
  let device = null;

  // 1) Match by stored IP (fast — works after first successful push)
  if (machineIp) {
    device = await AccessDevice.findOne({ ipAddress: machineIp, isActive: true });
  }

  // 2) Match by machine serial number
  if (!device && machineSn) {
    device = await AccessDevice.findOne({ machineSn, isActive: true });
  }

  // 3) Auto-assign: find newest device created in the last 2 hours with no heartbeat.
  //    This covers first-time setup — user just added the device via wizard.
  if (!device) {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    device = await AccessDevice.findOne({
      createdAt:       { $gte: twoHoursAgo },
      lastHeartbeatAt: { $exists: false },
      isActive:        true,
    }).sort({ createdAt: -1 });
  }

  if (device) {
    const updates: Record<string, unknown> = { lastHeartbeatAt: new Date() };
    if (machineIp && !device.ipAddress) updates.ipAddress = machineIp;
    if (machineSn  && !device.machineSn)  updates.machineSn  = machineSn;

    await AccessDevice.findByIdAndUpdate(device.id, updates);

    broadcaster.broadcast('device_online', {
      deviceId:   device.id,
      deviceCode: device.deviceCode,
      branchId:   device.branchId,
      ts:         new Date().toISOString(),
    });

    this.log.info({
      event:      'machine_online',
      deviceCode: device.deviceCode,
      ip:         machineIp,
      sn:         machineSn,
    }, 'Machine marked online');
  } else {
    this.log.warn({
      event: 'machine_push_no_match',
      ip:    machineIp,
      sn:    machineSn,
    }, 'Machine push: no matching AccessDevice found');
  }

  // Always 200 — otherwise the machine will retry and spam logs
  return reply.status(200).send({ ok: true });
};

const ROUTE_OPTS = {
  config: { skipAuth: true },
  schema: { body: {} }, // accept any body
} as const;

// ── Plugin registered with /api/v1 prefix (accessible via nginx on port 80) ──
export const machinePushApiRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/machine-push', ROUTE_OPTS, handlePush);
};

// ── Plugin registered WITHOUT prefix (direct port 3000 from machine) ─────────
// ZKBio Third Party Record Push uses a hardcoded path; cover the common ones.
export const machinePushNativeRoutes: FastifyPluginAsync = async (fastify) => {
  // ZKBio CloudServer standard path
  fastify.post('/cloudserver/api/transData', ROUTE_OPTS, handlePush);
  // Wildcard for other ZKBio sub-paths
  fastify.post('/cloudserver/*', ROUTE_OPTS, handlePush);
  // Common alternative paths
  fastify.post('/RecordInfo',    ROUTE_OPTS, handlePush);
  fastify.post('/record',        ROUTE_OPTS, handlePush);
  fastify.post('/push',          ROUTE_OPTS, handlePush);
  fastify.post('/attendance',    ROUTE_OPTS, handlePush);
};

export default machinePushApiRoutes;
