import type { StaffRole, Zone } from './enums.js';

export interface StaffDTO {
  id: string;
  branchId: string;
  firstName: string;
  lastName: string;
  phone: string;
  email?: string;
  role: StaffRole;
  allowedZones: Zone[];
  shiftStart: string;
  shiftEnd: string;
  rfidCardId?: string;
  isActive: boolean;
  joinedAt: string;
}

export interface CreateStaffBody {
  branchId: string;
  firstName: string;
  lastName: string;
  phone: string;
  email?: string;
  role: StaffRole;
  allowedZones?: Zone[];
  shiftStart: string;
  shiftEnd: string;
}

export interface StaffAttendanceDTO {
  staffId: string;
  staffName: string;
  branchId: string;
  checkIn?: string;
  checkOut?: string;
  date: string;
  isPresent: boolean;
}
