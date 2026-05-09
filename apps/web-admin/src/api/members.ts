import { api, type PaginatedResponse } from './client';

export interface Member {
  _id: string;
  memberCode: string;
  firstName: string;
  lastName: string;
  phone: string;
  email?: string;
  branchId: string;
  status: 'pending' | 'active' | 'expired' | 'blocked' | 'frozen';
  rfidCardId?: string;
  qrToken?: string;
  fcmToken?: string;
  faceEnrolled?: boolean;
  hasDues?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MemberListParams {
  branchId?: string;
  status?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export const memberApi = {
  list: (params: MemberListParams = {}) =>
    api.get<PaginatedResponse<Member>>('/members', { params }).then((r) => r.data),

  get: (id: string) => api.get<Member>(`/members/${id}`).then((r) => r.data),

  create: (body: Partial<Member>) => api.post<Member>('/members', body).then((r) => r.data),

  update: (id: string, body: Partial<Member>) =>
    api.put<Member>(`/members/${id}`, body).then((r) => r.data),

  block: (id: string, reason: string) =>
    api.post(`/members/${id}/block`, { reason }).then((r) => r.data),

  unblock: (id: string) => api.post(`/members/${id}/unblock`).then((r) => r.data),

  regenerateQr: (id: string) =>
    api.post<{ qrToken: string }>(`/members/${id}/qr-token`).then((r) => r.data),

  enrollFace: (id: string) =>
    api.post<{ success: boolean; memberId: string; memberCode: string; message: string }>(
      `/members/${id}/enroll-face`,
    ).then((r) => r.data),
};
