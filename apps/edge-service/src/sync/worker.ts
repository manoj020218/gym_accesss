import { createHmac }  from 'crypto';
import { networkInterfaces } from 'node:os';
import type { EdgeDB } from '../db/sqlite.js';
import { config }      from '../config.js';
import { randomUUID }  from 'crypto';
import type { BaseLogger } from 'pino';

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

// ── Start sync loop ───────────────────────────────────────────────────────────
export function startSyncWorker(db: EdgeDB, log: BaseLogger): void {
  // Fire immediately on startup so edgeServiceIp is registered before first enrollment attempt
  void pull(db, log).catch(e => log.warn(e, '[sync] Initial pull failed'));
  void heartbeat(db, log).catch(e => log.warn(e, '[sync] Initial heartbeat failed'));

  // Sync interval
  setInterval(async () => {
    try { await push(db, log); } catch (e) { log.warn(e, '[sync] Push failed'); }
    try { await pull(db, log); } catch (e) { log.warn(e, '[sync] Pull failed'); }
  }, config.EDGE_SYNC_INTERVAL_MS);

  // Heartbeat interval
  setInterval(async () => {
    try { await heartbeat(db, log); } catch (e) { log.debug(e, '[sync] Heartbeat failed'); }
  }, config.EDGE_HEARTBEAT_INTERVAL_MS);

  log.info('[sync] Sync worker started');
}
