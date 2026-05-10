import { createHmac }  from 'crypto';
import { networkInterfaces } from 'node:os';
import type { EdgeDB } from '../db/sqlite.js';
import { config }      from '../config.js';
import { randomUUID }  from 'crypto';
import type { BaseLogger } from 'pino';
import { U5Adapter }   from '../hardware/u5/index.js';

function getLanIp(): string | undefined {
  for (const iface of Object.values(networkInterfaces())) {
    for (const addr of (iface ?? [])) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address;
    }
  }
  return undefined;
}

const BASE = config.EDGE_SYNC_BASE_URL;

async function apiFetch(path: string, opts: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...opts.headers },
  });
  if (!res.ok) throw new Error(`[sync] ${opts.method ?? 'GET'} ${path} → ${res.status}`);
  return res.json();
}

// ── PULL — fetch master data from VPS ────────────────────────────────────────
export async function pull(db: EdgeDB, log: BaseLogger): Promise<void> {
  const { lastPolicyVersion } = db.getSyncState();
  const data = await apiFetch(
    `/pull?sinceVersion=${lastPolicyVersion}&branchId=${config.EDGE_BRANCH_ID}&edgeDeviceId=${config.EDGE_DEVICE_ID}`,
  ) as {
    members:       Parameters<typeof db.upsertMembers>[0];
    blocklist?:    string[];
    policyVersion: number;
  };

  if (data.members?.length) {
    db.upsertMembers(data.members);
    log.info(`[sync] Pulled ${data.members.length} members`);
  }

  if (data.blocklist) {
    db.upsertBlocklist(data.blocklist);
    log.debug(`[sync] Blocklist synced: ${data.blocklist.length} entries`);
  }
}

// ── PUSH — send pending events to VPS ────────────────────────────────────────
export async function push(db: EdgeDB, log: BaseLogger): Promise<void> {
  const pending = db.getPendingEvents(100);
  if (pending.length === 0) return;

  const fromSeq = pending[0]?.['local_seq'] as number;
  const toSeq   = pending[pending.length - 1]?.['local_seq'] as number;
  const batchId = randomUUID();

  const events = pending.map(e => ({
    id:             e['event_id'] as string,
    zone:           e['zone'] as string,
    subjectType:    e['subject_type'] as string,
    subjectId:      e['subject_id'] as string,
    subjectName:    e['subject_name'] as string | undefined,
    decision:       e['decision'] as string,
    denyReason:     e['deny_reason'] as string | undefined,
    identifierUsed: e['identifier_used'] as string,
    localSeq:       e['local_seq'] as number,
    eventTime:      e['event_time'] as string,
  }));

  const hmacSignature = createHmac('sha256', config.EDGE_SHARED_SECRET)
    .update(batchId + fromSeq + toSeq)
    .digest('hex');

  const body = {
    batchId, edgeDeviceId: config.EDGE_DEVICE_ID,
    branchId: config.EDGE_BRANCH_ID, fromSeq, toSeq, events, hmacSignature,
  };

  const res = await apiFetch('/push-events', {
    method: 'POST', body: JSON.stringify(body),
  }) as { ackCursor: number; accepted: number };

  db.markEventsSynced(fromSeq, toSeq);
  db.updateAckCursor(res.ackCursor);
  log.info(`[sync] Pushed ${events.length} events, acked cursor=${res.ackCursor}`);
}

// ── HEARTBEAT ─────────────────────────────────────────────────────────────────
export async function heartbeat(db: EdgeDB, log: BaseLogger): Promise<void> {
  const pending = db.getPendingEvents(1000).length;
  await apiFetch('/heartbeat', {
    method: 'POST',
    body: JSON.stringify({
      edgeDeviceId:    config.EDGE_DEVICE_ID,
      branchId:        config.EDGE_BRANCH_ID,
      localTime:       new Date().toISOString(),
      syncLag:         0,
      pendingEventCount: pending,
      uptime:          Math.floor(process.uptime()),
      edgeServiceIp:   getLanIp(),
      edgeServicePort: config.EDGE_PORT,
    }),
  });
  log.debug('[sync] Heartbeat sent');
}

