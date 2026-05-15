import { z } from 'zod';

const Env = z.object({
  NODE_ENV:                  z.enum(['development', 'test', 'production']).default('development'),
  DEV_SKIP_FIREBASE:         z.enum(['true', 'false']).default('false'),
  PORT:                      z.coerce.number().default(8080),
  LOG_LEVEL:                 z.enum(['trace','debug','info','warn','error','fatal']).default('info'),
  MONGODB_URI:               z.string().min(1).default('mongodb://localhost:27017/edge_gym'),
  JWT_SECRET:                z.string().min(32),
  JWT_EXPIRES_IN:            z.string().default('15m'),
  REFRESH_TOKEN_SECRET:      z.string().min(32),
  REFRESH_TOKEN_EXPIRES_IN:  z.string().default('30d'),
  CORS_ORIGINS:              z.string().default('http://localhost:5173'),
  FIREBASE_PROJECT_ID:       z.string().min(1).default('dev-project'),
  FIREBASE_CLIENT_EMAIL:     z.string().email().default('dev@dev-project.iam.gserviceaccount.com'),
  FIREBASE_PRIVATE_KEY:      z.string().min(1).default('dev-placeholder-key'),
  FCM_SERVER_KEY:            z.string().optional(),
  EDGE_SHARED_SECRET:        z.string().min(16),
  // Seed logins — JSON array of {username,password,role,branchIds,displayName}
  SEED_LOGINS:               z.string().optional(),
  // Backup / Update pipeline
  BACKUP_DIR:                z.string().default('./backups'),
  RELEASES_URL:              z.string().default('https://smartgym.iotsoft.in/releases/latest.json'),
  UPDATE_SCRIPT:             z.string().default('./scripts/update.sh'),
});

const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  console.error('❌  Invalid environment variables:\n', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;
