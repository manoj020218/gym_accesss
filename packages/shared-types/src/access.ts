import type { AccessDecision, DenyReason, SubjectType, Zone } from './enums.js';

export interface AccessEventDTO {
  id: string;
  edgeDeviceId: string;
  branchId: string;
  zone: Zone;
  subjectType: SubjectType;
  subjectId: string;
  subjectName?: string;
  decision: AccessDecision;
  denyReason?: DenyReason;
  identifierUsed: 'rfid' | 'qr' | 'face' | 'card' | 'manual';
  eventTime: string;
  syncState: 'pending' | 'synced';
  localSeq: number;
}

export interface AttendanceDTO {
  memberId: string;
  memberName: string;
  branchId: string;
  checkInTime: string;
  checkOutTime?: string;
  duration?: number;
  zone: Zone;
}

export interface AccessDeniedReportRow {
  eventTime: string;
  subjectId: string;
  subjectName: string;
  zone: Zone;
  denyReason: DenyReason;
  deviceId: string;
}

export interface ZoneStatusDTO {
  zone: Zone;
  branchId: string;
  currentOccupancy: number;
  lastEventTime?: string;
  isActive: boolean;
}

export interface AccessEventQuery {
  branchId?: string;
  memberId?: string;
  zone?: Zone;
  decision?: AccessDecision;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}
