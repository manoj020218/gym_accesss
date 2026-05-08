import type { MemberStatus, PlanType, PlanDurationUnit } from './enums.js';

export interface MemberPlanDTO {
  id: string;
  name: string;
  planType: PlanType;
  durationValue: number;
  durationUnit: PlanDurationUnit;
  price: number;
  gstPercent: number;
  features: string[];
  isActive: boolean;
}

export interface MembershipDTO {
  id: string;
  memberId: string;
  branchId: string;
  planId: string;
  planType: PlanType;
  status: MemberStatus;
  startDate: string;
  endDate: string;
  freezeStartDate?: string;
  freezeEndDate?: string;
  freezeDaysUsed: number;
  renewalCount: number;
  createdAt: string;
}

export interface CreateMembershipBody {
  memberId: string;
  branchId: string;
  planId: string;
  startDate: string;
  paymentMode: string;
  amountPaid: number;
  discount?: number;
  notes?: string;
}

export interface RenewMembershipBody {
  planId?: string;
  startDate?: string;
  paymentMode: string;
  amountPaid: number;
  discount?: number;
  notes?: string;
}

export interface FreezeMembershipBody {
  freezeStartDate: string;
  freezeEndDate: string;
  reason?: string;
}
