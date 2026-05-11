import Fastify from 'fastify';
import cors    from '@fastify/cors';
import jwt     from '@fastify/jwt';
import { WebSocketServer } from 'ws';
import { config } from './config.js';
import { broadcaster } from './lib/event-broadcaster.js';

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
import memberPlanRoutes   from './routes/member-plans.js';

export async function buildApp() {
  const fastify = Fastify({
    bodyLimit: 10 * 1024 * 1024, // 10 MB — allows face photo base64 payloads
    logger: {
      level:     config.LOG_LEVEL,
      transport: config.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    },
  });

  // ── Plugins ──────────────────────────────────────────────────────────────────
  await fastify.register(cors, {
    // In dev mode reflect any origin; in production restrict to CORS_ORIGINS list
    origin: config.DEV_SKIP_FIREBASE === 'true' ? true : config.CORS_ORIGINS.split(','),
    credentials: true,
  });

  await fastify.register(jwt, {
    secret: config.JWT_SECRET,
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
  await fastify.register(memberPlanRoutes,   { prefix: API });

  // ── Global error handler ─────────────────────────────────────────────────────
  fastify.setErrorHandler((err, _req, reply) => {
    fastify.log.error(err);
    const isZodError = err.name === 'ZodError';
    const status = isZodError ? 400 : (err.statusCode ?? 500);
    return reply.status(status).send({
      statusCode: status,
      error:      isZodError ? 'Validation Error' : (err.name ?? 'Internal Server Error'),
      message:    err.message,
    });
  });

  // ── WebSocket server — real-time event push to browser ───────────────────────
  // Clients connect at ws(s)://<host>/api/v1/ws?token=<JWT>
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws) => {
    broadcaster.add(ws);
    fastify.log.debug('[ws] Client connected — total: ' + broadcaster.clientCount);

    const ping = setInterval(() => {
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'ping' }));
    }, 25_000);

    ws.on('close',  () => { broadcaster.remove(ws); clearInterval(ping); });
    ws.on('error',  () => { broadcaster.remove(ws); clearInterval(ping); });
  });

  fastify.server.on('upgrade', (req, socket, head) => {
    const url   = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/api/v1/ws') {
      socket.destroy();
      return;
    }
    const token = url.searchParams.get('token');
    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    try {
      fastify.jwt.verify(token);
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    } catch {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
    }
  });

  return fastify;
}
