import { api, type PaginatedResponse } from './client';

export interface StaffMember {
  _id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email?: string;
  role: string;
  branchId: string;
  isActive: boolean;
  rfidCardId?: string;
  shiftStart?: string;
  shiftEnd?: string;
  faceEnrolled?: boolean;
  machineUsers?: { deviceCode: string; machineUserId: string }[];
  createdAt: string;
}

export const staffApi = {
  list: (params: { branchId?: string; role?: string; page?: number; limit?: number }) =>
    api.get<PaginatedResponse<StaffMember>>('/staff', { params }).then((r) => r.data),

  get: (id: string) => api.get<StaffMember>(`/staff/${id}`).then((r) => r.data),

  create: (body: Partial<StaffMember>) =>
    api.post<StaffMember>('/staff', body).then((r) => r.data),

  update: (id: string, body: Partial<StaffMember>) =>
    api.put<StaffMember>(`/staff/${id}`, body).then((r) => r.data),

  remove: (id: string) => api.delete(`/staff/${id}`),

  attendance: (id: string, params: { from?: string; to?: string }) =>
    api.get(`/staff/${id}/attendance`, { params }).then((r) => r.data),

  enrollFace: (id: string, imageBase64: string) =>
    api.post<{ enrolled: boolean; machineUserId?: string; deviceCode?: string }>(
      `/staff/${id}/enroll-face`,
      { imageBase64 },
    ).then((r) => r.data),

  updatePermissions: (userId: string, permissions: string[]) =>
    api.put<{ userId: string; permissions: string[] }>(`/users/${userId}/permissions`, { permissions }).then((r) => r.data),
};
