import { Schema, model, type Document } from 'mongoose';
import type { Zone } from '@edge-gym/shared-types';

export interface IMachineUser {
  deviceCode: string;
  machineUserId: string;
}

export interface IStaff extends Document {
  branchId: string;
  userId?: string;
  firstName: string;
  lastName: string;
  phone: string;
  email?: string;
  role: string;
  allowedZones: Zone[];
  shiftStart?: string;
  shiftEnd?: string;
  rfidCardId?: string;
  faceEnrolled: boolean;
  machineUsers: IMachineUser[];
  isActive: boolean;
  joinedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const staffSchema = new Schema<IStaff>(
  {
    branchId:    { type: String, required: true, index: true },
    userId:      { type: String, index: true },
    firstName:   { type: String, required: true, trim: true },
    lastName:    { type: String, required: true, trim: true },
    phone:       { type: String, required: true },
    email:       { type: String, lowercase: true },
    role:        { type: String, required: true },
    allowedZones: [String],
    shiftStart:  { type: String },
    shiftEnd:    { type: String },
    rfidCardId:  { type: String, sparse: true },
    faceEnrolled: { type: Boolean, default: false },
    machineUsers: {
      type: [{ deviceCode: String, machineUserId: String }],
      default: [],
    },
    isActive:    { type: Boolean, default: true },
    joinedAt:    { type: Date, default: Date.now },
  },
  { timestamps: true },
);

export const Staff = model<IStaff>('Staff', staffSchema);
