import { Schema, model, type Document } from 'mongoose';

export interface IBranch extends Document {
  name: string;
  address: string;
  phone: string;
  timezone: string;
  isActive: boolean;
  ownerId: string;
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
  },
  { timestamps: true },
);

export const Branch = model<IBranch>('Branch', branchSchema);
