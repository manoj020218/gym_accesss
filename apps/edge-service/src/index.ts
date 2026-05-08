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
