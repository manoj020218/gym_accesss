import type { FastifyPluginAsync } from 'fastify';
import { z }                       from 'zod';
import { resolve }                 from 'node:path';
import { gzipSync }                from 'node:zlib';
import { spawn }                   from 'node:child_process';
import { createRequire }           from 'node:module';
import { config }                  from '../config.js';
import { requireRoles }            from '../middleware/rbac.js';
import { StaffRole }               from '@edge-gym/shared-types';
import { Member }                  from '../models/Member.js';
import { Staff }                   from '../models/Staff.js';
import { Membership }              from '../models/Membership.js';
import { Payment }                 from '../models/Payment.js';
import { Product }                 from '../models/Product.js';
import { AccessEvent }             from '../models/AccessEvent.js';
import { Branch }                  from '../models/Branch.js';
import { SystemConfig }            from '../models/SystemConfig.js';

// Read version from api-server package.json at startup
const _require = createRequire(import.meta.url);
const APP_VERSION: string = (() => {
  try { return (_require('../../package.json') as { version: string }).version; } catch { return '1.0.0'; }
})();

// Simple semver comparison: returns true if `latest` is strictly newer than `current`
function isNewer(latest: string, current: string): boolean {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number);
  const [lM, lm, lp] = parse(latest);
  const [cM, cm, cp] = parse(current);
  if (lM !== cM) return lM > cM;
  if (lm !== cm) return lm > cm;
  return lp > cp;
}

const BackupScheduleBody = z.object({
  enabled:   z.boolean(),
  interval:  z.enum(['daily', 'weekly', 'manual']),
  hour:      z.number().int().min(0).max(23).default(3),
  minute:    z.number().int().min(0).max(59).default(0),
  dayOfWeek: z.number().int().min(0).max(6).default(0),  // 0=Sun, for weekly
});

export type BackupSchedule = z.infer<typeof BackupScheduleBody>;

// ── Backup helper — returns gzip Buffer in memory, no VPS disk write ──────────
export async function runBackup(actorEmail: string, branchIds?: string[]): Promise<{ gz: Buffer; filename: string }> {
  const filter = branchIds ? { branchId: { $in: branchIds } } : {};
  const cutoff = new Date(Date.now() - 90 * 86_400_000);

  const [members, staff, memberships, payments, products, events, branches] = await Promise.all([
    Member.find(filter).lean(),
    Staff.find(filter).lean(),
    Membership.find(filter).lean(),
    Payment.find(filter).lean(),
    Product.find(filter).lean(),
    AccessEvent.find({ ...filter, eventTime: { $gte: cutoff } }).lean(),
    Branch.find(branchIds ? { _id: { $in: branchIds } } : {}).lean(),
  ]);

  const payload = {
    _meta: { version: APP_VERSION, timestamp: new Date().toISOString(), generatedBy: actorEmail, branches: branches.map((b) => b.name) },
    branches, members, staff, memberships, payments, products,
    accessEvents: events,
  };

  const gz       = gzipSync(Buffer.from(JSON.stringify(payload)));
  const ts       = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `backup_${ts}.json.gz`;
  return { gz, filename };
}

// ── Route plugin ──────────────────────────────────────────────────────────────
const adminRoutes: FastifyPluginAsync = async (fastify) => {

  // GET /admin/version
  fastify.get('/admin/version', async (_req, reply) => {
    return reply.send({ version: APP_VERSION, releasesUrl: config.RELEASES_URL });
  });

  // GET /admin/update/check
  fastify.get('/admin/update/check', { preHandler: requireRoles(StaffRole.Owner) }, async (_req, reply) => {
    try {
      const res    = await fetch(config.RELEASES_URL, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const latest = await res.json() as { version: string; changelog?: string; releaseDate?: string };
      return reply.send({
        current:     APP_VERSION,
        latest:      latest.version,
        hasUpdate:   isNewer(latest.version, APP_VERSION),
        changelog:   latest.changelog   ?? '',
        releaseDate: latest.releaseDate ?? '',
      });
    } catch (err) {
      return reply.status(503).send({ error: 'Could not reach release server', detail: String(err) });
    }
  });

  // POST /admin/update/apply — runs update.sh in background; server will restart
  fastify.post('/admin/update/apply', { preHandler: requireRoles(StaffRole.Owner) }, async (req, reply) => {
    const scriptPath = resolve(config.UPDATE_SCRIPT);
    const dir        = resolve('.');

    // Take a pre-update backup and discard the buffer (edge service handles its own backups)
    void runBackup(req.actor.email).catch((e) => fastify.log.error('[update] pre-backup failed: ' + String(e)));

    const child = spawn('bash', [scriptPath], { cwd: dir, detached: true, stdio: 'ignore' });
    child.unref();

    return reply.send({ status: 'started', message: 'Update script launched. API server will restart in ~60 seconds. Refresh this page after ~90 seconds.' });
  });

  // GET /admin/backup — stream gzip directly to browser (no server-side storage)
  fastify.get('/admin/backup', { preHandler: requireRoles(StaffRole.Owner, StaffRole.Manager) }, async (req, reply) => {
    const branchIds   = req.actor.role === StaffRole.Owner ? undefined : req.actor.branchIds;
    const { gz, filename } = await runBackup(req.actor.email, branchIds);

    void reply.header('Content-Type', 'application/gzip');
    void reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    return reply.send(gz);
  });

  // GET /admin/backup/schedule
  fastify.get('/admin/backup/schedule', async (_req, reply) => {
    const doc = await SystemConfig.findOne({ key: 'backupSchedule' }).lean();
    const defaults: BackupSchedule = { enabled: false, interval: 'daily', hour: 3, minute: 0, dayOfWeek: 0 };
    return reply.send((doc?.value as BackupSchedule) ?? defaults);
  });

  // PUT /admin/backup/schedule
  fastify.put<{ Body: BackupSchedule }>('/admin/backup/schedule', {
    preHandler: requireRoles(StaffRole.Owner),
  }, async (req, reply) => {
    const schedule = BackupScheduleBody.parse(req.body);
    await SystemConfig.findOneAndUpdate(
      { key: 'backupSchedule' },
      { value: schedule },
      { upsert: true, new: true },
    );
    return reply.send(schedule);
  });
};

export default adminRoutes;
