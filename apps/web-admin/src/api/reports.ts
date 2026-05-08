import { api } from './client';

export const reportsApi = {
  dues: (branchId?: string) =>
    api.get('/reports/dues', { params: { branchId } }).then((r) => r.data),

  dailyCollection: (params: { branchId?: string; from?: string; to?: string }) =>
    api.get('/reports/daily-collection', { params }).then((r) => r.data),

  expiring: (params: { branchId?: string; days?: number }) =>
    api.get('/reports/expiring', { params }).then((r) => r.data),

  accessDenied: (params: { branchId?: string; from?: string; to?: string }) =>
    api.get('/reports/access-denied', { params }).then((r) => r.data),

  stockLow: (branchId?: string) =>
    api.get('/reports/stock-low', { params: { branchId } }).then((r) => r.data),

  attendance: (params: { branchId?: string; from?: string; to?: string }) =>
    api.get('/reports/attendance', { params }).then((r) => r.data),
};
