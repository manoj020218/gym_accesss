import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import admin from 'firebase-admin';
import { config } from '../config.js';

declare module 'fastify' {
  interface FastifyInstance {
    firebase: admin.app.App;
    verifyFirebaseToken(idToken: string): Promise<admin.auth.DecodedIdToken>;
  }
}

const firebasePlugin: FastifyPluginAsync = async (fastify) => {
  if (config.DEV_SKIP_FIREBASE === 'true') {
    fastify.decorate('firebase', null as any);
    fastify.decorate('verifyFirebaseToken', async (_idToken: string) => {
      throw new Error('Firebase auth disabled in dev mode — use POST /api/v1/auth/dev-login');
    });
    fastify.log.warn('⚠️  Firebase plugin SKIPPED (DEV_SKIP_FIREBASE=true)');
    return;
  }

  const app = admin.initializeApp({
    credential: admin.credential.cert({
      projectId:   config.FIREBASE_PROJECT_ID,
      clientEmail: config.FIREBASE_CLIENT_EMAIL,
      privateKey:  config.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
  });

  fastify.decorate('firebase', app);
  fastify.decorate('verifyFirebaseToken', async (idToken: string) => {
    return admin.auth().verifyIdToken(idToken);
  });
};

export default fp(firebasePlugin, { name: 'firebase' });
