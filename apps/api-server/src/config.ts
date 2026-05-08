import { z } from 'zod';

const Env = z.object({
  NODE_ENV:                  z.enum(['development', 'test', 'production']).default('development'),
  PORT:                      z.coerce.number().default(8080),
  LOG_LEVEL:                 z.enum(['trace','debug','info','warn','error','fatal']).default('info'),
  MONGODB_URI:               z.string().min(1),
  JWT_SECRET:                z.string().min(32),
  JWT_EXPIRES_IN:            z.string().default('15m'),
  REFRESH_TOKEN_SECRET:      z.string().min(32),
  REFRESH_TOKEN_EXPIRES_IN:  z.string().default('30d'),
  CORS_ORIGINS:              z.string().default('http://localhost:5173'),
  FIREBASE_PROJECT_ID:       z.string().min(1),
  FIREBASE_CLIENT_EMAIL:     z.string().email(),
  FIREBASE_PRIVATE_KEY:      z.string().min(1),
  FCM_SERVER_KEY:            z.string().optional(),
  EDGE_SHARED_SECRET:        z.string().min(16),
});

const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  console.error('❌  Invalid environment variables:\n', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;
