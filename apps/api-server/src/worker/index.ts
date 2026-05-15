import cron from 'node-cron';
import type { BaseLogger } from 'pino';
import { runBackup }            from '../routes/admin.js';
import { SystemConfig }         from '../models/SystemConfig.js';
import type { BackupSchedule }  from '../routes/admin.js';
import { Membership }           from '../models/Membership.js';
import { Member }               from '../models/Member.js';
import { SyncCheckpoint }       from '../models/SyncCheckpoint.js';
import { Product }              from '../models/Product.js';
import { AccessEvent }          from '../models/AccessEvent.js';
import { ArchivedAccessEvent }  from '../models/ArchivedAccessEvent.js';
import { MemberStatus, NotificationType } from '@edge-gym/shared-types';
import { getAdminApp, fcmSendMulticast }  from '../services/fcm.js';

const ARCHIVE_RETENTION_DAYS = 90;
const ARCHIVE_BATCH_SIZE      = 500;

export function startWorker(log: BaseLogger): void {

  // ── 00:05 daily — expire memberships past their endDate ────────────────────
  cron.schedule('5 0 * * *', async () => {
    log.info('[worker] Running membership expiry check');
    const now = new Date();

    const expired = await Membership.find({
      status:  MemberStatus.Active,
      endDate: { $lt: now },
    }).lean();

    for (const m of expired) {
      await Membership.findByIdAndUpdate(m._id, { status: MemberStatus.Expired });
      await Member.findByIdAndUpdate(m.memberId, { status: MemberStatus.Expired });
    }

    log.info(`[worker] Expired ${expired.length} memberships`);
  });

  // ── 09:00 daily — renewal reminder FCM (expiring in ≤7 days) ──────────────
  cron.schedule('0 9 * * *', async () => {
    log.info('[worker] Running renewal reminder job');
    const now    = new Date();
    const cutoff = new Date(now.getTime() + 7 * 86_400_000);

    const expiring = await Membership.find({
      status:  MemberStatus.Active,
      endDate: { $gt: now, $lte: cutoff },
    }).lean();

    if (expiring.length === 0) return;

    const memberIds = expiring.map(m => m.memberId);
    const members   = await Member.find({
      _id:      { $in: memberIds },
      fcmToken: { $exists: true, $ne: null },
    }).lean();

    const tokens = members
      .map(m => m.fcmToken)
      .filter((t): t is string => typeof t === 'string' && t.length > 0);

    if (tokens.length > 0) {
      try {
        const result = await fcmSendMulticast(
          getAdminApp(),
          tokens,
          '⏰ Membership Expiring Soon',
          'Your membership expires in 7 days. Renew now to keep uninterrupted gym access!',
          { type: NotificationType.RenewalReminder },
        );
        log.info(
          `[worker] Renewal reminders: ${result.successCount} ok, ${result.failureCount} failed`,
        );
      } catch (err) {
        log.error(err, '[worker] Failed to send renewal reminders via FCM');
      }
    }

    log.info(`[worker] Renewal check: ${expiring.length} expiring, ${tokens.length} notified`);
  });

  // ── Every hour — offline EDGE device alert (heartbeat > 10 min ago) ────────
  cron.schedule('0 * * * *', async () => {
    const threshold = new Date(Date.now() - 10 * 60_000);
    const stale = await SyncCheckpoint.countDocuments({ lastHeartbeatAt: { $lt: threshold } });
    if (stale > 0) {
      log.warn(`[worker] ${stale} edge device(s) have not sent a heartbeat in >10 min`);
    }
  });

  // ── 08:00 daily — low-stock product alert ──────────────────────────────────
  cron.schedule('0 8 * * *', async () => {
    log.info('[worker] Running low-stock check');
    const lowStock = await Product.find({
      isActive: true,
      $expr: { $lte: ['$currentStock', '$minStockLevel'] },
    }).lean();

    if (lowStock.length > 0) {
      const names = lowStock.map(p => `${p.name} (${p.currentStock}/${p.minStockLevel})`).join(', ');
      log.warn(`[worker] Low-stock products: ${names}`);
    }
  });

  // ── 03:00 daily — archive access events older than 90 days ─────────────────
  cron.schedule('0 3 * * *', async () => {
    log.info('[worker] Running access event archive job');
    const cutoff = new Date(Date.now() - ARCHIVE_RETENTION_DAYS * 86_400_000);
    let totalArchived = 0;

    while (true) {
      const batch = await AccessEvent.find({ eventTime: { $lt: cutoff } })
        .limit(ARCHIVE_BATCH_SIZE)
        .lean();

      if (batch.length === 0) break;

      try {
        await ArchivedAccessEvent.insertMany(
          batch.map(ev => ({
            edgeDeviceId:      ev.edgeDeviceId,
            branchId:          ev.branchId,
            zone:              ev.zone,
            subjectType:       ev.subjectType,
            subjectId:         ev.subjectId,
            subjectName:       ev.subjectName,
            decision:          ev.decision,
            denyReason:        ev.denyReason,
            identifierUsed:    ev.identifierUsed,
            localSeq:          ev.localSeq,
            eventTime:         ev.eventTime,
            syncedAt:          ev.syncedAt,
            originalCreatedAt: ev.createdAt,
            archivedAt:        new Date(),
          })),
          { ordered: false },
        );
      } catch {
        // insertMany with ordered:false continues past duplicate key errors
      }

      await AccessEvent.deleteMany({ _id: { $in: batch.map(ev => ev._id) } });
      totalArchived += batch.length;

      if (batch.length < ARCHIVE_BATCH_SIZE) break;
    }

    if (totalArchived > 0) {
      log.info(`[worker] Archived ${totalArchived} access events (>${ARCHIVE_RETENTION_DAYS} days old)`);
    }
  });

  // ── Scheduled backup — runs every 15 min, checks schedule settings ──────────
  cron.schedule('*/15 * * * *', async () => {
    try {
      const doc = await SystemConfig.findOne({ key: 'backupSchedule' }).lean();
      const sched = (doc?.value ?? {}) as Partial<BackupSchedule>;
      if (!sched.enabled) return;

      const now       = new Date();
      const hour      = now.getHours();
      const minute    = now.getMinutes();
      const dayOfWeek = now.getDay();

      const targetHour   = sched.hour   ?? 3;
      const targetMinute = sched.minute ?? 0;

      // Only fire in the correct 15-min window
      const inWindow = hour === targetHour && minute >= targetMinute && minute < targetMinute + 15;
      if (!inWindow) return;

      if (sched.interval === 'weekly' && dayOfWeek !== (sched.dayOfWeek ?? 0)) return;

      // Avoid double-run: check if last backup was <12h ago
      const lastDoc = await SystemConfig.findOne({ key: 'lastBackup' }).lean();
      const lastTs  = (lastDoc?.value as Record<string, string> | undefined)?.['timestamp'];
      if (lastTs && Date.now() - new Date(lastTs).getTime() < 12 * 3_600_000) return;

      log.info('[worker] Running scheduled backup');
      const fname = await runBackup('scheduler');
      log.info(`[worker] Scheduled backup saved: ${fname}`);
    } catch (err) {
      log.error(err, '[worker] Scheduled backup failed');
    }
  });

  log.info('[worker] All scheduled jobs started');
}
