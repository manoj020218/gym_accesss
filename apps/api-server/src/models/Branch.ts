import { Schema, model, type Document } from 'mongoose';

export interface IBranch extends Document {
  name: string;
  address: string;
  phone: string;
  timezone: string;
  isActive: boolean;
  ownerId: string;
  // Access hours — when enabled, edge service enforces time-window at door
  accessHoursEnabled: boolean;
  accessHoursStart: string;    // "HH:MM", e.g. "06:00"
  accessHoursEnd: string;      // "HH:MM", e.g. "22:00"
  accessAllowedDays: number[]; // 0=Sun … 6=Sat, default all 7
  // GST / tax settings
  gstEnabled: boolean;
  gstPercent: number;           // default 18
  gstEffectiveDate?: Date;      // when current rate took effect
  // Custom staff roles defined by this gym
  customStaffRoles: string[];
  createdAt: Date;
  updatedAt: Date;
}

const branchSchema = new Schema<IBranch>(
  {
    name:      { type: String, required: true, trim: true },
    address:   { type: String, required: true },
    phone:     { type: String, required: true },
    timezone:  { type: String, default: 'Asia/Kolkata' },
    isActive:  { type: Boolean, default: true },
    ownerId:   { type: String, required: true, index: true },
    accessHoursEnabled: { type: Boolean, default: false },
    accessHoursStart:   { type: String, default: '00:00' },
    accessHoursEnd:     { type: String, default: '23:59' },
    accessAllowedDays:  { type: [Number], default: [0, 1, 2, 3, 4, 5, 6] },
    gstEnabled:         { type: Boolean, default: false },
    gstPercent:         { type: Number, default: 18 },
    gstEffectiveDate:   Date,
    customStaffRoles:   { type: [String], default: [] },
  },
  { timestamps: true },
);

export const Branch = model<IBranch>('Branch', branchSchema);
