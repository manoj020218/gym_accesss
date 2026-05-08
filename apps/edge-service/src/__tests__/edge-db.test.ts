import { describe, it, expect, beforeEach } from 'vitest';
import { EdgeDB } from '../db/sqlite.js';
import type { EdgeMemberRecord } from '@edge-gym/shared-types';
import { MemberStatus, Zone } from '@edge-gym/shared-types';

const tomorrow = new Date(Date.now() + 86_400_000).toISOString();

function makeRecord(overrides: Partial<EdgeMemberRecord> = {}): EdgeMemberRecord {
  return {
    memberId:         'mem-001',
    memberCode:       'MEM001',
    status:           MemberStatus.Active,
    activeUntil:      tomorrow,
    allowedZones:     [Zone.MainEntry, Zone.Cardio],
    allowedBranchIds: ['test-branch-001'],
    planType:         'basic',
    hasDues:          false,
    ...overrides,
  };
}

let db: EdgeDB;

beforeEach(() => {
  db = new EdgeDB(':memory:');
});

describe('EdgeDB — member operations', () => {
  it('upserts a member and retrieves by rfid', () => {
    db.upsertMembers([makeRecord({ rfidCardId: 'rfid-aaa' })]);
    const m = db.getMemberByRfid('rfid-aaa');
    expect(m).toBeDefined();
    expect(m!.memberId).toBe('mem-001');
    expect(m!.status).toBe(MemberStatus.Active);
  });

  it('upserts a member and retrieves by QR token', () => {
    db.upsertMembers([makeRecord({ qrToken: 'qr-token-xyz' })]);
    const m = db.getMemberByQr('qr-token-xyz');
    expect(m).toBeDefined();
    expect(m!.memberCode).toBe('MEM001');
  });

  it('upserts a member and retrieves by id', () => {
    db.upsertMembers([makeRecord()]);
    const m = db.getMemberById('mem-001');
    expect(m).toBeDefined();
  });

  it('updates an existing member on conflict (idempotent upsert)', () => {
    db.upsertMembers([makeRecord({ hasDues: false })]);
    db.upsertMembers([makeRecord({ hasDues: true })]);

    const m = db.getMemberById('mem-001');
    expect(m!.hasDues).toBe(true);
  });

  it('returns undefined for unknown rfid', () => {
    expect(db.getMemberByRfid('unknown-rfid')).toBeUndefined();
  });

  it('stores and retrieves JSON-serialised allowedZones correctly', () => {
    db.upsertMembers([makeRecord({ allowedZones: [Zone.MainEntry, Zone.PTRoom] })]);
    const m = db.getMemberById('mem-001');
    expect(m!.allowedZones).toEqual([Zone.MainEntry, Zone.PTRoom]);
  });
});

describe('EdgeDB — event queue', () => {
  it('appends an event and returns an auto-increment localSeq', () => {
    const seq1 = db.appendEvent({
      eventId: 'evt-001', deviceId: 'dev-001', branchId: 'branch-001',
      zone: 'main_entry', subjectType: 'member', subjectId: 'mem-001',
      decision: 'ALLOW', identifierUsed: 'rfid', eventTime: new Date().toISOString(),
    });
    const seq2 = db.appendEvent({
      eventId: 'evt-002', deviceId: 'dev-001', branchId: 'branch-001',
      zone: 'main_entry', subjectType: 'member', subjectId: 'mem-001',
      decision: 'DENY', identifierUsed: 'rfid', eventTime: new Date().toISOString(),
    });

    expect(seq2).toBeGreaterThan(seq1);
  });

  it('getPendingEvents returns only pending events', () => {
    db.appendEvent({
      eventId: 'evt-a', deviceId: 'dev-001', branchId: 'branch-001',
      zone: 'main_entry', subjectType: 'member', subjectId: 'mem-001',
      decision: 'ALLOW', identifierUsed: 'rfid', eventTime: new Date().toISOString(),
    });

    const pending = db.getPendingEvents(10);
    expect(pending).toHaveLength(1);
    expect(pending[0]!['sync_state']).toBe('pending');
  });

  it('markEventsSynced transitions events to synced state', () => {
    const seq1 = db.appendEvent({
      eventId: 'evt-s1', deviceId: 'dev-001', branchId: 'branch-001',
      zone: 'main_entry', subjectType: 'member', subjectId: 'mem-001',
      decision: 'ALLOW', identifierUsed: 'rfid', eventTime: new Date().toISOString(),
    });
    const seq2 = db.appendEvent({
      eventId: 'evt-s2', deviceId: 'dev-001', branchId: 'branch-001',
      zone: 'cardio', subjectType: 'member', subjectId: 'mem-001',
      decision: 'ALLOW', identifierUsed: 'rfid', eventTime: new Date().toISOString(),
    });

    db.markEventsSynced(seq1, seq2);
    const pending = db.getPendingEvents(10);
    expect(pending).toHaveLength(0);
  });

  it('getPendingEvents respects the limit parameter', () => {
    for (let i = 0; i < 5; i++) {
      db.appendEvent({
        eventId: `evt-lim-${i}`, deviceId: 'dev-001', branchId: 'branch-001',
        zone: 'main_entry', subjectType: 'member', subjectId: 'mem-001',
        decision: 'ALLOW', identifierUsed: 'rfid', eventTime: new Date().toISOString(),
      });
    }
    expect(db.getPendingEvents(3)).toHaveLength(3);
  });
});

describe('EdgeDB — sync state', () => {
  it('getSyncState returns defaults for a fresh DB', () => {
    const state = db.getSyncState();
    expect(state.lastPolicyVersion).toBe(0);
    expect(state.lastEventAckCursor).toBe(0);
  });

  it('updateAckCursor persists the new cursor', () => {
    db.updateAckCursor(42);
    expect(db.getSyncState().lastEventAckCursor).toBe(42);
  });
});

describe('EdgeDB — blocklist', () => {
  it('getBlocklist returns an empty Set for a fresh DB', () => {
    expect(db.getBlocklist()).toBeInstanceOf(Set);
    expect(db.getBlocklist().size).toBe(0);
  });

  it('upsertBlocklist populates the blocklist', () => {
    db.upsertBlocklist(['mem-blocked-01', 'mem-blocked-02']);
    const bl = db.getBlocklist();
    expect(bl.size).toBe(2);
    expect(bl.has('mem-blocked-01')).toBe(true);
    expect(bl.has('mem-blocked-02')).toBe(true);
  });

  it('upsertBlocklist replaces the entire list atomically', () => {
    db.upsertBlocklist(['mem-old-01', 'mem-old-02']);
    db.upsertBlocklist(['mem-new-01']);  // replace with a smaller list
    const bl = db.getBlocklist();
    expect(bl.size).toBe(1);
    expect(bl.has('mem-new-01')).toBe(true);
    expect(bl.has('mem-old-01')).toBe(false);
  });

  it('upsertBlocklist with empty array clears the blocklist', () => {
    db.upsertBlocklist(['mem-to-clear']);
    db.upsertBlocklist([]);
    expect(db.getBlocklist().size).toBe(0);
  });
});
