import Fastify from 'fastify';
import cors    from '@fastify/cors';
import jwt     from '@fastify/jwt';
import { config } from './config.js';

import firebasePlugin from './plugins/firebase.js';
import mongoPlugin    from './plugins/mongodb.js';
import type { JwtPayload } from '@edge-gym/shared-types';

import healthRoutes       from './routes/health.js';
import authRoutes         from './routes/auth.js';
import memberRoutes       from './routes/members.js';
import membershipRoutes   from './routes/memberships.js';
import edgeSyncRoutes     from './routes/edge-sync.js';
import reportsRoutes      from './routes/reports.js';
import branchRoutes       from './routes/branches.js';
import staffRoutes        from './routes/staff.js';
import productRoutes      from './routes/products.js';
import accessRoutes       from './routes/access.js';
import paymentRoutes      from './routes/payments.js';
import notificationRoutes from './routes/notifications.js';

export async function buildApp() {
  const fastify = Fastify({
    logger: {
      level:     config.LOG_LEVEL,
      transport: config.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    },
  });

  // ── Plugins ──────────────────────────────────────────────────────────────────
  await fastify.register(cors, {
    origin: config.CORS_ORIGINS.split(','),
    credentials: true,
  });

  await fastify.register(jwt, {
    secret:    config.JWT_SECRET,
    namespace: 'api',
  });

  await fastify.register(mongoPlugin);
  await fastify.register(firebasePlugin);

  // ── Auth hook — verify JWT on every request unless skipAuth ─────────────────
  fastify.addHook('onRequest', async (req, reply) => {
    if ((req.routeOptions?.config as { skipAuth?: boolean } | undefined)?.skipAuth) return;

    try {
      await req.jwtVerify();
      req.actor = req.user as JwtPayload;
    } catch {
      return reply.status(401).send({ error: 'Unauthorized', message: 'Valid JWT required' });
    }
  });

  // ── Routes ───────────────────────────────────────────────────────────────────
  const API = '/api/v1';

  await fastify.register(healthRoutes);
  await fastify.register(authRoutes,         { prefix: API });
  await fastify.register(memberRoutes,       { prefix: API });
  await fastify.register(membershipRoutes,   { prefix: API });
  await fastify.register(edgeSyncRoutes,     { prefix: `${API}/edge` });
  await fastify.register(reportsRoutes,      { prefix: `${API}/reports` });
  await fastify.register(branchRoutes,       { prefix: API });
  await fastify.register(staffRoutes,        { prefix: API });
  await fastify.register(productRoutes,      { prefix: API });
  await fastify.register(accessRoutes,       { prefix: API });
  await fastify.register(paymentRoutes,      { prefix: API });
  await fastify.register(notificationRoutes, { prefix: `${API}/notifications` });

  // ── Global error handler ─────────────────────────────────────────────────────
  fastify.setErrorHandler((err, _req, reply) => {
    fastify.log.error(err);
    const status = err.statusCode ?? 500;
    return reply.status(status).send({
      statusCode: status,
      error:      err.name ?? 'Internal Server Error',
      message:    err.message,
    });
  });

  return fastify;
}
