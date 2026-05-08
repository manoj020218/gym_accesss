import admin from 'firebase-admin';
import { config } from '../config.js';

export function getAdminApp(): admin.app.App {
  return admin.apps[0] ?? admin.initializeApp({
    credential: admin.credential.cert({
      projectId:   config.FIREBASE_PROJECT_ID,
      clientEmail: config.FIREBASE_CLIENT_EMAIL,
      privateKey:  config.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
  });
}

export async function fcmSendToToken(
  app: admin.app.App,
  token: string,
  title: string,
  body: string,
  data?: Record<string, string>,
): Promise<string> {
  return admin.messaging(app).send({
    token,
    notification: { title, body },
    data,
    android: { priority: 'high' },
  });
}

export async function fcmSendMulticast(
  app: admin.app.App,
  tokens: string[],
  title: string,
  body: string,
  data?: Record<string, string>,
): Promise<{ successCount: number; failureCount: number }> {
  if (tokens.length === 0) return { successCount: 0, failureCount: 0 };
  return admin.messaging(app).sendEachForMulticast({
    tokens,
    notification: { title, body },
    data,
    android: { priority: 'high' },
  });
}
