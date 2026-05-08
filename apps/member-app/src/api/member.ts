import { api } from './client';

export interface MemberProfile {
  _id: string;
  memberCode: string;
  firstName: string;
  lastName: string;
  phone: string;
  email?: string;
  status: 'pending' | 'active' | 'expired' | 'blocked' | 'frozen';
  rfidCardId?: string;
  qrToken?: string;
  branchId: string;
  createdAt: string;
}

export interface ActiveMembership {
  _id: string;
  planType: string;
  status: string;
  startDate: string;
  endDate: string;
  renewalCount: number;
  freezeDaysUsed: number;
}

export interface AccessHistoryEvent {
  _id: string;
  zone: string;
  decision: 'ALLOW' | 'DENY';
  denyReason?: string;
  identifierUsed: string;
  eventTime: string;
}

export const memberApi = {
  getProfile: (id: string) =>
    api.get<MemberProfile>(`/members/${id}`).then((r) => r.data),

  getMemberships: (id: string) =>
    api.get<ActiveMembership[]>('/memberships', { params: { memberId: id } }).then((r) => r.data),

  getAccessHistory: (memberId: string, limit = 20) =>
    api
      .get<{ data: AccessHistoryEvent[]; total: number }>('/access/events', {
        params: { subjectId: memberId, limit },
      })
      .then((r) => r.data),

  registerFcmToken: (memberId: string, fcmToken: string) =>
    api.put(`/members/${memberId}/fcm-token`, { fcmToken }),

  regenerateQr: (memberId: string) =>
    api.post<{ qrToken: string }>(`/members/${memberId}/qr-token`).then((r) => r.data),
};
