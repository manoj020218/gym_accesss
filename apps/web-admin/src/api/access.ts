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

  registerDevice: (branchId: string, name: string) =>
    api
      .post<{ deviceId: string; deviceCode: string; secret: string }>('/access-devices', { branchId, name })
      .then((r) => r.data),

  networkInfo: () =>
    api
      .get<{ addresses: string[]; port: number }>('/network-info')
      .then((r) => r.data)
      .catch(() => ({ addresses: [], port: 8080 })),

  fastConnect: (deviceCode: string, body: {
    deviceIp: string; devicePort?: number;
    username?: string; password?: string; sn?: string;
  }) =>
    api
      .post<{ success: boolean; deviceId?: string; uptime?: number }>(
        `/access-devices/${deviceCode}/fast-connect`, body,
      )
      .then((r) => r.data),

  logSetup: (body: {
    sessionId: string; branchId: string; deviceCode: string;
    step: string; confirmedValue?: string; metadata?: Record<string, unknown>;
  }) =>
    api.post('/device-setup-log', body).then((r) => r.data).catch(() => null),
};
