import type { AccessEventDTO } from './access.js';
import type { MemberStatus, Zone } from './enums.js';

export interface SyncPullResponse {
  policyVersion: number;
  members: EdgeMemberRecord[];
  staff: EdgeStaffRecord[];
  policies: EdgeAccessPolicy[];
  blocklist: string[];
  generatedAt: string;
}

export interface EdgeMemberRecord {
  memberId: string;
  memberCode: string;
  rfidCardId?: string;
  qrToken?: string;
  status: MemberStatus;
  activeUntil: string;
  allowedZones: Zone[];
  allowedBranchIds: string[];
  planType: string;
  hasDues: boolean;
}

export interface EdgeStaffRecord {
  staffId: string;
  name: string;
  role: string;
  allowedZones: Zone[];
  shiftStart: string;
  shiftEnd: string;
  rfidCardId?: string;
}

export interface EdgeAccessPolicy {
  zone: Zone;
  allowedPlanTypes: string[];
  timeWindows: TimeWindow[];
  antiPassbackEnabled: boolean;
}

export interface TimeWindow {
  dayOfWeek: number[];
  startTime: string;
  endTime: string;
}

export interface EdgePushBody {
  batchId: string;
  edgeDeviceId: string;
  branchId: string;
  fromSeq: number;
  toSeq: number;
  events: AccessEventDTO[];
  hmacSignature: string;
}

export interface EdgePushResponse {
  ackCursor: number;
  accepted: number;
  rejected: Array<{ eventId: string; reason: string }>;
}

export interface SyncCheckpointDTO {
  edgeDeviceId: string;
  lastPolicyVersion: number;
  lastEventAckCursor: number;
  lastHeartbeatAt: string;
}
