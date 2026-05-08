import { z } from 'zod';

const Env = z.object({
  NODE_ENV:              z.enum(['development','production']).default('development'),
  LOG_LEVEL:             z.enum(['trace','debug','info','warn','error','fatal']).default('info'),
  EDGE_DEVICE_ID:        z.string().min(1),
  EDGE_BRANCH_ID:        z.string().min(1),
  EDGE_PORT:             z.coerce.number().default(8090),
  EDGE_SYNC_BASE_URL:    z.string().url(),
  EDGE_SHARED_SECRET:    z.string().min(16),
  EDGE_SQLITE_PATH:      z.string().default('./data/edge.db'),
  EDGE_SYNC_INTERVAL_MS: z.coerce.number().default(30_000),
  EDGE_HEARTBEAT_INTERVAL_MS: z.coerce.number().default(60_000),
});

const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  console.error('❌  Invalid edge environment:\n', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
