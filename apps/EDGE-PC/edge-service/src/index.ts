import Fastify, { type FastifyRequest, type FastifyReply } from 'fastify';
import fastifyStatic from '@fastify/static';
import jwt from 'jsonwebtoken';
import { createReadStream } from 'node:fs';
import { readdir, stat, mkdir } from 'node:fs/promises';
import { spawn }                from 'node:child_process';
import { writeFile }            from 'node:fs/promises';
import { tmpdir }          from 'node:os';
import { fileURLToPath }   from 'node:url';
import crypto, { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { config } from './config.js';
import { EdgeDB } from './db/sqlite.js';
import { decide } from './access/decision.js';
import { startSyncWorker, syncU5Faces } from './sync/worker.js';
import { U5Adapter } from './hardware/u5/index.js';
import { mqttListener, bridgeListener } from './mqtt/client.js';
import { Zone, AccessDecision } from '@edge-gym/shared-types';
import { z } from 'zod';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Save a punch/scan photo to disk.
 * Stores at: {faceStorageDir}/{folderName}/punch_{YYYYMMDD_HHmmss}.jpg
 * Returns the relative path "folderName/filename" for use in /faces/:memberCode/:filename.
 * pic may be raw base64 or a "data:image/jpeg;base64,..." data URL.
 */
async function savePunchPhoto(
  faceStorageDir: string,
  folderName: string,
  eventTime: string,
  pic: string,
): Promise<string | undefined> {
  try {
    const dir = path.resolve(faceStorageDir, folderName);
    await mkdir(dir, { recursive: true });
    // Timestamp: "2026-05-19 14:30:22" → "20260519_143022"
    const ts = eventTime.replace(/[^0-9]/g, '').slice(0, 14);
    const filename  = `punch_${ts}.jpg`;
    const filepath  = path.resolve(dir, filename);
    const base64    = pic.includes(',') ? pic.split(',')[1]! : pic;
    await writeFile(filepath, Buffer.from(base64, 'base64'));
    return `${folderName}/${filename}`;
  } catch {
    return undefined;
  }
}

function hashPassword(password: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

function verifyPassword(password: string, hash: string, salt: string): boolean {
  try {
    const hashBuf    = Buffer.from(hash, 'hex');
    const derivedBuf = scryptSync(password, salt, 64);
    return timingSafeEqual(hashBuf, derivedBuf);
  } catch {
    return false;
  }
}

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

  const jwtSecret = config.LOCAL_JWT_SECRET ?? config.EDGE_SHARED_SECRET;

  // ── Local admin static files ──────────────────────────────────────────────
  // Serve the React build from local-admin/dist/ at /admin/
  // Only registered if the build output exists (skipped in bare dev installs).
  // Serve local-admin SPA (HashRouter — no server-side SPA fallback needed).
  // /admin/ → index.html  |  /admin/assets/* → static bundles
  const adminDist = path.resolve(__dirname, '../../local-admin/dist');
  try {
    await stat(adminDist);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (app as any).register(fastifyStatic, {
      root:      adminDist,
      prefix:    '/admin',
      decorateReply: true,
      index:     'index.html',
    });
    app.log.info('[admin] Local admin UI available at http://localhost:' + config.EDGE_PORT + '/admin/');
  } catch {
    app.log.info('[admin] local-admin/dist not found — run: cd apps/EDGE-PC/local-admin && pnpm build');
  }

  // ── Local admin auth routes ───────────────────────────────────────────────
  app.post<{ Body: { username?: string; password?: string } }>(
    '/local/auth/login',
    { schema: { body: {} } },
    async (req, reply) => {
      const { username = '', password = '' } = req.body ?? {};
      if (!username || !password) {
        return reply.status(400).send({ error: 'username and password required' });
      }
      const user = db.getAdminUser(username);
      if (!user || !verifyPassword(password, user.passwordHash, user.passwordSalt)) {
        return reply.status(401).send({ error: 'Invalid credentials' });
      }
      const token = jwt.sign({ sub: user.username, role: user.role }, jwtSecret, { expiresIn: '12h' });
      return reply.send({ token, username: user.username, role: user.role });
    },
  );

  app.get('/local/auth/me', async (req, reply) => {
    const raw = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!raw) return reply.status(401).send({ error: 'Unauthorized' });
    try {
      const payload = jwt.verify(raw, jwtSecret) as { sub: string; role: string };
      return reply.send({ username: payload.sub, role: payload.role });
    } catch {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  });

  // JWT guard — preHandler for protected local routes
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const requireAuth = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const raw = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!raw) { return reply.status(401).send({ error: 'Unauthorized' }); }
    try { jwt.verify(raw, jwtSecret); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ph = { preHandler: requireAuth as any };

  // ── Local stats ───────────────────────────────────────────────────────────
  app.get('/local/stats', ph, async (_req, reply) => {
    return reply.send(db.getStats());
  });

  // ── Local events ──────────────────────────────────────────────────────────
  app.get<{ Querystring: { page?: string; limit?: string; decision?: string; zone?: string; subjectId?: string } }>(
    '/local/events',
    ph,
    async (req, reply) => {
      const page  = Math.max(1, parseInt(req.query.page  ?? '1',  10) || 1);
      const limit = Math.min(100, Math.max(10, parseInt(req.query.limit ?? '50', 10) || 50));
      const opts: { page: number; limit: number; decision?: string; zone?: string; subjectId?: string } = { page, limit };
      if (req.query.decision)  opts.decision  = req.query.decision;
      if (req.query.zone)      opts.zone      = req.query.zone;
      if (req.query.subjectId) opts.subjectId = req.query.subjectId;
      return reply.send(db.getEvents(opts));
    },
  );

  // ── Local members ─────────────────────────────────────────────────────────
  app.get<{ Querystring: { page?: string; limit?: string } }>(
    '/local/members',
    ph,
    async (req, reply) => {
      const page  = Math.max(1, parseInt(req.query.page  ?? '1',  10) || 1);
      const limit = Math.min(100, Math.max(10, parseInt(req.query.limit ?? '50', 10) || 50));
      return reply.send(db.getMembers({ page, limit }));
    },
  );

  // ── Full Members CRUD (EDGE-FIRST) ────────────────────────────────────────
  app.get<{ Querystring: { page?: string; limit?: string; search?: string; status?: string } }>(
    '/local/members/full', ph,
    async (req, reply) => {
      const page   = Math.max(1, parseInt(req.query.page  ?? '1',  10) || 1);
      const limit  = Math.min(100, Math.max(10, parseInt(req.query.limit ?? '30', 10) || 30));
      const search = req.query.search || undefined;
      const status = req.query.status || undefined;
      return reply.send(db.getFullMembers({ page, limit, search, status }));
    },
  );

  app.get<{ Params: { id: string } }>('/local/members/full/:id', ph, async (req, reply) => {
    const m = db.getFullMember(req.params.id);
    if (!m) return reply.status(404).send({ error: 'Not found' });
    return reply.send(m);
  });

  app.post<{ Body: Record<string, unknown> }>('/local/members/full', ph, async (req, reply) => {
    const b = req.body;
    const id = crypto.randomUUID();
    const memberCode = (b['memberCode'] as string) || `M${Date.now()}`;
    db.createFullMember({
      id, memberCode,
      firstName:   (b['firstName']  as string) || 'Unknown',
      lastName:    (b['lastName']   as string) || '',
      phone:       (b['phone']      as string) || '',
      email:       b['email']       as string | undefined,
      status:      (b['status']     as string) || 'active',
      activeUntil: b['activeUntil'] as string | undefined,
      planType:    (b['planType']   as string) || 'basic',
      rfidCardId:  b['rfidCardId']  as string | undefined,
      qrToken:     b['qrToken']     as string | undefined,
      notes:       b['notes']       as string | undefined,
    });
    return reply.status(201).send({ id, memberCode });
  });

  app.put<{ Params: { id: string }; Body: Record<string, unknown> }>('/local/members/full/:id', ph, async (req, reply) => {
    const b = req.body;
    db.updateFullMember(req.params.id, {
      firstName:   b['firstName']   as string,
      lastName:    b['lastName']    as string,
      phone:       b['phone']       as string,
      email:       b['email']       as string,
      status:      b['status']      as string,
      activeUntil: b['activeUntil'] as string,
      planType:    b['planType']    as string,
      rfidCardId:  b['rfidCardId']  as string,
      qrToken:     b['qrToken']     as string,
      notes:       b['notes']       as string,
    });
    return reply.send({ ok: true });
  });

  app.delete<{ Params: { id: string } }>('/local/members/full/:id', ph, async (req, reply) => {
    db.deleteFullMember(req.params.id);
    return reply.send({ ok: true });
  });

  // ── Full Staff CRUD (EDGE-FIRST) ──────────────────────────────────────────
  app.get<{ Querystring: { page?: string; limit?: string; search?: string } }>(
    '/local/staff/full', ph,
    async (req, reply) => {
      const page  = Math.max(1, parseInt(req.query.page  ?? '1',  10) || 1);
      const limit = Math.min(100, Math.max(10, parseInt(req.query.limit ?? '30', 10) || 30));
      return reply.send(db.getFullStaff({ page, limit, search: req.query.search || undefined }));
    },
  );

  app.get<{ Params: { id: string } }>('/local/staff/full/:id', ph, async (req, reply) => {
    const row = db.getStaffById(req.params.id);
    if (!row) return reply.status(404).send({ error: 'Not Found' });
    return reply.send(row);
  });

  app.post<{ Body: Record<string, unknown> }>('/local/staff/full', ph, async (req, reply) => {
    const b = req.body;
    const id = crypto.randomUUID();
    // Accept both firstName+lastName and name
    const firstName = (b['firstName'] as string) || '';
    const lastName  = (b['lastName']  as string) || '';
    const fullName  = (b['name'] as string) || (firstName + ' ' + lastName).trim() || 'Unknown';
    db.createFullStaff({
      id, name: fullName,
      phone:      b['phone']      as string | undefined,
      email:      b['email']      as string | undefined,
      role:       (b['role']      as string) || 'trainer',
      shiftStart: (b['shiftStart'] as string) || '09:00',
      shiftEnd:   (b['shiftEnd']   as string) || '18:00',
      rfidCardId: b['rfidCardId'] as string | undefined,
    });
    return reply.status(201).send({ id, _id: id });
  });

  app.put<{ Params: { id: string }; Body: Record<string, unknown> }>('/local/staff/full/:id', ph, async (req, reply) => {
    const b = req.body;
    const firstName = (b['firstName'] as string) || '';
    const lastName  = (b['lastName']  as string) || '';
    const fullName  = (b['name'] as string) || (firstName + ' ' + lastName).trim() || undefined;
    db.updateFullStaff(req.params.id, {
      name:       fullName,
      phone:      b['phone']      as string,
      email:      b['email']      as string,
      role:       b['role']       as string,
      shiftStart: b['shiftStart'] as string,
      shiftEnd:   b['shiftEnd']   as string,
      rfidCardId: b['rfidCardId'] as string,
      isActive:   b['isActive']   as boolean,
    });
    return reply.send({ ok: true });
  });

  app.delete<{ Params: { id: string } }>('/local/staff/full/:id', ph, async (req, reply) => {
    db.deleteFullStaff(req.params.id);
    return reply.send({ ok: true });
  });

  // ── Products CRUD ─────────────────────────────────────────────────────────
  app.get<{ Querystring: { page?: string; limit?: string } }>('/local/products', ph, async (req, reply) => {
    const page  = Math.max(1, parseInt(req.query.page  ?? '1',  10) || 1);
    const limit = Math.min(100, Math.max(10, parseInt(req.query.limit ?? '30', 10) || 30));
    return reply.send(db.getProducts({ page, limit }));
  });

  app.get<{ Params: { id: string } }>('/local/products/:id', ph, async (req, reply) => {
    const row = db.getProductById(Number(req.params.id));
    if (!row) return reply.status(404).send({ error: 'Not Found' });
    return reply.send(row);
  });

  app.post<{ Body: Record<string, unknown> }>('/local/products', ph, async (req, reply) => {
    const b  = req.body;
    const id = db.createProduct({
      name:         (b['name']     as string) || 'Product',
      sku:          b['sku']       as string | undefined,
      category:     b['category']  as string | undefined,
      price:        Number(b['price']) || 0,
      costPrice:    b['costPrice'] !== undefined ? Number(b['costPrice']) : undefined,
      stockQty:     b['stockQty']  !== undefined ? Number(b['stockQty']) : 0,
      minStockLevel: b['minStockLevel'] !== undefined ? Number(b['minStockLevel']) : 5,
      gstIncluded:  Boolean(b['gstIncluded']),
      broadcast:    Boolean(b['broadcast']),
    });
    return reply.status(201).send({ id });
  });

  app.put<{ Params: { id: string }; Body: Record<string, unknown> }>('/local/products/:id', ph, async (req, reply) => {
    const b = req.body;
    const patch: Parameters<typeof db.updateProduct>[1] = {};
    if (b['name']         !== undefined) patch.name         = b['name']         as string;
    if (b['sku']          !== undefined) patch.sku          = b['sku']          as string;
    if (b['category']     !== undefined) patch.category     = b['category']     as string;
    if (b['price']        !== undefined) patch.price        = Number(b['price']);
    if (b['costPrice']    !== undefined) patch.costPrice    = Number(b['costPrice']);
    if (b['stockQty']     !== undefined) patch.stockQty     = Number(b['stockQty']);
    if (b['minStockLevel'] !== undefined) patch.minStockLevel = Number(b['minStockLevel']);
    if (b['gstIncluded']  !== undefined) patch.gstIncluded  = b['gstIncluded']  as boolean;
    if (b['isActive']     !== undefined) patch.isActive     = b['isActive']     as boolean;
    if (b['broadcast']    !== undefined) patch.broadcast    = b['broadcast']    as boolean;
    db.updateProduct(Number(req.params.id), patch);
    return reply.send({ ok: true });
  });

  app.delete<{ Params: { id: string } }>('/local/products/:id', ph, async (req, reply) => {
    db.deleteProduct(Number(req.params.id));
    return reply.send({ ok: true });
  });

  // ── Billing ───────────────────────────────────────────────────────────────
  app.get<{ Querystring: { mode?: string } }>('/local/billing/summary', ph, async (req, reply) => {
    return reply.send(db.getBillingSummary(req.query.mode || undefined));
  });

  app.get<{ Querystring: { page?: string; limit?: string; mode?: string } }>('/local/billing', ph, async (req, reply) => {
    const page  = Math.max(1, parseInt(req.query.page  ?? '1',  10) || 1);
    const limit = Math.min(100, Math.max(10, parseInt(req.query.limit ?? '30', 10) || 30));
    return reply.send(db.getBilling({ page, limit, mode: req.query.mode || undefined }));
  });

  app.post<{ Body: Record<string, unknown> }>('/local/billing', ph, async (req, reply) => {
    const b  = req.body;
    const id = db.createBilling({
      memberId:   b['memberId']   as string | undefined,
      memberName: b['memberName'] as string | undefined,
      amount:     Number(b['amount']) || 0,
      mode:       (b['mode']     as string) || 'cash',
      purpose:    b['purpose']   as string | undefined,
    });
    return reply.status(201).send({ id });
  });

  // ── Plans ────────────────────────────────────────────────────────────────
  app.get('/local/plans', ph, async (_req, reply) => {
    return reply.send(db.getPlans());
  });

  app.post<{ Body: Record<string, unknown> }>('/local/plans', ph, async (req, reply) => {
    const b = req.body;
    const id = db.createPlan({
      name:          (b['name'] as string) || 'Plan',
      planType:      (b['planType'] as string) || 'basic',
      durationValue: Number(b['durationValue']) || 1,
      durationUnit:  (b['durationUnit'] as string) || 'month',
      price:         Number(b['price']) || 0,
      gstPercent:    Number(b['gstPercent']) || 0,
      allowedZones:  (b['allowedZones'] as string[]) || ['main_entry'],
    });
    const plan = db.getPlans().find(p => p['id'] === id)!;
    return reply.status(201).send(plan);
  });

  app.delete<{ Params: { id: string } }>('/local/plans/:id', ph, async (req, reply) => {
    db.deletePlan(Number(req.params.id));
    return reply.send({ ok: true });
  });

  // ── Memberships ───────────────────────────────────────────────────────────
  app.get<{ Querystring: { memberId?: string } }>('/local/memberships', ph, async (req, reply) => {
    const { memberId } = req.query;
    if (!memberId) return reply.status(400).send({ error: 'memberId required' });
    return reply.send(db.getMembershipsForMember(memberId));
  });

  app.post<{ Body: Record<string, unknown> }>('/local/memberships', ph, async (req, reply) => {
    const b = req.body;
    const memberId  = b['memberId'] as string;
    const planType  = (b['planType']  as string) || 'basic';
    const planName  = (b['planName']  as string) || planType;
    const startDate = new Date((b['startDate'] as string) || Date.now()).toISOString();
    // Calculate endDate from duration if not provided
    let endDate = b['endDate'] as string | undefined;
    if (!endDate) {
      const dv = Number(b['durationValue']) || 1;
      const du = (b['durationUnit'] as string) || 'month';
      const end = new Date(startDate);
      if (du === 'year')       end.setFullYear(end.getFullYear() + dv);
      else if (du === 'month') end.setMonth(end.getMonth() + dv);
      else                     end.setDate(end.getDate() + dv);
      endDate = end.toISOString();
    }
    const membershipId = db.createMembership({
      memberId, planId: b['planId'] ? Number(b['planId']) : null,
      planType, planName, startDate, endDate,
      paymentMode: (b['paymentMode'] as string) || 'cash',
      amountPaid:  Number(b['amountPaid']) || 0,
      discount:    Number(b['discount']) || 0,
    });
    // Auto-create billing record
    const memberName = b['memberName'] as string | undefined;
    if (Number(b['amountPaid']) > 0) {
      db.createBilling({ memberId, memberName, amount: Number(b['amountPaid']), mode: (b['paymentMode'] as string) || 'cash', purpose: `Membership: ${planName}` });
    }
    return reply.status(201).send({ id: membershipId });
  });

  // ── Machines ──────────────────────────────────────────────────────────────
  app.get('/local/machines', ph, async (_req, reply) => {
    const rows = db.getMachines();
    // Quick ping each machine (short timeout — LAN only)
    const result = await Promise.all(rows.map(async (m) => {
      const u5 = new U5Adapter({ ip: m['ip_address'] as string, port: m['port'] as number || 80, password: m['password'] as string || '123456', timeoutMs: 3000 });
      const online = await u5.ping().catch(() => false);
      if (online) db.updateMachineSeen(m['id'] as number);
      return { ...m, online };
    }));
    return reply.send(result);
  });

  app.post<{ Body: Record<string, unknown> }>('/local/machines', ph, async (req, reply) => {
    const b  = req.body;
    const ip = (b['ipAddress'] as string) || '';
    if (!ip) return reply.status(400).send({ error: 'ipAddress required' });
    const port     = Number(b['port']) || 80;
    const password = (b['password'] as string) || '123456';
    const u5       = new U5Adapter({ ip, port, password, timeoutMs: 5000 });
    const online   = await u5.ping().catch(() => false);
    let sn: string | undefined;
    if (online) {
      const v = await u5.getDeviceVersion().catch(() => null);
      if (v?.success) sn = v.info.sn;
    }
    const id = db.createMachine({ name: (b['name'] as string) || 'Access Machine', zone: (b['zone'] as string) || 'main_entry', ipAddress: ip, port, password });
    if (sn) db.updateMachineSeen(id, sn);
    return reply.status(201).send({ id, online, sn });
  });

  app.delete<{ Params: { id: string } }>('/local/machines/:id', ph, async (req, reply) => {
    db.deleteMachine(Number(req.params.id));
    return reply.send({ ok: true });
  });

  app.post<{ Params: { id: string } }>('/local/machines/:id/ping', ph, async (req, reply) => {
    const rows    = db.getMachines();
    const machine = rows.find(m => m['id'] === Number(req.params.id));
    if (!machine) return reply.status(404).send({ error: 'Machine not found' });
    const u5     = new U5Adapter({ ip: machine['ip_address'] as string, port: machine['port'] as number || 80, password: machine['password'] as string || '123456', timeoutMs: 5000 });
    const online = await u5.ping().catch(() => false);
    if (online) db.updateMachineSeen(machine['id'] as number);
    return reply.send({ online });
  });

  // ── Reports ───────────────────────────────────────────────────────────────
  app.get<{ Querystring: { days?: string } }>('/local/reports/daily', ph, async (req, reply) => {
    const days = Math.min(90, parseInt(req.query.days ?? '30', 10) || 30);
    return reply.send(db.getDailyCollection({ days }));
  });

  app.get<{ Querystring: { days?: string } }>('/local/reports/expiring', ph, async (req, reply) => {
    const days = Math.min(30, parseInt(req.query.days ?? '7', 10) || 7);
    return reply.send(db.getExpiringMembers(days));
  });

  // ── Settings ──────────────────────────────────────────────────────────────
  app.get('/local/settings', ph, async (_req, reply) => {
    return reply.send(db.getSettings());
  });

  app.put<{ Body: Record<string, string> }>('/local/settings', ph, async (req, reply) => {
    const b = req.body;
    for (const [key, value] of Object.entries(b)) {
      if (typeof value === 'string') db.setDeviceConfig(key, value);
    }
    return reply.send({ ok: true });
  });

  // ── Google auth (Firebase ID token → local JWT) ───────────────────────────
  app.post<{ Body: { idToken?: string } }>('/local/auth/google', async (req, reply) => {
    const { idToken } = req.body ?? {};
    if (!idToken) return reply.status(400).send({ error: 'idToken required' });
    try {
      // Decode without verifying (base64url decode the payload segment)
      const parts   = idToken.split('.');
      if (parts.length !== 3) throw new Error('Invalid JWT');
      const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString()) as Record<string, unknown>;
      const email   = payload['email'] as string | undefined;
      const name    = (payload['name'] as string | undefined) ?? email?.split('@')[0] ?? 'Google User';
      if (!email) return reply.status(400).send({ error: 'Token has no email' });
      // Find or create admin user by email
      let user = db.getAdminUser(email);
      if (!user) {
        const { hash, salt } = hashPassword(crypto.randomUUID()); // random password — google login only
        db.createAdminUser(email, hash, salt, 'staff');
        user = db.getAdminUser(email)!;
      }
      const token = jwt.sign({ sub: email, role: user.role, name }, jwtSecret, { expiresIn: '12h' });
      return reply.send({ token, username: email, role: user.role, displayName: name });
    } catch (e) {
      app.log.warn({ err: e }, '[auth/google] Token decode failed');
      return reply.status(401).send({ error: 'Invalid token' });
    }
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

      // Resolve machine: prefer registered machine from local_machines; fall back to env var
      const machines = db.getMachines();
      const activeMachine = machines.find(m => m['is_active']) ?? machines[0];

      if (!activeMachine && !config.U5_MACHINE_IP) {
        return reply.status(503).send({ success: false, hint: 'No access machine registered. Add a machine in Settings first.', message: 'No machine configured' });
      }

      const machineIp       = activeMachine ? (activeMachine['ip_address'] as string) : config.U5_MACHINE_IP;
      const machinePort     = activeMachine ? ((activeMachine['port'] as number) || 80) : (config.U5_MACHINE_PORT || 80);
      const machinePassword = activeMachine ? ((activeMachine['password'] as string) || '123456') : (config.U5_MACHINE_PASSWORD || '123456');

      const u5 = new U5Adapter({ ip: machineIp, port: machinePort, password: machinePassword });

      if (mode === 'upload') {
        if (!imageBase64) {
          return reply.status(400).send({ success: false, message: 'imageBase64 required for upload mode' });
        }
        // U5 expects a full data URL: "data:image/jpeg;base64,..."
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
          return reply.status(422).send({ success: false, hint: result.message, message: result.message });
        }

        app.log.info({ memberCode, machineIp, machineUserId: result.userId }, 'U5 face enrolled successfully');
        // Mark enrolled and store machine-assigned userid so punch records can be correlated
        db.updateFullMember(memberId, {
          faceEnrolled:  true,
          machineUserId: result.userId,
        });
        return reply.send({ success: true, memberId, memberCode, machineUserId: result.userId, mode, message: 'Face registered on U5 device' });
      }

      // Capture mode: U5's /insertEmployee always needs a pre-supplied photo
      return reply.status(501).send({
        success: false,
        hint: 'Live capture not supported by U5 — please upload a photo instead',
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

  // GET /machines/u5/attendance?memberCode=0001
  // Pull punch records from the machine and save new ones into local_events.
  // If memberCode is supplied, only records whose id_number matches are returned/saved.
  app.get<{ Querystring: { memberCode?: string; machineUserId?: string; afterTime?: string } }>(
    '/machines/u5/attendance',
    async (req, reply) => {
      const { memberCode, machineUserId, afterTime } = req.query;

      const machines = db.getMachines();
      const machine  = machines.find(m => m['is_active']) ?? machines[0];
      if (!machine && !config.U5_MACHINE_IP) {
        return reply.status(503).send({ error: 'No access machine registered' });
      }

      const ip       = machine ? (machine['ip_address'] as string) : config.U5_MACHINE_IP;
      const port     = machine ? ((machine['port']     as number) || 80)      : (config.U5_MACHINE_PORT || 80);
      const password = machine ? ((machine['password'] as string) || '123456') : (config.U5_MACHINE_PASSWORD || '123456');
      const deviceId = machine ? String(machine['id']) : 'u5';
      const zone     = machine ? ((machine['zone'] as string) || 'main_entry') : 'main_entry';

      const u5     = new U5Adapter({ ip, port, password });
      const result = await u5.getAttendanceLogs(afterTime);

      if (!result.success) {
        return reply.status(502).send({ error: result.message });
      }

      // Filter to this member only — prefer machineUserId (machine's userid) for accuracy,
      // fall back to id_number (our memberCode) if machineUserId is not yet stored.
      const rows = (machineUserId || memberCode)
        ? result.data.filter(r =>
            (machineUserId && r.userId === machineUserId) ||
            (!machineUserId && r.id_number === memberCode)
          )
        : result.data;

      // Resolve member info once (when filtering by memberCode)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const memberRow = memberCode
        ? ((db as any).db.prepare('SELECT id, member_code, first_name, last_name FROM local_members_full WHERE member_code = ?').get(memberCode) as { id: string; member_code: string; first_name: string; last_name: string } | undefined)
        : undefined;

      let imported = 0;
      for (const row of rows) {
        const subjectId   = memberRow?.id   ?? row.id_number ?? row.userId ?? 'unknown';
        const subjectName = memberRow
          ? `${memberRow.first_name} ${memberRow.last_name}`.trim()
          : (row.id_number ?? row.userId ?? 'Unknown');

        const eventId = `u5-${row.userId}-${row.checkin_time.replace(/[\s:]/g, '-')}`;
        if (!db.eventExists(eventId)) {
          // Save punch photo to disk under member's folder
          const photoFolder = memberRow?.member_code ?? memberCode ?? 'unknown';
          const photoPath = row.pic_large
            ? await savePunchPhoto(config.FACE_STORAGE_DIR, photoFolder, row.checkin_time, row.pic_large)
            : undefined;

          db.appendEvent({
            eventId,
            deviceId,
            branchId:       'edge',
            zone,
            subjectType:    'member',
            subjectId,
            subjectName,
            decision:       row.ispass === 1 ? 'ALLOW' : 'DENY',
            identifierUsed: 'face',
            eventTime:      row.checkin_time,
            photoPath,
            temp:           row.temp,
          });
          imported++;
        }
      }

      return reply.send({
        imported,
        total:   rows.length,
        records: rows.map(r => ({
          userId:       r.userId,
          id_number:    r.id_number,
          checkin_time: r.checkin_time,
          ispass:       r.ispass,
        })),
      });
    },
  );

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
    const machines = db.getMachines();
    const machine  = machines.find(m => m['is_active']) ?? machines[0];
    const ip       = machine ? (machine['ip_address'] as string) : config.U5_MACHINE_IP;
    if (!ip) return reply.status(503).send({ ok: false, error: 'No access machine registered' });
    const u5 = new U5Adapter({
      ip,
      port:     machine ? ((machine['port'] as number) || 80)        : (config.U5_MACHINE_PORT || 80),
      password: machine ? ((machine['password'] as string) || '123456') : (config.U5_MACHINE_PASSWORD || '123456'),
    });
    const result = await u5.openDoor();
    return reply.send({ ok: result.success, error: result.success ? undefined : result.message });
  });

  // GET /machines/u5/status — quick status for desktop dashboard
  app.get('/machines/u5/status', async (_req, reply) => {
    const machines = db.getMachines();
    const machine  = machines.find(m => m['is_active']) ?? machines[0];
    const ip       = machine ? (machine['ip_address'] as string) : config.U5_MACHINE_IP;
    if (!ip) return reply.send({ online: false, reason: 'No access machine registered' });
    const u5 = new U5Adapter({
      ip,
      port:     machine ? ((machine['port'] as number) || 80)        : (config.U5_MACHINE_PORT || 80),
      password: machine ? ((machine['password'] as string) || '123456') : (config.U5_MACHINE_PASSWORD || '123456'),
    });
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

    // Seed default local admin if none exist
    if (db.countAdminUsers() === 0) {
      const { hash, salt } = hashPassword('123456');
      db.createAdminUser('demo', hash, salt, 'owner');
      app.log.warn('[local-admin] Default admin created — login: demo / 123456');
    }

    // Seed default membership plans if none exist
    if (db.countPlans() === 0) {
      const defaults = [
        { name: 'Basic Monthly',    planType: 'basic',     durationValue: 1, durationUnit: 'month', price: 500,  gstPercent: 0, allowedZones: ['main_entry'] },
        { name: 'Premium Monthly',  planType: 'premium',   durationValue: 1, durationUnit: 'month', price: 1000, gstPercent: 0, allowedZones: ['main_entry'] },
        { name: 'Quarterly',        planType: 'quarterly', durationValue: 3, durationUnit: 'month', price: 2500, gstPercent: 0, allowedZones: ['main_entry'] },
        { name: 'Annual',           planType: 'yearly',    durationValue: 1, durationUnit: 'year',  price: 8000, gstPercent: 0, allowedZones: ['main_entry'] },
      ];
      for (const p of defaults) db.createPlan(p);
      app.log.info('[plans] Seeded 4 default membership plans');
    }

    // Seed machine from env if table is empty
    if (config.U5_MACHINE_IP && db.getMachineCount() === 0) {
      db.createMachine({ name: 'Main Entry', zone: 'main_entry', ipAddress: config.U5_MACHINE_IP, port: config.U5_MACHINE_PORT, password: config.U5_MACHINE_PASSWORD });
      app.log.info({ ip: config.U5_MACHINE_IP }, '[machines] Seeded machine from env');
    }

    startSyncWorker(db, app.log);
    startU5Poller(db, app.log, config.U5_POLL_INTERVAL_MS);

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

// ── U5 attendance auto-poller ─────────────────────────────────────────────────
// Polls every U5 machine via /getWorkNoteList (HTTP) and saves new punch records.
// protocol_type:0 devices never push MQTT — they keep records locally until polled.
function startU5Poller(
  db: EdgeDB,
  log: ReturnType<typeof Fastify>['log'],
  intervalMs = 30_000,
): void {
  // Per-machine cursor: skip records we've already imported
  const lastSeen = new Map<number, string>();

  async function pollOnce(): Promise<void> {
    const machines = db.getMachines();
    for (const machine of machines) {
      const machineId = machine['id'] as number;
      const ip        = machine['ip_address'] as string;
      const port      = (machine['port']     as number) || 80;
      const password  = (machine['password'] as string) || '123456';
      const zone      = (machine['zone']     as string) || 'main_entry';
      const afterTime = lastSeen.get(machineId);

      const u5     = new U5Adapter({ ip, port, password, timeoutMs: 12_000 });
      const result = await u5.getAttendanceLogs(afterTime).catch(() => null);
      if (!result?.success) continue;

      let newest    = afterTime;
      let imported  = 0;

      for (const row of result.data) {
        const eventId = `u5-${row.userId}-${row.checkin_time.replace(/[\s:]/g, '-')}`;
        if (db.eventExists(eventId)) continue;

        const member      = row.id_number ? db.getMemberByCode(row.id_number) : undefined;
        const subjectId   = member?.memberId   ?? row.id_number ?? row.userId ?? 'unknown';
        const subjectName = member?.memberCode ?? row.id_number ?? row.userId ?? 'Unknown';
        const photoFolder = member?.memberCode ?? row.id_number ?? 'unknown';

        const photoPath = row.pic_large
          ? await savePunchPhoto(config.FACE_STORAGE_DIR, photoFolder, row.checkin_time, row.pic_large).catch(() => undefined)
          : undefined;

        db.appendEvent({
          eventId,
          deviceId:       String(machineId),
          branchId:       'edge',
          zone,
          subjectType:    'member',
          subjectId:      String(subjectId),
          subjectName:    String(subjectName),
          decision:       row.ispass === 1 ? 'ALLOW' : 'DENY',
          identifierUsed: 'face',
          eventTime:      row.checkin_time,
          photoPath,
          temp:           row.temp,
        });
        imported++;
        if (!newest || row.checkin_time > newest) newest = row.checkin_time;
      }

      if (imported > 0) {
        log.info({ ip, imported }, '[u5-poller] New punch records imported');
        db.updateMachineSeen(machineId);
      }
      if (newest) lastSeen.set(machineId, newest);
    }
  }

  // First poll 5 s after startup; then every intervalMs
  setTimeout(() => {
    void pollOnce();
    setInterval(() => void pollOnce(), intervalMs);
  }, 5_000);

  log.info({ intervalMs }, '[u5-poller] Attendance polling started');
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
