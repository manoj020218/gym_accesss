import { Schema, model, type Document } from 'mongoose';
import type { MemberStatus, PlanType } from '@edge-gym/shared-types';

export interface IMembership extends Document {
  memberId: string;
  branchId: string;
  planId: string;
  planType: PlanType;
  status: MemberStatus;
  startDate: Date;
  endDate: Date;
  freezeStartDate?: Date;
  freezeEndDate?: Date;
  freezeDaysUsed: number;
  renewalCount: number;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const membershipSchema = new Schema<IMembership>(
  {
    memberId:       { type: String, required: true, index: true },
    branchId:       { type: String, required: true, index: true },
    planId:         { type: String, required: true },
    planType:       { type: String, required: true },
    status:         { type: String, required: true, index: true },
    startDate:      { type: Date, required: true },
    endDate:        { type: Date, required: true, index: true },
    freezeStartDate: Date,
    freezeEndDate:   Date,
    freezeDaysUsed:  { type: Number, default: 0 },
    renewalCount:    { type: Number, default: 0 },
    notes:           String,
  },
  { timestamps: true },
);

membershipSchema.index({ memberId: 1, status: 1 });
membershipSchema.index({ endDate: 1, status: 1 });

export const Membership = model<IMembership>('Membership', membershipSchema);
