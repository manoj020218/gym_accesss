import type { FastifyPluginAsync } from 'fastify';
import mongoose from 'mongoose';

const healthRoutes: FastifyPluginAsync = async (fastify) => {

  // GET /health — liveness + readiness (polled by PM2 and load balancer)
  fastify.get('/health', { config: { skipAuth: true } }, async (_req, reply) => {
    const mongoState = mongoose.connection.readyState === 1 ? 'up' : 'down';

    let mongoPingMs: number | null = null;
    if (mongoState === 'up') {
      const t0 = Date.now();
      try {
        await mongoose.connection.db?.command({ ping: 1 });
        mongoPingMs = Date.now() - t0;
      } catch {
        /* leave null — MongoDB responded but ping failed */
      }
    }

    const healthy = mongoState === 'up';
    return reply.status(healthy ? 200 : 503).send({
      status:    healthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime:    Math.floor(process.uptime()),
      services:  { mongodb: mongoState, mongoPingMs },
      process:   {
        pid:      process.pid,
        version:  process.version,
        platform: process.platform,
        memoryMB: Math.round(process.memoryUsage().heapUsed / 1_048_576),
      },
    });
  });

  // GET /metrics — process + MongoDB stats (no auth — internal use)
  fastify.get('/metrics', { config: { skipAuth: true } }, async (_req, reply) => {
    const mem = process.memoryUsage();
    const conn = mongoose.connection;

    return reply.send({
      timestamp: new Date().toISOString(),
      uptimeS:   Math.floor(process.uptime()),
      memory: {
        heapUsedMB:  Math.round(mem.heapUsed  / 1_048_576),
        heapTotalMB: Math.round(mem.heapTotal / 1_048_576),
        rssMB:       Math.round(mem.rss       / 1_048_576),
        externalMB:  Math.round(mem.external  / 1_048_576),
      },
      mongo: {
        state: conn.readyState,  // 0=disconnected 1=connected 2=connecting 3=disconnecting
        host:  conn.host ?? null,
        name:  conn.name ?? null,
      },
      node: {
        version:  process.version,
        platform: process.platform,
        arch:     process.arch,
        pid:      process.pid,
      },
    });
  });
};

export default healthRoutes;
