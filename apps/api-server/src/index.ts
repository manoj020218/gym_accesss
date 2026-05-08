import { buildApp } from './app.js';
import { config }   from './config.js';
import { startWorker } from './worker/index.js';

async function main() {
  const app = await buildApp();

  try {
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
    app.log.info(`⚡ EDGE GYM API listening on :${config.PORT}`);
    startWorker(app.log);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();
