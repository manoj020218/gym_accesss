import { evaluateAccess } from '../engine.js';
import {
  AccessDecision, DenyReason, MemberStatus,
  SubjectType, Zone,
} from '@edge-gym/shared-types';
import type { AccessRequest, AccessContext } from '../types.js';

const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
const yesterday = new Date(Date.now() - 86_400_000).toISOString();

const baseMember = {
  memberId: 'mem-001',
  memberCode: 'MEM001',
  status: MemberStatus.Active,
  activeUntil: tomorrow,
  allowedZones: [Zone.MainEntry, Zone.Cardio],
  allowedBranchIds: ['branch-001'],
  planType: 'premium',
  hasDues: false,
};

const baseRequest: AccessRequest = {
  subjectType: SubjectType.Member,
  subjectId: 'mem-001',
  identifierUsed: 'rfid',
  zone: Zone.MainEntry,
  requestTime: new Date(),
  deviceId: 'dev-001',
  branchId: 'branch-001',
};

const baseCtx: AccessContext = {
  member: baseMember,
  blocklist: new Set(),
  policies: [],
  lastEntryBySubject: new Map(),
};

describe('access-engine', () => {
  test('allows valid active member', () => {
    const result = evaluateAccess(baseRequest, baseCtx);
    expect(result.decision).toBe(AccessDecision.Allow);
    expect(result.triggerRelay).toBe(true);
  });

  test('denies blacklisted member', () => {
    const ctx: AccessContext = { ...baseCtx, blocklist: new Set(['mem-001']) };
    const result = evaluateAccess(baseRequest, ctx);
    expect(result.decision).toBe(AccessDecision.Deny);
    expect(result.denyReason).toBe(DenyReason.Blacklisted);
  });

  test('denies expired member', () => {
    const ctx: AccessContext = {
      ...baseCtx,
      member: { ...baseMember, status: MemberStatus.Expired, activeUntil: yesterday },
    };
    const result = evaluateAccess(baseRequest, ctx);
    expect(result.decision).toBe(AccessDecision.Deny);
    expect(result.denyReason).toBe(DenyReason.MemberExpired);
  });

  test('denies frozen member', () => {
    const ctx: AccessContext = {
      ...baseCtx,
      member: { ...baseMember, status: MemberStatus.Frozen },
    };
    const result = evaluateAccess(baseRequest, ctx);
    expect(result.decision).toBe(AccessDecision.Deny);
    expect(result.denyReason).toBe(DenyReason.MemberFrozen);
  });

  test('denies member with dues', () => {
    const ctx: AccessContext = {
      ...baseCtx,
      member: { ...baseMember, hasDues: true },
    };
    const result = evaluateAccess(baseRequest, ctx);
    expect(result.decision).toBe(AccessDecision.Deny);
    expect(result.denyReason).toBe(DenyReason.PaymentDue);
  });

  test('denies zone not in allowedZones', () => {
    const req: AccessRequest = { ...baseRequest, zone: Zone.PTRoom };
    const result = evaluateAccess(req, baseCtx);
    expect(result.decision).toBe(AccessDecision.Deny);
    expect(result.denyReason).toBe(DenyReason.NotInAllowedZone);
  });

  test('denies member from different branch', () => {
    const req: AccessRequest = { ...baseRequest, branchId: 'branch-999' };
    const result = evaluateAccess(req, baseCtx);
    expect(result.decision).toBe(AccessDecision.Deny);
    expect(result.denyReason).toBe(DenyReason.BranchNotPermitted);
  });

  test('denies outside time window', () => {
    const midnight = new Date();
    midnight.setHours(2, 0, 0, 0);
    const req: AccessRequest = { ...baseRequest, requestTime: midnight };
    const ctx: AccessContext = {
      ...baseCtx,
      policies: [{
        zone: Zone.MainEntry,
        allowedPlanTypes: [],
        antiPassbackEnabled: false,
        timeWindows: [{ dayOfWeek: [0,1,2,3,4,5,6], startTime: '06:00', endTime: '22:00' }],
      }],
    };
    const result = evaluateAccess(req, ctx);
    expect(result.decision).toBe(AccessDecision.Deny);
    expect(result.denyReason).toBe(DenyReason.OutsideTimeWindow);
  });

  test('denies anti-passback within 60 seconds', () => {
    const lastEntry = new Map<string, Date>();
    lastEntry.set('mem-001:main_entry', new Date(Date.now() - 10_000));
    const ctx: AccessContext = {
      ...baseCtx,
      policies: [{ zone: Zone.MainEntry, allowedPlanTypes: [], antiPassbackEnabled: true, timeWindows: [] }],
      lastEntryBySubject: lastEntry,
    };
    const result = evaluateAccess(baseRequest, ctx);
    expect(result.decision).toBe(AccessDecision.Deny);
    expect(result.denyReason).toBe(DenyReason.AntiPassback);
  });

  test('denies unknown identity', () => {
    const ctx: AccessContext = { ...baseCtx, member: undefined };
    const result = evaluateAccess(baseRequest, ctx);
    expect(result.decision).toBe(AccessDecision.Deny);
    expect(result.denyReason).toBe(DenyReason.UnknownIdentity);
  });
});
