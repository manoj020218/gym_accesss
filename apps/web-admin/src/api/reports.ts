import { api } from './client';

export interface StaffPunchRecord {
  _id: string;
  subjectId: string;
  subjectName?: string;
  machineUserId?: string;
  identifierUsed: string;
  edgeDeviceId: string;
  zone: string;
  eventTime: string;
}

export const reportsApi = {
  dues: (branchId?: string) =>
    api.get<{ data: unknown[] }>('/reports/dues', { params: { branchId } }).then((r) => r.data.data),

  dailyCollection: (params: { branchId?: string; from?: string; to?: string }) =>
    api.get<{ data: unknown[] }>('/reports/daily-collection', { params }).then((r) => r.data.data),

  expiring: (params: { branchId?: string; days?: number }) =>
    api.get<{ data: unknown[] }>('/reports/expiring', { params }).then((r) => r.data.data),

  accessDenied: (params: { branchId?: string; from?: string; to?: string }) =>
    api.get<{ data: unknown[] }>('/reports/access-denied', { params }).then((r) => r.data.data),

  stockLow: (branchId?: string) =>
    api.get<{ data: unknown[] }>('/reports/stock-low', { params: { branchId } }).then((r) => r.data.data),

  attendance: (params: { branchId?: string; from?: string; to?: string }) =>
    api.get<{ data: unknown[] }>('/reports/attendance', { params }).then((r) => r.data.data),

  staffAttendance: (params: { branchId?: string; from?: string; to?: string }) =>
    api.get<{ data: StaffPunchRecord[]; total: number }>('/reports/staff-attendance', { params }).then((r) => r.data),

  downloadAlogUrl: (params: { branchId?: string; from?: string; to?: string }) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][],
    ).toString();
    return `/reports/staff-attendance/download${qs ? `?${qs}` : ''}`;
  },
};
