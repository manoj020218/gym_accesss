import { api, type PaginatedResponse } from './client';

export interface Payment {
  _id: string;
  receiptNo: string;
  memberId?: string;
  memberName?: string;
  branchId: string;
  amount: number;
  discount: number;
  gstAmount: number;
  mode: string;
  purpose?: string;
  membershipId?: string;
  createdAt: string;
}

export interface PaymentSummary {
  totalRevenue: number;
  count: number;
  byMode: { _id: string; total: number; count: number }[];
}

export const paymentApi = {
  list: (params: { branchId?: string; memberId?: string; page?: number; limit?: number }) =>
    api.get<PaginatedResponse<Payment>>('/payments', { params }).then((r) => r.data),

  get: (id: string) => api.get<Payment>(`/payments/${id}`).then((r) => r.data),

  summary: (params: { branchId?: string; from?: string; to?: string }) =>
    api.get<PaymentSummary>('/payments/summary', { params }).then((r) => r.data),

  create: (body: Partial<Payment>) => api.post<Payment>('/payments', body).then((r) => r.data),
};