// ── U5 attendance polling — imports face-scan events from machine into our queue ──
export async function syncU5Attendance(db: EdgeDB, log: BaseLogger): Promise<void> {
  if (!config.U5_MACHINE_IP) return;

  const u5 = new U5Adapter({
    ip:       config.U5_MACHINE_IP,
    port:     config.U5_MACHINE_PORT,
    password: config.U5_MACHINE_PASSWORD,
  });

  const attResult = await u5.getAttendanceLogs();
  if (!attResult.success) {
    log.debug({ reason: attResult.message }, '[u5-att] Attendance fetch skipped');
    return;
  }

  const records = attResult.data;
  if (records.length === 0) return;

  // Last imported timestamp — skip records already processed
  const lastSyncStr = db.getDeviceConfig('u5_att_last_sync');
  const lastSync    = lastSyncStr ? new Date(lastSyncStr) : new Date(0);

  // Build userId → id_number map for records that don't carry id_number
  const needsMap = records.some(r => !r.id_number);
  const userIdToCode = new Map<string, string>();
  if (needsMap) {
    const empResult = await u5.getEmployeeList();
    if (empResult.success) {
      for (const emp of empResult.data) {
        if (emp.id_number) userIdToCode.set(emp.userId, emp.id_number);
      }
    }
  }

  let imported = 0;
  let latestTime = lastSync;

  for (const rec of records) {
    const eventTime = new Date(rec.time);
    if (isNaN(eventTime.getTime())) continue;
    if (eventTime <= lastSync) continue;

    const memberCode = rec.id_number ?? userIdToCode.get(rec.userId);
    if (!memberCode) continue;

    const member = db.getMemberByCode(memberCode);
    if (!member) continue;

    // Deterministic ID — prevents duplicate imports across restarts
    const eventId = `u5att_${rec.userId}_${eventTime.getTime()}`;

    try {
      db.appendEvent({
        eventId,
        deviceId:       config.EDGE_DEVICE_ID,
        branchId:       config.EDGE_BRANCH_ID,
        zone:           'main_entry',
        subjectType:    'member',
        subjectId:      member.memberId,
        subjectName:    member.memberCode,
        decision:       'ALLOW',
        identifierUsed: 'face',
        eventTime:      eventTime.toISOString(),
      });
      imported++;
      if (eventTime > latestTime) latestTime = eventTime;
    } catch {
      // UNIQUE constraint — record already queued, safe to ignore
    }
  }

  if (latestTime > lastSync) {
    db.setDeviceConfig('u5_att_last_sync', latestTime.toISOString());
  }

  if (imported > 0) {
    log.info({ imported }, '[u5-att] Imported attendance records from U5');
  }
}

// ── Start sync loop ───────────────────────────────────────────────────────────
export function startSyncWorker(db: EdgeDB, log: BaseLogger): void {
  // Fire immediately on startup so edgeServiceIp is registered before first enrollment attempt
  void pull(db, log).catch(e => log.warn(e, '[sync] Initial pull failed'));
  void heartbeat(db, log).catch(e => log.warn(e, '[sync] Initial heartbeat failed'));

  // Sync interval
  setInterval(async () => {
    try { await syncU5Attendance(db, log); } catch (e) { log.debug(e, '[u5-att] Sync failed'); }
    try { await push(db, log); } catch (e) { log.warn(e, '[sync] Push failed'); }
    try { await pull(db, log); } catch (e) { log.warn(e, '[sync] Pull failed'); }
  }, config.EDGE_SYNC_INTERVAL_MS);

  // Heartbeat interval
  setInterval(async () => {
    try { await heartbeat(db, log); } catch (e) { log.debug(e, '[sync] Heartbeat failed'); }
  }, config.EDGE_HEARTBEAT_INTERVAL_MS);

  log.info('[sync] Sync worker started');
}
