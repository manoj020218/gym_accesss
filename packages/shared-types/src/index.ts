export * from './enums.js';
export * from './member.js';
export * from './membership.js';
export * from './access.js';
export * from './payment.js';
export * from './device.js';
export * from './sync.js';
export * from './staff.js';

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface ApiError {
  statusCode: number;
  error: string;
  message: string;
}

export interface BranchDTO {
  id: string;
  name: string;
  address: string;
  phone: string;
  timezone: string;
  isActive: boolean;
  ownerId: string;
  createdAt: string;
}

export interface UserDTO {
  id: string;
  email: string;
  displayName: string;
  photoUrl?: string;
  role: string;
  branchIds: string[];
  firebaseUid: string;
  isActive: boolean;
  lastLoginAt?: string;
}

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  branchIds: string[];
  iat: number;
  exp: number;
}
