import 'dotenv/config';
import { env, readers }       from './config.js';
import { createController }   from './controller.js';
import { startHealthServer }  from './health.js';

const log = {
  info:  (msg: string, obj?: object) => console.info('[INFO]',  msg, obj ?? ''),
  warn:  (msg: string, obj?: object) => console.warn('[WARN]',  msg, obj ?? ''),
  error: (msg: string, obj?: object) => console.error('[ERROR]', msg, obj ?? ''),
};

async function main() {
  log.info(`⚡ Hardware adapter starting — ${readers.length} reader(s) configured`);
  if (env.MOCK_MODE) log.warn('MOCK_MODE=true — no real GPIO will be used');

  const controller = createController({
    edgeServiceUrl: env.EDGE_SERVICE_URL,
    pulseMs:        env.RELAY_PULSE_MS,
    cooldownMs:     env.CARD_COOLDOWN_MS,
    logger:         log,
  });

  // Attach all readers
  const handles = readers.map((cfg) => controller.attachReader(cfg));

  // Health endpoint
  const stopHealth = await startHealthServer(env.HEALTH_PORT, readers, env.LOG_LEVEL);

  // Graceful shutdown
  async function shutdown(signal: string) {
    log.info(`${signal} received — shutting down`);
    await Promise.all(handles.map((h) => h.stop()));
    handles.forEach((h) => h.destroy());
    await stopHealth();
    process.exit(0);
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT',  () => void shutdown('SIGINT'));

  log.info(`Ready. Edge service: ${env.EDGE_SERVICE_URL} | Health: :${env.HEALTH_PORT}/health`);
}

void main();
