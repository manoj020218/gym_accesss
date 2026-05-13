import { Schema, model, type Document } from 'mongoose';
import type { MemberStatus, Zone } from '@edge-gym/shared-types';

export interface IMember extends Document {
  memberCode: string;
  branchId: string;
  firstName: string;
  lastName: string;
  phone: string;
  email?: string;
  address?: string;
  photoUrl?: string;
  dateOfBirth?: Date;
  emergencyContact?: { name: string; phone: string };
  status: MemberStatus;
  allowedZones: Zone[];
  allowedBranchIds: string[];
  rfidCardId?: string;
  qrToken?: string;
  faceEnrolled: boolean;
  machineUsers?: Array<{ deviceCode: string; machineUserId: string }>;
  faceRef?: {
    machineUserId: string;  // U5-assigned userid (e.g. "1711731668")
    deviceSn:      string;  // which U5 machine
    filename:      string;  // "{userId}_{YYYYMMDD}.jpg" — path under storage/faces/{memberCode}/
    syncedAt:      Date;
  };
  healthDeclarationSigned: boolean;
  fcmToken?: string;
  blacklistReason?: string;
  blacklistedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const memberSchema = new Schema<IMember>(
  {
    memberCode:    { type: String, required: true, unique: true, index: true },
    branchId:      { type: String, required: true, index: true },
    firstName:     { type: String, required: true, trim: true },
    lastName:      { type: String, required: true, trim: true },
    phone:         { type: String, required: true, index: true },
    email:         { type: String, lowercase: true, sparse: true, index: true },
    address:       String,
    photoUrl:      String,
    dateOfBirth:   Date,
    emergencyContact: { name: String, phone: String },
    status:        { type: String, required: true, index: true },
    allowedZones:  [String],
    allowedBranchIds: [String],
    rfidCardId:    { type: String, sparse: true, index: true },
    qrToken:       { type: String, sparse: true, index: true },
    faceEnrolled:            { type: Boolean, default: false },
    machineUsers:            [{ deviceCode: String, machineUserId: String, _id: false }],
    faceRef: {
      type: {
        machineUserId: { type: String, required: true },
        deviceSn:      { type: String, required: true },
        filename:      { type: String, required: true },
        syncedAt:      { type: Date,   required: true },
      },
      default: undefined,
      _id: false,
    },
    healthDeclarationSigned: { type: Boolean, default: false },
    fcmToken:        { type: String, sparse: true },
    blacklistReason: String,
    blacklistedAt:   Date,
  },
  { timestamps: true },
);

memberSchema.index({ branchId: 1, memberCode: 1 });
memberSchema.index({ phone: 1 });
memberSchema.index({ branchId: 1, status: 1 });

export const Member = model<IMember>('Member', memberSchema);
