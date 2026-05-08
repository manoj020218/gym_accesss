import { Schema, model, type Document } from 'mongoose';
import type { PlanType, PlanDurationUnit, Zone } from '@edge-gym/shared-types';

export interface IMemberPlan extends Document {
  name: string;
  planType: PlanType;
  durationValue: number;
  durationUnit: PlanDurationUnit;
  price: number;
  gstPercent: number;
  allowedZones: Zone[];
  features: string[];
  isActive: boolean;
  branchId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const memberPlanSchema = new Schema<IMemberPlan>(
  {
    name:          { type: String, required: true },
    planType:      { type: String, required: true },
    durationValue: { type: Number, required: true },
    durationUnit:  { type: String, required: true },
    price:         { type: Number, required: true },
    gstPercent:    { type: Number, default: 18 },
    allowedZones:  [String],
    features:      [String],
    isActive:      { type: Boolean, default: true },
    branchId:      { type: String, index: true },
  },
  { timestamps: true },
);

export const MemberPlan = model<IMemberPlan>('MemberPlan', memberPlanSchema);
