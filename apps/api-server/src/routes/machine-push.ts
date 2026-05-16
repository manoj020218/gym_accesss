import type { FastifyPluginAsync } from 'fastify';
import { AccessDevice } from '../models/AccessDevice.js';
import { broadcaster } from '../lib/event-broadcaster.js';

// Accepts HTTP push from U5 and ZKBio-style face-recognition machines.
// nginx rewrites all requests arriving on :3000 to /api/v1/machine-push,
// so this single endpoint handles whatever path the machine posts to.
const machinePushRoutes: FastifyPluginAsync = async (fastify) => {

  fastify.post(
    '/machine-push',
    {
      config: { skipAuth: true },
      schema: {
        // accept any body so we don't reject machines with non-standard payloads
        body: {},
      },
    },
    async (req, reply) => {
      const machineIp =
        (req.headers['x-real-ip'] as string | undefined)
        ?? (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim()
        ?? req.socket.remoteAddress;

      const body = req.body as Record<string, unknown> | null ?? {};
      const originalUri = req.headers['x-original-uri'] ?? req.url;

      // Log everything — first-time push reveals what the machine actually sends
      fastify.log.info({
        event: 'machine_push',
        ip:   machineIp,
        path: originalUri,
        body,
      }, 'Machine push received');

      // Extract SN from common field names used by ZKBio/U5 devices
      const machineSn =
        (body.SN ?? body.sn ?? body.deviceSn ?? body.device_sn ?? body.DeviceSN) as string | undefined;

      // ── Find the matching AccessDevice ───────────────────────────────────
      let device = null;

      // 1) Match by stored IP (fastest — works after first successful push)
      if (machineIp) {
        device = await AccessDevice.findOne({ ipAddress: machineIp, isActive: true });
      }

      // 2) Match by machine serial number
      if (!device && machineSn) {
        device = await AccessDevice.findOne({ machineSn, isActive: true });
      }

      // 3) Auto-assign: find newest device created in the last 2 hours with no heartbeat yet.
      //    Covers the wizard's first-time setup — user just added the device, machine first connects.
      if (!device) {
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
        device = await AccessDevice.findOne({
          createdAt: { $gte: twoHoursAgo },
          lastHeartbeatAt: { $exists: false },
          isActive: true,
        }).sort({ createdAt: -1 });
      }

      if (device) {
        const updates: Record<string, unknown> = { lastHeartbeatAt: new Date() };
        if (machineIp && !device.ipAddress) updates.ipAddress = machineIp;
        if (machineSn  && !device.machineSn)  updates.machineSn  = machineSn;

        await AccessDevice.findByIdAndUpdate(device.id, updates);

        // Notify browser clients (wizard polling picks this up via WS or next poll)
        broadcaster.broadcast('device_online', {
          deviceId:   device.id,
          deviceCode: device.deviceCode,
          branchId:   device.branchId,
          ts:         new Date().toISOString(),
        });

        fastify.log.info({
          event:      'machine_online',
          deviceCode: device.deviceCode,
          ip:         machineIp,
          sn:         machineSn,
        }, 'Machine marked online');
      } else {
        fastify.log.warn({
          event: 'machine_push_no_match',
          ip:    machineIp,
          sn:    machineSn,
        }, 'Machine push: no matching AccessDevice found');
      }

      // Always 200 — otherwise the machine will retry and fill logs
      return reply.status(200).send({ ok: true });
    },
  );
};

export default machinePushRoutes;
