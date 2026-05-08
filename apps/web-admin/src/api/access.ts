import { api, type PaginatedResponse } from './client';

export interface AccessEvent {
  _id: string;
  eventId: string;
  edgeDeviceId: string;
  branchId: string;
  zone: string;
  subjectType: 'member' | 'staff' | 'visitor';
  subjectId: string;
  subjectName?: string;
  decision: 'ALLOW' | 'DENY';
  denyReason?: string;
  identifierUsed: 'rfid' | 'qr' | 'face' | 'manual';
  eventTime: string;
  createdAt: string;
}

export interface AccessDevice {
  _id: string;
  deviceId: string;
  name: string;
  branchId: string;
  zone: string;
  type: string;
  isOnline: boolean;
  lastHeartbeat?: string;
  pendingEventCount?: number;
  createdAt: string;
}

export const accessApi = {
  events: (params: {
    branchId?: string;
    zone?: string;
    decision?: string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
  }) =>
    api.get<PaginatedResponse<AccessEvent>>('/access/events', { params }).then((r) => r.data),

  attendance: (memberId: string, params?: { from?: string; to?: string }) =>
    api.get(`/access/attendance/${memberId}`, { params }).then((r) => r.data),

  devices: (branchId?: string) =>
    api
      .get<AccessDevice[]>('/access-devices', { params: { branchId } })
      .then((r) => r.data)
      .catch(() => [] as AccessDevice[]),
};
