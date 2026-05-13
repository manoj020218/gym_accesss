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
  ipAddress?: string;
  port?: number;
  machineSn?: string;
  mqttLiveEnabled?: boolean;
  mqttBrokerUrl?: string;
  mqttInfoTopic?: string;
  mqttConnected?: boolean;
  pendingEventCount?: number;
  createdAt: string;
}

export const accessApi = {
  events: (params: {
    memberId?: string;
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

  ping: (deviceCode: string, deviceIp: string, devicePort?: number, machinePassword?: string) =>
    api
      .post<{ ok: boolean; foundPort: number; deviceId?: string }>(
        `/access-devices/${deviceCode}/ping`, { deviceIp, devicePort, machinePassword },
      )
      .then((r) => r.data),

  u5Employees: (deviceId: string) =>
    api
      .get<{ employees: Array<{ userId: string; name: string; id_number?: string }> }>(
        `/access-devices/${deviceId}/u5-employees`,
      )
      .then((r) => r.data)
      .catch(() => ({ employees: [] })),

  fastConnect: (deviceCode: string, body: {
    deviceIp: string; devicePort?: number;
    username?: string; password?: string; sn?: string;
  }) =>
    api
      .post<{ success: boolean; deviceId?: string; uptime?: number }>(
        `/access-devices/${deviceCode}/fast-connect`, body,
      )
      .then((r) => r.data),

  syncAttendance: (deviceId: string) =>
    api
      .post<{
        imported: number;
        total:    number;
        records:  Array<{
          subjectName?: string;
          eventTime:    string;
          faceUrl?:     string; // edge storage URL for matched members
          pic?:         string; // inline base64 for unmatched faces only
          isNew:        boolean;
          matched:      boolean;
          ispass:       number;
        }>;
      }>(`/access-devices/${deviceId}/sync-attendance`)
      .then((r) => r.data),

  syncStatus: (deviceId: string) =>
    api
      .get<{
        totalOnMachine: number;
        totalEnrolled: number;
        missingFromMachine: Array<{ memberId: string; memberCode: string; name: string }>;
        orphans: Array<{ userId: string; name: string; id_number?: string }>;
      }>(`/access-devices/${deviceId}/sync-status`)
      .then((r) => r.data)
      .catch(() => null),

  strangerLogs: (deviceId: string) =>
    api
      .get<{ total: number; data: Array<{ userid: string | number; checkin_time: string; pic?: string }> }>(
        `/access-devices/${deviceId}/stranger-logs`,
      )
      .then((r) => r.data)
      .catch(() => ({ total: 0, data: [] as Array<{ userid: string | number; checkin_time: string; pic?: string }> })),

  saveMqttConfig: (deviceId: string, body: {
    machineSn:     string;
    mqttBrokerUrl: string;
    mqttInfoTopic: string;
    mqttUsername?: string;
    mqttPassword?: string;
  }) =>
    api
      .put<{ ok: boolean }>(`/access-devices/${deviceId}/mqtt-config`, body)
      .then((r) => r.data),

  logSetup: (body: {
    sessionId: string; branchId: string; deviceCode: string;
    step: string; confirmedValue?: string; metadata?: Record<string, unknown>;
  }) =>
    api.post('/device-setup-log', body).then((r) => r.data).catch(() => null),
};
