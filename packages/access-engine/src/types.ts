import type {
  AccessDecision, DenyReason, SubjectType, Zone,
  MemberStatus, EdgeMemberRecord, EdgeStaffRecord,
  EdgeAccessPolicy,
} from '@edge-gym/shared-types';

export interface AccessRequest {
  subjectType: SubjectType;
  subjectId: string;
  identifierUsed: 'rfid' | 'qr' | 'face' | 'card' | 'manual';
  zone: Zone;
  requestTime: Date;
  deviceId: string;
  branchId: string;
}

export interface AccessContext {
  member?: EdgeMemberRecord;
  staff?: EdgeStaffRecord;
  blocklist: Set<string>;
  policies: EdgeAccessPolicy[];
  lastEntryBySubject: Map<string, Date>;
}

export interface AccessResult {
  decision: AccessDecision;
  denyReason?: DenyReason;
  subjectName?: string;
  allowedUntil?: Date;
  triggerRelay: boolean;
}

export interface RuleResult {
  pass: boolean;
  denyReason?: DenyReason;
}

export type Rule = (
  req: AccessRequest,
  ctx: AccessContext,
) => RuleResult;
