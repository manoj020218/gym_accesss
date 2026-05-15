import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { User } from '../models/User.js';
import { config } from '../config.js';
import { StaffRole } from '@edge-gym/shared-types';

const LoginBody = z.object({ idToken: z.string().min(1) });
const RefreshBody = z.object({ refreshToken: z.string().min(1) });

const authRoutes: FastifyPluginAsync = async (fastify) => {

  // POST /auth/seed-login — demo / client handover login without Firebase
  fastify.post<{ Body: { username: string; password: string } }>(
    '/auth/seed-login',
    { config: { skipAuth: true } },
    async (req, reply) => {
      type SeedEntry = { username: string; password: string; role: string; branchIds: string[]; displayName?: string };
      let seeds: SeedEntry[] = [];
      try { seeds = JSON.parse(config.SEED_LOGINS ?? '[]'); } catch { /* empty */ }
      if (seeds.length === 0) return reply.status(404).send({ error: 'Seed login not configured on this server' });

      const { username, password } = req.body ?? {};
      if (!username || !password) return reply.status(400).send({ error: 'username and password required' });

      const match = seeds.find((s) => s.username === username && s.password === password);
      if (!match) return reply.status(401).send({ error: 'Invalid username or password' });

      const payload = {
        sub:         `seed-${username}`,
        email:       `${username.toLowerCase()}@seed.local`,
        role:        match.role,
        branchIds:   match.branchIds,
        permissions: [] as string[],
      };
      const accessToken  = fastify.jwt.sign(payload, { expiresIn: '24h' });
      const refreshToken = fastify.jwt.sign(
        { sub: payload.sub },
        { secret: config.REFRESH_TOKEN_SECRET, expiresIn: config.REFRESH_TOKEN_EXPIRES_IN },
      );
      return reply.send({
        accessToken, refreshToken,
        user: { id: payload.sub, email: payload.email, displayName: match.displayName ?? match.username, role: match.role, branchIds: match.branchIds },
      });
    },
  );

  // POST /auth/dev-login — only active when DEV_SKIP_FIREBASE=true
  if (config.DEV_SKIP_FIREBASE === 'true') {
    fastify.post(
      '/auth/dev-login',
      { config: { skipAuth: true } },
      async (_req, reply) => {
        let user = await User.findOne({ email: 'dev@edgegym.local' });
        if (!user) {
          user = await User.create({
            firebaseUid: 'dev-local-uid',
            email:       'dev@edgegym.local',
            displayName: 'Dev Owner',
            role:        StaffRole.Owner,
            branchIds:   [],
            isActive:    true,
            lastLoginAt: new Date(),
          });
        } else {
          user.lastLoginAt = new Date();
          await user.save();
        }

        const payload = {
          sub:         user.id as string,
          email:       user.email,
          role:        user.role,
          branchIds:   user.branchIds,
          permissions: user.permissions ?? [],
        };
        const accessToken  = fastify.jwt.sign(payload, { expiresIn: config.JWT_EXPIRES_IN });
        const refreshToken = fastify.jwt.sign(
          { sub: user.id },
          { secret: config.REFRESH_TOKEN_SECRET, expiresIn: config.REFRESH_TOKEN_EXPIRES_IN },
        );
        return reply.send({
          accessToken,
          refreshToken,
          user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role, branchIds: user.branchIds },
        });
      },
    );
  }

  // POST /auth/google/login
  // Verify Firebase ID token → issue app JWT + refresh token
  fastify.post<{ Body: z.infer<typeof LoginBody> }>(
    '/auth/google/login',
    { config: { skipAuth: true } },
    async (req, reply) => {
      const { idToken } = LoginBody.parse(req.body);

      let decoded;
      try {
        decoded = await fastify.verifyFirebaseToken(idToken);
      } catch {
        return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid Firebase token' });
      }

      let user = await User.findOne({ firebaseUid: decoded.uid });

      if (!user) {
        user = await User.create({
          firebaseUid:  decoded.uid,
          email:        decoded.email ?? '',
          displayName:  decoded.name ?? decoded.email ?? 'User',
          photoUrl:     decoded.picture,
          role:         StaffRole.Receptionist,
          branchIds:    [],
          lastLoginAt:  new Date(),
        });
      } else {
        user.lastLoginAt = new Date();
        if (decoded.picture) user.photoUrl = decoded.picture;
        await user.save();
      }

      const payload = {
        sub:       user.id as string,
        email:     user.email,
        role:      user.role,
        branchIds: user.branchIds,
      };

      const accessToken  = fastify.jwt.sign(payload, { expiresIn: config.JWT_EXPIRES_IN });
      const refreshToken = fastify.jwt.sign({ sub: user.id }, {
        secret:    config.REFRESH_TOKEN_SECRET,
        expiresIn: config.REFRESH_TOKEN_EXPIRES_IN,
      });

      return reply.send({ accessToken, refreshToken, user: {
        id:          user.id,
        email:       user.email,
        displayName: user.displayName,
        photoUrl:    user.photoUrl,
        role:        user.role,
        branchIds:   user.branchIds,
      }});
    },
  );

  // POST /auth/refresh
  fastify.post<{ Body: z.infer<typeof RefreshBody> }>(
    '/auth/refresh',
    { config: { skipAuth: true } },
    async (req, reply) => {
      const { refreshToken } = RefreshBody.parse(req.body);
      let payload: { sub: string };
      try {
        payload = fastify.jwt.verify<{ sub: string }>(refreshToken, {
          secret: config.REFRESH_TOKEN_SECRET,
        });
      } catch {
        return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid refresh token' });
      }

      const user = await User.findById(payload.sub);
      if (!user || !user.isActive) {
        return reply.status(401).send({ error: 'Unauthorized', message: 'User not found or inactive' });
      }

      const accessToken = fastify.jwt.sign(
        { sub: user.id, email: user.email, role: user.role, branchIds: user.branchIds },
        { expiresIn: config.JWT_EXPIRES_IN },
      );

      return reply.send({ accessToken });
    },
  );

  // GET /auth/me
  fastify.get('/auth/me', async (req, reply) => {
    const user = await User.findById(req.actor.sub);
    if (!user) return reply.status(404).send({ error: 'Not Found' });
    return reply.send({ id: user.id, email: user.email, displayName: user.displayName, role: user.role, branchIds: user.branchIds });
  });
};

export default authRoutes;
