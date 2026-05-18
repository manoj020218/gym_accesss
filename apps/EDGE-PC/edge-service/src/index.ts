import Fastify  from 'fastify';
import { createReadStream } from 'node:fs';
import { readdir, stat }   from 'node:fs/promises';
import { spawn }           from 'node:child_process';
import { writeFile }       from 'node:fs/promises';
import { tmpdir }          from 'node:os';
import path from 'node:path';
import { config } from './config.js';
import { EdgeDB } from './db/sqlite.js';
import { decide } from './access/decision.js';
import { startSyncWorker, syncU5Faces } from './sync/worker.js';
import { U5Adapter } from './hardware/u5/index.js';
import { mqttListener, bridgeListener } from './mqtt/client.js';
import { Zone, AccessDecision } from '@edge-gym/shared-types';
import { z } from 'zod';

const AccessBody = z.object({
  identifierValue: z.string().min(1),
  identifierType:  z.enum(['rfid', 'qr', 'face', 'card', 'manual']),
  zone:            z.nativeEnum(Zone),
});

async function main() {
  const db  = new EdgeDB(config.EDGE_SQLITE_PATH);
  const app = Fastify({
    logger: {
      level:     config.LOG_LEVEL,
      transport: config.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    },
  });

  // Health
  app.get('/health', async (_req, reply) => {
    return reply.send({ status: 'ok', deviceId: config.EDGE_DEVICE_ID, uptime: process.uptime() });
  });

  // Access decision endpoint (called by device adapter / TCP listener)
  app.post<{ Body: z.infer<typeof AccessBody> }>('/access/decide', async (req, reply) => {
    const body = AccessBody.parse(req.body);
    const result = decide(db, body);

    app.log.info({
      decision:  result.decision,
      subject:   result.subjectId,
      zone:      body.zone,
      relay:     result.triggerRelay,
    }, 'Access decision');

    return reply.status(result.decision === AccessDecision.Allow ? 200 : 403).send(result);
  });

  // Face enrollment — cloud API forwards admin's request here; we call the U5 machine.
  //   upload  — imageBase64 provided; we POST it to U5 /insertEmployee
  //   capture — live camera mode (not supported by U5 web API; instruct admin to use upload)
  app.post<{ Body: { memberId: string; memberCode: string; imageBase64?: string; mode?: string; memberName?: string; cardNumber?: string } }>(
    '/enroll-face',
    async (req, reply) => {
      const {
        memberId, memberCode, imageBase64,
        mode = imageBase64 ? 'upload' : 'capture',
        memberName, cardNumber,
      } = req.body ?? {};

      if (!memberId || !memberCode) {
        return reply.status(400).send({ success: false, message: 'memberId and memberCode required' });
      }

      app.log.info({ memberId, memberCode, mode, hasImage: !!imageBase64 }, 'Face enrollment triggered');

      if (!config.U5_MACHINE_IP) {
        app.log.warn('U5_MACHINE_IP not configured — returning simulated success');
        return reply.send({ success: true, memberId, memberCode, mode, message: 'Simulated (no hardware IP configured)' });
      }

      const u5 = new U5Adapter({
        ip:       config.U5_MACHINE_IP,
        port:     config.U5_MACHINE_PORT,
        password: config.U5_MACHINE_PASSWORD,
      });

      if (mode === 'upload') {
        if (!imageBase64) {
          return reply.status(400).send({ success: false, message: 'imageBase64 required for upload mode' });
        }
        // U5 expects a full data URL
        const picLarge = imageBase64.startsWith('data:')
          ? imageBase64
          : `data:image/jpeg;base64,${imageBase64}`;

        const result = await u5.enrollFace({
          idNumber:   memberCode,
          name:       (memberName ?? memberCode).slice(0, 10),
          picLarge,
          cardNumber,
        });

        if (!result.success) {
          app.log.warn({ memberCode, code: result.code, message: result.message }, 'U5 enrollment failed');
          return reply.status(422).send({ success: false, message: result.message });
        }

        app.log.info({ memberCode }, 'U5 face enrolled successfully');
        return reply.send({ success: true, memberId, memberCode, mode, message: 'Face registered on U5 device' });
      }

      // Capture mode: U5's /insertEmployee always needs a pre-supplied photo
      return reply.status(501).send({
        success: false,
        message: 'Live capture not supported by U5 web API — please upload a photo instead',
      });
    },
  );

  // GET /u5/employees — proxy getEmployeeList from the U5 machine
  app.get('/u5/employees', async (_req, reply) => {
    if (!config.U5_MACHINE_IP) {
      return reply.send({ data: [], simulated: true });
    }
    const u5 = new U5Adapter({ ip: config.U5_MACHINE_IP, port: config.U5_MACHINE_PORT, password: config.U5_MACHINE_PASSWORD });
    const result = await u5.getEmployeeList();
    if (!result.success) {
      return reply.status(502).send({ error: result.message });
    }
    // Strip pic_large from list response — it's large and not needed for sync checks
    return reply.send({ data: result.data.map(({ userId, name, id_number }) => ({ userId, name, id_number })) });
  });

  // Sync status
  app.get('/sync/status', async (_req, reply) => {
    const state   = db.getSyncState();
    const pending = db.getPendingEvents(1).length;
    return reply.send({ ...state, hasPending: pending > 0, deviceId: config.EDGE_DEVICE_ID });
  });

  // ── Face file server ──────────────────────────────────────────────────────
  // GET /faces/:memberCode/:filename  — serve specific JPEG
  app.get<{ Params: { memberCode: string; filename: string } }>(
    '/faces/:memberCode/:filename',
    async (req, reply) => {
      const { memberCode, filename } = req.params;
      if (memberCode.includes('..') || filename.includes('..')) {
        return reply.status(400).send({ error: 'Invalid path' });
      }
      const filePath = path.resolve(config.FACE_STORAGE_DIR, memberCode, filename);
      try {
        await stat(filePath);
      } catch {
        return reply.status(404).send({ error: 'Face not found' });
      }
      reply.header('Content-Type', 'image/jpeg');
      reply.header('Cache-Control', 'public, max-age=86400');
      return reply.send(createReadStream(filePath));
    },
  );

  // GET /faces/:memberCode/latest  — serve newest JPEG for a member
  app.get<{ Params: { memberCode: string } }>(
    '/faces/:memberCode/latest',
    async (req, reply) => {
      const { memberCode } = req.params;
      if (memberCode.includes('..')) {
        return reply.status(400).send({ error: 'Invalid path' });
      }
      const dir = path.resolve(config.FACE_STORAGE_DIR, memberCode);
      try {
        const files = await readdir(dir);
        const jpgs  = files.filter(f => f.endsWith('.jpg')).sort();
        if (jpgs.length === 0) return reply.status(404).send({ error: 'No face found' });
        const latest   = jpgs[jpgs.length - 1]!;
        reply.header('Content-Type', 'image/jpeg');
        reply.header('Cache-Control', 'public, max-age=3600');
        return reply.send(createReadStream(path.resolve(dir, latest)));
      } catch {
        return reply.status(404).send({ error: 'No face found' });
      }
    },
  );

  // POST /sync-faces  — triggered by VPS when admin clicks "Sync from machine"
  // Runs face sync in background; returns immediately so the HTTP caller doesn't time out.
  app.post('/sync-faces', async (_req, reply) => {
    reply.send({ queued: true, message: 'Face sync started' });
    syncU5Faces(app.log).catch(e => app.log.error(e, '[faces] syncU5Faces crashed'));
  });

  // POST /machines/u5/open-door
  // Manual guest/visitor door unlock from the desktop operator.
  // Calls the U5 machine's /openDoor HTTP endpoint (firmware must support it).
  // If the machine doesn't expose /openDoor, returns ok:false with a clear message —
  // the desktop UI should then show a manual prompt to the operator.
  app.post('/machines/u5/open-door', async (_req, reply) => {
    if (!config.U5_MACHINE_IP) {
      return reply.status(503).send({ ok: false, error: 'U5_MACHINE_IP not configured' });
    }
    const u5 = new U5Adapter({
      ip:       config.U5_MACHINE_IP,
      port:     config.U5_MACHINE_PORT,
      password: config.U5_MACHINE_PASSWORD,
    });
    const result = await u5.openDoor();
    return reply.send({ ok: result.success, error: result.success ? undefined : result.message });
  });

  // GET /machines/u5/status — quick status for desktop dashboard
  app.get('/machines/u5/status', async (_req, reply) => {
    if (!config.U5_MACHINE_IP) {
      return reply.send({ online: false, reason: 'U5_MACHINE_IP not configured' });
    }
    const u5 = new U5Adapter({ ip: config.U5_MACHINE_IP, port: config.U5_MACHINE_PORT, password: config.U5_MACHINE_PASSWORD });
    const online = await u5.ping();
    let info = null;
    if (online) {
      const v = await u5.getDeviceVersion();
      if (v.success) info = v.info;
    }
    return reply.send({ online, info });
  });

  try {
    await app.listen({ port: config.EDGE_PORT, host: '0.0.0.0' });
    app.log.info(`⚡ EDGE service [${config.EDGE_DEVICE_ID}] listening on :${config.EDGE_PORT}`);
    startSyncWorker(db, app.log);

    // Start Bridge MQTT listener if configured (Wiegand hardware → MQTT)
    if (config.BRIDGE_MQTT_BROKER_URL && config.BRIDGE_MQTT_TOPIC_BASE) {
      bridgeListener.start(
        { brokerUrl: config.BRIDGE_MQTT_BROKER_URL, infoTopic: config.BRIDGE_MQTT_TOPIC_BASE,
          username: config.BRIDGE_MQTT_USERNAME, password: config.BRIDGE_MQTT_PASSWORD },
        db, app.log,
      );
      app.log.info({ topic: `${config.BRIDGE_MQTT_TOPIC_BASE}/attendance` }, '⚡ Bridge MQTT listener started');
    }

    // Spawn FRPC if configured — punches VPN tunnel so VPS can reach this edge PC
    if (config.FRPC_BINARY && config.FRPC_SERVER_ADDR && config.FRPC_TOKEN) {
      void spawnFrpc(app.log);
    }

  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  process.on('SIGTERM', () => { db.close(); process.exit(0); });
}

// ── FRPC auto-tunnel ──────────────────────────────────────────────────────────
// Writes a minimal frpc.toml and spawns the frpc binary.
// VPS then routes /edge/{subdomain}/ to this PC so VPS-triggered enrollments work.
async function spawnFrpc(log: ReturnType<typeof Fastify>['log']): Promise<void> {
  const ini = [
    `serverAddr = "${config.FRPC_SERVER_ADDR}"`,
    `serverPort = ${config.FRPC_SERVER_PORT}`,
    `auth.token = "${config.FRPC_TOKEN}"`,
    '',
    `[[proxies]]`,
    `name = "edge-${config.EDGE_DEVICE_ID}"`,
    `type = "http"`,
    `localPort = ${config.EDGE_PORT}`,
    `subdomain = "${config.FRPC_SUBDOMAIN ?? config.EDGE_DEVICE_ID}"`,
  ].join('\n');

  const iniPath = path.join(tmpdir(), `frpc_${config.EDGE_DEVICE_ID}.toml`);
  await writeFile(iniPath, ini, 'utf8');

  const proc = spawn(config.FRPC_BINARY!, ['-c', iniPath], { stdio: 'pipe' });
  proc.stdout?.on('data', (d: Buffer) => log.debug(`[frpc] ${d.toString().trim()}`));
  proc.stderr?.on('data', (d: Buffer) => log.warn(`[frpc] ${d.toString().trim()}`));
  proc.on('exit', (code) => log.warn({ code }, '[frpc] Process exited — tunnel down'));
  log.info({ iniPath }, '[frpc] Tunnel started');
}

void main();
