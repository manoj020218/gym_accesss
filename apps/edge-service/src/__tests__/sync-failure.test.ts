import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { EdgeDB } from '../db/sqlite.js';
import { push, pull } from '../sync/worker.js';
import { pino } from 'pino';

const log = pino({ level: 'silent' });

function appendTestEvent(db: EdgeDB, seq?: number) {
  return db.appendEvent({
    eventId:        `evt-${seq ?? Date.now()}`,
    deviceId:       'test-device-001',
    branchId:       'test-branch-001',
    zone:           'main_entry',
    subjectType:    'member',
    subjectId:      'mem-001',
    decision:       'ALLOW',
    identifierUsed: 'rfid',
    eventTime:      new Date().toISOString(),
  });
}

let db: EdgeDB;

beforeEach(() => {
  db = new EdgeDB(':memory:');
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('push() — network failure', () => {
  it('leaves events in pending state when network is unreachable', async () => {
    appendTestEvent(db);
    expect(db.getPendingEvents(10)).toHaveLength(1);

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    await expect(push(db, log)).rejects.toThrow();

    // Event must still be pending — markEventsSynced never ran
    expect(db.getPendingEvents(10)).toHaveLength(1);
  });

  it('leaves events pending when server returns a non-OK status', async () => {
    appendTestEvent(db);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok:     false,
      status: 503,
      json:   async () => ({ error: 'Service Unavailable' }),
    }));

    await expect(push(db, log)).rejects.toThrow();
    expect(db.getPendingEvents(10)).toHaveLength(1);
  });

  it('marks events as synced after a successful push', async () => {
    appendTestEvent(db);
    expect(db.getPendingEvents(10)).toHaveLength(1);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok:   true,
      json: async () => ({ ackCursor: 1, accepted: 1, rejected: [] }),
    }));

    await push(db, log);

    // All events should now be synced
    expect(db.getPendingEvents(10)).toHaveLength(0);
  });

  it('only pushes up to 100 pending events per batch', async () => {
    for (let i = 0; i < 105; i++) appendTestEvent(db);

    let capturedBody: { events: unknown[] } | undefined;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url: string, opts: RequestInit) => {
      capturedBody = JSON.parse(opts.body as string) as { events: unknown[] };
      return {
        ok:   true,
        json: async () => ({
          ackCursor: capturedBody!.events.length,
          accepted:  capturedBody!.events.length,
          rejected:  [],
        }),
      };
    }));

    await push(db, log);

    // First batch is capped at 100
    expect(capturedBody!.events.length).toBe(100);
    // 5 events still pending after first push
    expect(db.getPendingEvents(200)).toHaveLength(5);
  });
});

describe('pull() — network failure', () => {
  it('throws when server is unreachable and leaves sync state unchanged', async () => {
    const stateBefore = db.getSyncState();

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network timeout')));

    await expect(pull(db, log)).rejects.toThrow();

    const stateAfter = db.getSyncState();
    expect(stateAfter.lastPolicyVersion).toBe(stateBefore.lastPolicyVersion);
  });

  it('upserts members from a successful pull response', async () => {
    const fakeMember = {
      memberId:         'mem-pulled',
      memberCode:       'MEMPULL',
      rfidCardId:       'rfid-pulled',
      status:           'active',
      activeUntil:      new Date(Date.now() + 86_400_000).toISOString(),
      allowedZones:     ['main_entry'],
      allowedBranchIds: ['test-branch-001'],
      planType:         'basic',
      hasDues:          false,
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok:   true,
      json: async () => ({
        policyVersion: 2,
        members:       [fakeMember],
        staff:         [],
        policies:      [],
        blocklist:     [],
      }),
    }));

    await pull(db, log);

    const member = db.getMemberByRfid('rfid-pulled');
    expect(member).toBeDefined();
    expect(member!.memberId).toBe('mem-pulled');
  });
});

describe('duplicate batch replay — idempotency at SQLite level', () => {
  it('appendEvent assigns unique auto-increment seq; markEventsSynced is range-based', () => {
    const s1 = appendTestEvent(db);
    const s2 = appendTestEvent(db);
    const s3 = appendTestEvent(db);

    // Sync first two
    db.markEventsSynced(s1, s2);
    expect(db.getPendingEvents(10)).toHaveLength(1);

    // "Replay" the same mark call — should be a no-op for already-synced events
    db.markEventsSynced(s1, s2);
    expect(db.getPendingEvents(10)).toHaveLength(1);

    // s3 is still pending
    db.markEventsSynced(s3, s3);
    expect(db.getPendingEvents(10)).toHaveLength(0);
  });
});
