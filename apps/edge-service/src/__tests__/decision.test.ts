import { describe, it, expect, beforeEach } from 'vitest';
import { EdgeDB } from '../db/sqlite.js';
import { decide } from '../access/decision.js';
import { MemberStatus, Zone, AccessDecision } from '@edge-gym/shared-types';

const tomorrow   = new Date(Date.now() + 86_400_000).toISOString();
const yesterday  = new Date(Date.now() - 86_400_000).toISOString();

const BRANCH_ID = 'test-branch-001'; // must match EDGE_BRANCH_ID in vitest env

function seedActiveMember(db: EdgeDB, rfidCardId = 'rfid-test-001') {
  db.upsertMembers([{
    memberId:         'mem-decide-001',
    memberCode:       'MEM001',
    rfidCardId,
    status:           MemberStatus.Active,
    activeUntil:      tomorrow,
    allowedZones:     [Zone.MainEntry, Zone.Cardio],
    allowedBranchIds: [BRANCH_ID],
    planType:         'basic',
    hasDues:          false,
  }]);
}

let db: EdgeDB;

beforeEach(() => {
  db = new EdgeDB(':memory:');
});

describe('decide() — access decisions', () => {
  it('ALLOW: active member scanning at allowed zone', () => {
    seedActiveMember(db);
    const result = decide(db, {
      identifierValue: 'rfid-test-001',
      identifierType:  'rfid',
      zone:            Zone.MainEntry,
    });

    expect(result.decision).toBe(AccessDecision.Allow);
    expect(result.triggerRelay).toBe(true);
    expect(result.subjectId).toBe('mem-decide-001');
  });

  it('DENY: unknown RFID card → UnknownIdentity', () => {
    const result = decide(db, {
      identifierValue: 'rfid-not-registered',
      identifierType:  'rfid',
      zone:            Zone.MainEntry,
    });

    expect(result.decision).toBe(AccessDecision.Deny);
    expect(result.denyReason).toBe('DENY_UNKNOWN_IDENTITY');
    expect(result.triggerRelay).toBe(false);
  });

  it('DENY: expired member', () => {
    db.upsertMembers([{
      memberId:         'mem-expired',
      memberCode:       'MEM002',
      rfidCardId:       'rfid-expired',
      status:           MemberStatus.Expired,
      activeUntil:      yesterday,
      allowedZones:     [Zone.MainEntry],
      allowedBranchIds: [BRANCH_ID],
      planType:         'basic',
      hasDues:          false,
    }]);

    const result = decide(db, {
      identifierValue: 'rfid-expired',
      identifierType:  'rfid',
      zone:            Zone.MainEntry,
    });

    expect(result.decision).toBe(AccessDecision.Deny);
    expect(result.denyReason).toBe('DENY_MEMBER_EXPIRED');
  });

  it('DENY: member scanning a zone they are not allowed in', () => {
    seedActiveMember(db);
    const result = decide(db, {
      identifierValue: 'rfid-test-001',
      identifierType:  'rfid',
      zone:            Zone.PTRoom,  // not in allowedZones: [MainEntry, Cardio]
    });

    expect(result.decision).toBe(AccessDecision.Deny);
    expect(result.denyReason).toBe('DENY_NOT_IN_ALLOWED_ZONE');
  });

  it('ALLOW: member with QR scan', () => {
    db.upsertMembers([{
      memberId:         'mem-qr',
      memberCode:       'MEM003',
      qrToken:          'qr-abc123',
      status:           MemberStatus.Active,
      activeUntil:      tomorrow,
      allowedZones:     [Zone.MainEntry],
      allowedBranchIds: [BRANCH_ID],
      planType:         'basic',
      hasDues:          false,
    }]);

    const result = decide(db, {
      identifierValue: 'qr-abc123',
      identifierType:  'qr',
      zone:            Zone.MainEntry,
    });

    expect(result.decision).toBe(AccessDecision.Allow);
  });

  it('appends an event to SQLite after every decision', () => {
    seedActiveMember(db);
    const before = db.getPendingEvents(100).length;

    decide(db, {
      identifierValue: 'rfid-test-001',
      identifierType:  'rfid',
      zone:            Zone.MainEntry,
    });

    const after = db.getPendingEvents(100).length;
    expect(after).toBe(before + 1);
  });

  it('returns localSeq that increments with each decision', () => {
    seedActiveMember(db);

    const r1 = decide(db, { identifierValue: 'rfid-test-001', identifierType: 'rfid', zone: Zone.MainEntry });
    const r2 = decide(db, { identifierValue: 'rfid-test-001', identifierType: 'rfid', zone: Zone.Cardio });

    expect(r2.localSeq).toBeGreaterThan(r1.localSeq);
  });
});
