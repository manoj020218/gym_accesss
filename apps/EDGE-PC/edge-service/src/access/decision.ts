import { randomUUID } from 'crypto';
import { evaluateAccess } from '@edge-gym/access-engine';
import { SubjectType }    from '@edge-gym/shared-types';
import type { AccessRequest, AccessContext } from '@edge-gym/access-engine';
import type { EdgeDB } from '../db/sqlite.js';
import type { Zone }   from '@edge-gym/shared-types';
import { config }      from '../config.js';

const passbackCache = new Map<string, Date>();

export interface DecisionInput {
  identifierValue: string;
  identifierType: 'rfid' | 'qr' | 'face' | 'card' | 'manual';
  zone: Zone;
}

export interface DecisionOutput {
  eventId:     string;
  decision:    string;
  denyReason?: string;
  subjectId:   string;
  subjectName?: string;
  subjectType: string;
  triggerRelay: boolean;
  eventTime:   string;
  localSeq:    number;
}

export function decide(db: EdgeDB, input: DecisionInput): DecisionOutput {
  const eventTime = new Date();
  const eventId   = randomUUID();

  let subject: ReturnType<typeof db.getMemberByRfid> | ReturnType<typeof db.getStaffByRfid>;
  let subjectType: SubjectType = SubjectType.Member;
  let subjectId = 'unknown';

  if (input.identifierType === 'rfid') {
    subject = db.getMemberByRfid(input.identifierValue);
    if (!subject) {
      subject = db.getStaffByRfid(input.identifierValue);
      subjectType = SubjectType.Staff;
    }
  } else if (input.identifierType === 'qr') {
    subject = db.getMemberByQr(input.identifierValue);
  }

  if (subject) subjectId = 'memberId' in subject ? subject.memberId : subject.staffId;

  const ctx: AccessContext = {
    member:   subjectType === SubjectType.Member
      ? (subject as Parameters<typeof db.getMemberByRfid>[0] extends string ? ReturnType<typeof db.getMemberByRfid> : undefined)
      : undefined,
    staff:    subjectType === SubjectType.Staff
      ? (subject as ReturnType<typeof db.getStaffByRfid>)
      : undefined,
    blocklist:           db.getBlocklist(),
    policies:            db.getPolicies(),
    lastEntryBySubject:  passbackCache,
  };

  const req: AccessRequest = {
    subjectType,
    subjectId,
    identifierUsed: input.identifierType,
    zone:           input.zone,
    requestTime:    eventTime,
    deviceId:       config.EDGE_DEVICE_ID,
    branchId:       config.EDGE_BRANCH_ID,
  };

  const result = evaluateAccess(req, ctx);

  const localSeq = db.appendEvent({
    eventId, deviceId: config.EDGE_DEVICE_ID, branchId: config.EDGE_BRANCH_ID,
    zone: input.zone, subjectType, subjectId,
    subjectName: result.subjectName,
    decision:    result.decision, denyReason: result.denyReason,
    identifierUsed: input.identifierType, eventTime: eventTime.toISOString(),
  });

  return {
    eventId, decision: result.decision, denyReason: result.denyReason,
    subjectId, subjectName: result.subjectName, subjectType,
    triggerRelay: result.triggerRelay,
    eventTime: eventTime.toISOString(), localSeq,
  };
}
