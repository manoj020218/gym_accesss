import type { FastifyPluginAsync } from 'fastify';
import { createDecipheriv } from 'node:crypto';
import { AccessDevice } from '../models/AccessDevice.js';

// POST /auth — Machine MQTT auth endpoint (Face Recognition 3.0 protocol)
//
// Flow:
//   1. Machine POSTs { device_id, product_key, time } with AES-encrypted sign header
//   2. This endpoint returns MQTT credentials + topic prefixes
//   3. Machine connects to Mosquitto at VPS_HOST:1883 with the returned creds
//   4. Machine publishes punch records to device/info/{token}/{device_id}
//
// To configure the machine:
//   MQTT Server : smartgym.iotsoft.in
//   MQTT Port   : 1883  (or use the auth URL below)
//   Auth URL    : http://smartgym.iotsoft.in:3000/auth
//   Product Key : machine serial number (or leave empty for open-auth test mode)

const MQTT_USERNAME = 'face_device';
const MQTT_PASSWORD = 'device_pass123';

// Common AES-128-CBC defaults used by ZKBio / generic face-recognition devices.
// The machine's firmware determines the actual key/IV — we try these on each auth request
// and log the result. If none match, we still grant access in test mode.
// Build a 16-byte buffer from a string (null-pad or zero-pad to length)
function padKey(s: string): Buffer {
  const b = Buffer.alloc(16, 0);
  Buffer.from(s).copy(b);
  return b;
}

const CANDIDATE_KEYS: Array<{ key: Buffer; iv: Buffer; label: string }> = [
  // Device name (from /getDeviceVersion response) padded to 16 bytes
  { key: padKey('n7v5_alcor2'),     iv: Buffer.alloc(16, 0),  label: 'device_name_null_iv' },
  { key: padKey('n7v5_alcor2'),     iv: padKey('n7v5_alcor2'), label: 'device_name_self_iv' },
  // SN-based keys
  { key: padKey('ZY20241227014'),   iv: Buffer.alloc(16, 0),  label: 'sn_null_iv' },
  // Generic defaults
  { key: Buffer.from('0123456789abcdef'), iv: Buffer.from('0000000000000000'), label: 'default1' },
  { key: Buffer.from('1234567890123456'), iv: Buffer.from('1234567890123456'), label: 'default2' },
];

function tryDecrypt(b64: string): { label: string; plaintext: string } | null {
  const buf = Buffer.from(b64, 'base64');
  for (const { key, iv, label } of CANDIDATE_KEYS) {
    try {
      const d = createDecipheriv('aes-128-cbc', key, iv);
      const plain = Buffer.concat([d.update(buf), d.final()]).toString('utf8');
      return { label, plaintext: plain };
    } catch { /* try next */ }
  }
  return null;
}

const machineAuthRoutes: FastifyPluginAsync = async (fastify) => {

  fastify.post(
    '/auth',
    {
      config: { skipAuth: true },
      schema: { body: {} },
    },
    async (req, reply) => {
      const sign     = req.headers['sign'] as string | undefined;
      const body     = (req.body ?? {}) as Record<string, unknown>;
      const deviceId = body.device_id  as string | undefined;
      const prodKey  = (body.product_key ?? '') as string;
      const ts       = body.time as number | undefined;
      const machineIp =
        (req.headers['x-real-ip'] as string | undefined)
        ?? (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim()
        ?? req.socket.remoteAddress;

      // Log everything — first auth reveals device_id and product_key format
      fastify.log.info({
        event:     'machine_auth',
        ip:        machineIp,
        deviceId,
        productKey: prodKey,
        timestamp: ts,
        signHeader: sign,
      }, 'Machine auth request');

      if (!deviceId) {
        return reply.status(400).send({ code: 105, msg: 'device_id is null', data: null });
      }

      // Try AES sign verification (for logging — we accept either way in test mode)
      let signOk = false;
      if (sign) {
        const decrypted = tryDecrypt(sign);
        if (decrypted) {
          const expected = `${deviceId}${prodKey}${ts}`;
          signOk = decrypted.plaintext === expected;
          fastify.log.info({
            event:    signOk ? 'sign_ok' : 'sign_mismatch',
            keyUsed:  decrypted.label,
            decrypted: decrypted.plaintext,
            expected,
          }, signOk ? 'AES sign verified' : 'AES sign mismatch (test mode: still accepting)');
        } else {
          fastify.log.warn({ event: 'sign_decrypt_failed', signHeader: sign },
            'Could not decrypt sign with any known key (test mode: still accepting)');
        }
      }

      // Generate a token for this session
      const token = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

      // Update AccessDevice record: match by machineSn (product_key) or auto-assign
      let device = await AccessDevice.findOne({ machineSn: deviceId, isActive: true });
      if (!device && prodKey) {
        device = await AccessDevice.findOne({ machineSn: prodKey, isActive: true });
      }
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
        if (machineIp && !device.ipAddress)  updates.ipAddress  = machineIp;
        if (deviceId   && !device.machineSn) updates.machineSn  = deviceId;
        await AccessDevice.findByIdAndUpdate(device.id, updates);
        fastify.log.info({ deviceCode: device.deviceCode }, 'Machine authenticated, device marked online');
      }

      // Respond with MQTT credentials and topic prefixes
      const vpsHost = req.hostname?.split(':')[0] ?? 'smartgym.iotsoft.in';
      return reply.send({
        code: 200,
        msg: 'success',
        data: {
          token,
          client_key:          token.slice(0, 6),
          username:            MQTT_USERNAME,
          password:            MQTT_PASSWORD,
          host:                'tcp://',
          port:                '1883',
          ip:                  vpsHost,
          server_client_id:    '',
          order_topic:         'device/cmd',
          info_topic:          'device/info',
          result_device_topic: 'device/result/device',
          result_server_topic: 'device/result/server',
        },
      });
    },
  );
};

export default machineAuthRoutes;
