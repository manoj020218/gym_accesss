/**
 * Minimal Fastify HTTP server exposing a health endpoint on HEALTH_PORT.
 * Used by PM2 and monitoring systems to verify the adapter is running.
 */

import Fastify from 'fastify';
import type { ReaderConfig } from './config.js';

export async function startHealthServer(
  port: number,
  readersConfig: ReaderConfig[],
  logLevel: string,
): Promise<() => Promise<void>> {
  const app = Fastify({ logger: { level: logLevel } });

  app.get('/health', async (_req, reply) => {
    return reply.send({
      status:    'ok',
      service:   'hardware-adapter',
      uptime:    process.uptime(),
      readers:   readersConfig.map((r) => ({ name: r.name, type: r.type, zone: r.zone })),
      timestamp: new Date().toISOString(),
    });
  });

  await app.listen({ port, host: '0.0.0.0' });
  app.log.info(`⚡ Hardware adapter health on :${port}`);

  return () => app.close();
}
