import { Schema, model, type Document } from 'mongoose';
import type { PaymentMode } from '@edge-gym/shared-types';

export interface IPayment extends Document {
  memberId: string;
  branchId: string;
  membershipId?: string;
  amount: number;
  discount: number;
  gstAmount: number;
  totalAmount: number;
  mode: PaymentMode;
  referenceNo?: string;
  notes?: string;
  receiptNo: string;
  collectedBy: string;
  paidAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const paymentSchema = new Schema<IPayment>(
  {
    memberId:     { type: String, required: true, index: true },
    branchId:     { type: String, required: true, index: true },
    membershipId: { type: String, index: true },
    amount:       { type: Number, required: true },
    discount:     { type: Number, default: 0 },
    gstAmount:    { type: Number, default: 0 },
    totalAmount:  { type: Number, required: true },
    mode:         { type: String, required: true },
    referenceNo:  String,
    notes:        String,
    receiptNo:    { type: String, required: true, unique: true },
    collectedBy:  { type: String, required: true },
    paidAt:       { type: Date, required: true, index: true },
  },
  { timestamps: true },
);

paymentSchema.index({ branchId: 1, paidAt: -1 });
paymentSchema.index({ memberId: 1, paidAt: -1 });

export const Payment = model<IPayment>('Payment', paymentSchema);
