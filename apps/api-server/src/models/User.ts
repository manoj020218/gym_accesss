import { Schema, model, type Document } from 'mongoose';
import type { StaffRole } from '@edge-gym/shared-types';

export interface IUser extends Document {
  firebaseUid: string;
  email: string;
  displayName: string;
  photoUrl?: string;
  role: StaffRole;
  branchIds: string[];
  isActive: boolean;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    firebaseUid:  { type: String, required: true, unique: true, index: true },
    email:        { type: String, required: true, lowercase: true, index: true },
    displayName:  { type: String, required: true },
    photoUrl:     String,
    role:         { type: String, required: true },
    branchIds:    [String],
    isActive:     { type: Boolean, default: true },
    lastLoginAt:  Date,
  },
  { timestamps: true },
);

export const User = model<IUser>('User', userSchema);
