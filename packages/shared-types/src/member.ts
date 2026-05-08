import type { MemberStatus, PlanType, Zone } from './enums.js';

export interface MemberDTO {
  id: string;
  memberCode: string;
  branchId: string;
  firstName: string;
  lastName: string;
  phone: string;
  email?: string;
  address?: string;
  photoUrl?: string;
  emergencyContact?: { name: string; phone: string };
  dateOfBirth?: string;
  status: MemberStatus;
  allowedZones: Zone[];
  allowedBranchIds: string[];
  rfidCardId?: string;
  qrToken?: string;
  faceEnrolled?: boolean;
  healthDeclarationSigned?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateMemberBody {
  branchId: string;
  firstName: string;
  lastName: string;
  phone: string;
  email?: string;
  address?: string;
  emergencyContact?: { name: string; phone: string };
  dateOfBirth?: string;
  planType: PlanType;
  planStartDate: string;
  allowedBranchIds?: string[];
}

export interface UpdateMemberBody {
  firstName?: string;
  lastName?: string;
  email?: string;
  address?: string;
  photoUrl?: string;
  emergencyContact?: { name: string; phone: string };
  allowedZones?: Zone[];
  allowedBranchIds?: string[];
  rfidCardId?: string;
}

export interface BlockMemberBody {
  reason: string;
}

export interface MemberListQuery {
  branchId?: string;
  status?: MemberStatus;
  planType?: PlanType;
  search?: string;
  page?: number;
  limit?: number;
}
