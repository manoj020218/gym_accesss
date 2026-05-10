import Fastify  from 'fastify';
import { config } from './config.js';
import { EdgeDB } from './db/sqlite.js';
import { decide } from './access/decision.js';
import { startSyncWorker } from './sync/worker.js';
import { U5Adapter } from './hardware/u5/index.js';
import { Zone, AccessDecision } from '@edge-gym/shared-types';
import { z } from 'zod';

const AccessBody = z.object({
  identifierValue: z.string().min(1),
  identifierType:  z.enum(['rfid', 'qr', 'face', 'card', 'manual']),
  zone:            z.nativeEnum(Zone),
});

async function main() {
  const db  = new EdgeDB(config.EDGE_SQLITE_PATH);
  const app = Fastify({
    logger: {
      level:     config.LOG_LEVEL,
      transport: config.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    },
  });

  // Health
  app.get('/health', async (_req, reply) => {
    return reply.send({ status: 'ok', deviceId: config.EDGE_DEVICE_ID, uptime: process.uptime() });
  });

  // Access decision endpoint (called by device adapter / TCP listener)
  app.post<{ Body: z.infer<typeof AccessBody> }>('/access/decide', async (req, reply) => {
    const body = AccessBody.parse(req.body);
    const result = decide(db, body);

    app.log.info({
      decision:  result.decision,
      subject:   result.subjectId,
      zone:      body.zone,
      relay:     result.triggerRelay,
    }, 'Access decision');

    return reply.status(result.decision === AccessDecision.Allow ? 200 : 403).send(result);
  });

  // Face enrollment — cloud API forwards admin's request here; we call the U5 machine.
  //   upload  — imageBase64 provided; we POST it to U5 /insertEmployee
  //   capture — live camera mode (not supported by U5 web API; instruct admin to use upload)
  app.post<{ Body: { memberId: string; memberCode: string; imageBase64?: string; mode?: string; memberName?: string; cardNumber?: string } }>(
    '/enroll-face',
    async (req, reply) => {
      const {
        memberId, memberCode, imageBase64,
        mode = imageBase64 ? 'upload' : 'capture',
        memberName, cardNumber,
      } = req.body ?? {};

      if (!memberId || !memberCode) {
        return reply.status(400).send({ success: false, message: 'memberId and memberCode required' });
      }

      app.log.info({ memberId, memberCode, mode, hasImage: !!imageBase64 }, 'Face enrollment triggered');

      if (!config.U5_MACHINE_IP) {
        app.log.warn('U5_MACHINE_IP not configured — returning simulated success');
        return reply.send({ success: true, memberId, memberCode, mode, message: 'Simulated (no hardware IP configured)' });
      }

      const u5 = new U5Adapter({
        ip:       config.U5_MACHINE_IP,
        port:     config.U5_MACHINE_PORT,
        password: config.U5_MACHINE_PASSWORD,
      });

      if (mode === 'upload') {
        if (!imageBase64) {
          return reply.status(400).send({ success: false, message: 'imageBase64 required for upload mode' });
        }
        // U5 expects a full data URL
        const picLarge = imageBase64.startsWith('data:')
          ? imageBase64
          : `data:image/jpeg;base64,${imageBase64}`;

        const result = await u5.enrollFace({
          idNumber:   memberCode,
          name:       (memberName ?? memberCode).slice(0, 10),
          picLarge,
          cardNumber,
        });

        if (!result.success) {
          app.log.warn({ memberCode, code: result.code, message: result.message }, 'U5 enrollment failed');
          return reply.status(422).send({ success: false, message: result.message });
        }

        app.log.info({ memberCode }, 'U5 face enrolled successfully');
        return reply.send({ success: true, memberId, memberCode, mode, message: 'Face registered on U5 device' });
      }

      // Capture mode: U5's /insertEmployee always needs a pre-supplied photo
      return reply.status(501).send({
        success: false,
        message: 'Live capture not supported by U5 web API — please upload a photo instead',
      });
    },
  );

  // GET /u5/employees — proxy getEmployeeList from the U5 machine
  app.get('/u5/employees', async (_req, reply) => {
    if (!config.U5_MACHINE_IP) {
      return reply.send({ data: [], simulated: true });
    }
    const u5 = new U5Adapter({ ip: config.U5_MACHINE_IP, port: config.U5_MACHINE_PORT, password: config.U5_MACHINE_PASSWORD });
    const result = await u5.getEmployeeList();
    if (!result.success) {
      return reply.status(502).send({ error: result.message });
    }
    // Strip pic_large from list response — it's large and not needed for sync checks
    return reply.send({ data: result.data.map(({ userId, name, id_number }) => ({ userId, name, id_number })) });
  });

  // Sync status
  app.get('/sync/status', async (_req, reply) => {
    const state   = db.getSyncState();
    const pending = db.getPendingEvents(1).length;
    return reply.send({ ...state, hasPending: pending > 0, deviceId: config.EDGE_DEVICE_ID });
  });

  try {
    await app.listen({ port: config.EDGE_PORT, host: '0.0.0.0' });
    app.log.info(`⚡ EDGE service [${config.EDGE_DEVICE_ID}] listening on :${config.EDGE_PORT}`);
    startSyncWorker(db, app.log);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  process.on('SIGTERM', () => { db.close(); process.exit(0); });
}

void main();
