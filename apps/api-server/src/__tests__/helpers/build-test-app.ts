import Fastify, { type FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import type { JwtPayload } from '@edge-gym/shared-types';
import type admin from 'firebase-admin';

import healthRoutes       from '../../routes/health.js';
import authRoutes         from '../../routes/auth.js';
import memberRoutes       from '../../routes/members.js';
import membershipRoutes   from '../../routes/memberships.js';
import edgeSyncRoutes     from '../../routes/edge-sync.js';
import reportsRoutes      from '../../routes/reports.js';
import branchRoutes       from '../../routes/branches.js';
import staffRoutes        from '../../routes/staff.js';
import productRoutes      from '../../routes/products.js';
import accessRoutes       from '../../routes/access.js';
import paymentRoutes      from '../../routes/payments.js';
import notificationRoutes from '../../routes/notifications.js';

const API = '/api/v1';

// No-op firebase plugin so fastify.firebase is decorated but never used in tests
const mockFirebasePlugin = fp(async (fastify: FastifyInstance) => {
  fastify.decorate('firebase', null as unknown as admin.app.App);
  fastify.decorate('verifyFirebaseToken', async (_token: string) => {
    throw new Error('Firebase not available in test environment');
  });
}, { name: 'firebase' });

export async function buildTestApp(): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: false });

  await fastify.register(cors, { origin: true });
  await fastify.register(jwt, { secret: process.env['JWT_SECRET']!, namespace: 'api' });
  await fastify.register(mockFirebasePlugin);

  // Same auth hook as the real app
  fastify.addHook('onRequest', async (req, reply) => {
    if ((req.routeOptions?.config as { skipAuth?: boolean } | undefined)?.skipAuth) return;
    try {
      await req.jwtVerify();
      req.actor = req.user as JwtPayload;
    } catch {
      return reply.status(401).send({ error: 'Unauthorized', message: 'Valid JWT required' });
    }
  });

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

  await fastify.ready();
  return fastify;
}
