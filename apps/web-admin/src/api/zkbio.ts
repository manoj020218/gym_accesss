import { api } from './client';

export interface ZkbioEmployee {
  _id: string;
  deviceSn: string;
  machineUserId: string;
  name: string;
  passDate: string;
  passTime: string;
  memberId?: string;
  importedAt: string;
  createdAt: string;
}

export const zkbioApi = {
  list: (deviceSn: string) =>
    api.get<{ employees: ZkbioEmployee[] }>('/zkbio-employees', { params: { deviceSn } })
      .then(r => r.data.employees),

  import: (deviceSn: string, employees: unknown[]) =>
    api.post<{ inserted: number; updated: number; skipped: number; total: number }>(
      '/zkbio-employees/import', { deviceSn, employees },
    ).then(r => r.data),

  link: (deviceSn: string, machineUserId: string, memberId: string | null) =>
    api.patch(`/zkbio-employees/${deviceSn}/${encodeURIComponent(machineUserId)}/link`, { memberId })
      .then(r => r.data),

  // Web-admin driven enrollment: upload photo → machine syncs via selectPassInfo
  enroll: (deviceSn: string, memberId: string, picLarge: string) =>
    api.post<{ employee: ZkbioEmployee }>('/zkbio-employees/enroll', { deviceSn, memberId, picLarge })
      .then(r => r.data.employee),

  // Soft-delete: sets deletedAt → machine removes template via selectDeleteInfo
  removeEnrollment: (deviceSn: string, machineUserId: string) =>
    api.delete(`/zkbio-employees/${deviceSn}/${encodeURIComponent(machineUserId)}`)
      .then(r => r.data),

  // Get all active (non-deleted) enrollments for a member
  getMemberEnrollments: (memberId: string) =>
    api.get<{ employees: ZkbioEmployee[] }>(`/zkbio-employees/member/${memberId}`)
      .then(r => r.data.employees),
};
