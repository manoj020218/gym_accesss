import { z } from 'zod';
import { readFileSync } from 'node:fs';

const EnvSchema = z.object({
  EDGE_SERVICE_URL: z.string().url().default('http://localhost:8091'),
  HEALTH_PORT:      z.coerce.number().default(8092),
  READERS_CONFIG:   z.string().default('./readers.config.json'),
  RELAY_PULSE_MS:   z.coerce.number().min(50).max(10_000).default(500),
  CARD_COOLDOWN_MS: z.coerce.number().min(500).default(3000),
  MOCK_MODE:        z.string().transform((v) => v === 'true').default('false'),
  LOG_LEVEL:        z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  NODE_ENV:         z.enum(['production', 'development', 'test']).default('production'),
});

// ── Reader config schemas ────────────────────────────────────────────────────

const WiegandOpts = z.object({
  d0Pin:     z.number().int(),
  d1Pin:     z.number().int(),
  bitFormat: z.union([z.literal(26), z.literal(34)]).default(26),
});

const SerialOpts = z.object({
  path:      z.string(),                                    // e.g. /dev/ttyUSB0
  baudRate:  z.number().int().default(9600),
  delimiter: z.string().default('\n'),
  format:    z.enum(['hex', 'decimal', 'ascii']).default('ascii'),
});

const TcpOpts = z.object({
  host:     z.string(),                                     // reader IP
  port:     z.number().int(),
  protocol: z.enum(['raw', 'zkteco']).default('raw'),
  reconnectMs: z.number().int().default(5000),
});

const MockOpts = z.object({
  intervalMs: z.number().int().default(8000),               // ms between simulated scans
  cards:      z.array(z.string()).default(['AABBCCDD', '11223344']),
});

export const ReaderConfigSchema = z.object({
  name:         z.string(),
  type:         z.enum(['wiegand', 'serial', 'tcp', 'mock']),
  zone:         z.string(),
  relayPin:     z.number().int(),
  ledGreenPin:  z.number().int().optional(),
  ledRedPin:    z.number().int().optional(),
  buzzerPin:    z.number().int().optional(),
  options:      z.union([WiegandOpts, SerialOpts, TcpOpts, MockOpts]),
});

export type ReaderConfig    = z.infer<typeof ReaderConfigSchema>;
export type WiegandOptions  = z.infer<typeof WiegandOpts>;
export type SerialOptions   = z.infer<typeof SerialOpts>;
export type TcpOptions      = z.infer<typeof TcpOpts>;
export type MockOptions      = z.infer<typeof MockOpts>;

// ── Parse ────────────────────────────────────────────────────────────────────

function parseEnv() {
  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    console.error('[config] Invalid environment:\n' + result.error.toString());
    process.exit(1);
  }
  return result.data;
}

function parseReadersConfig(path: string, mockMode: boolean): ReaderConfig[] {
  if (mockMode) {
    return [{
      name: 'mock-entrance',
      type: 'mock',
      zone: 'MAIN_FLOOR',
      relayPin: -1,
      options: { intervalMs: 8000, cards: ['AABBCCDD', '11223344', 'DEADBEEF'] },
    }];
  }

  try {
    const raw     = readFileSync(path, 'utf-8');
    const parsed  = JSON.parse(raw) as unknown;
    const readers = z.array(ReaderConfigSchema).parse(parsed);
    if (readers.length === 0) throw new Error('readers.config.json is empty');
    return readers;
  } catch (e) {
    console.error(`[config] Failed to load readers config from "${path}": ${(e as Error).message}`);
    console.error('[config] Copy readers.config.example.json → readers.config.json and edit it.');
    process.exit(1);
  }
}

export const env     = parseEnv();
export const readers = parseReadersConfig(env.READERS_CONFIG, env.MOCK_MODE);
