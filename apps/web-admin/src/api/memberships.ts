import { api } from './client';

export interface MemberPlan {
  _id: string;
  name: string;
  planType: string;
  durationValue: number;
  durationUnit: string;
  price: number;
  gstPercent: number;
  allowedZones: string[];
  isActive: boolean;
  branchId: string;
}

export interface Membership {
  _id: string;
  memberId: string;
  branchId: string;
  planId: string;
  planType: string;
  status: 'active' | 'expired' | 'frozen' | 'cancelled';
  startDate: string;
  endDate: string;
  renewalCount: number;
  freezeDaysUsed: number;
  createdAt: string;
}

export const membershipApi = {
  plans: (branchId: string) =>
    api.get<MemberPlan[]>('/member-plans', { params: { branchId } }).then((r) => r.data),

  createPlan: (body: {
    name: string; planType: string; durationValue: number; durationUnit: string;
    price: number; gstPercent: number; branchId: string; allowedZones: string[];
  }) => api.post<MemberPlan>('/member-plans', body).then((r) => r.data),

  listForMember: (memberId: string) =>
    api.get<Membership[]>('/memberships', { params: { memberId } }).then((r) => r.data),

  create: (body: {
    memberId: string;
    branchId: string;
    planId: string;
    startDate: string;
    paymentMode: string;
    amountPaid: number;
    discount: number;
  }) => api.post<Membership>('/memberships', body).then((r) => r.data),

  renew: (
    id: string,
    body: { paymentMode: string; amountPaid: number; discount: number },
  ) => api.post<Membership>(`/memberships/${id}/renew`, body).then((r) => r.data),

  freeze: (
    id: string,
    body: { freezeStartDate: string; freezeEndDate: string; reason?: string },
  ) => api.post<Membership>(`/memberships/${id}/freeze`, body).then((r) => r.data),
};
