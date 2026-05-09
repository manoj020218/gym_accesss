import Fastify  from 'fastify';
import { config } from './config.js';
import { EdgeDB } from './db/sqlite.js';
import { decide } from './access/decision.js';
import { startSyncWorker } from './sync/worker.js';
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

  // Face enrollment — triggered by cloud API or admin UI on same LAN
  // In production: call hardware SDK here to open camera and capture biometric,
  // then link captured face to memberCode as the unique identity key on the device.
  app.post<{ Body: { memberId: string; memberCode: string } }>('/enroll-face', async (req, reply) => {
    const { memberId, memberCode } = req.body ?? {};
    if (!memberId || !memberCode) {
      return reply.status(400).send({ success: false, message: 'memberId and memberCode required' });
    }

    app.log.info({ memberId, memberCode }, 'Face enrollment triggered — hardware integration point');

    // TODO: call device SDK  e.g.  await faceDevice.startEnrollment(memberCode)
    // For now return simulated success so the UI flow is fully testable.
    return reply.send({
      success:    true,
      memberId,
      memberCode,
      message:    `Face enrolled on device and linked to ID: ${memberCode}`,
    });
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
