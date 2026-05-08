import { Schema, model, type Document } from 'mongoose';
import type { AccessDecision, DenyReason, SubjectType, Zone } from '@edge-gym/shared-types';

export interface IAccessEvent extends Document {
  edgeDeviceId: string;
  branchId: string;
  zone: Zone;
  subjectType: SubjectType;
  subjectId: string;
  subjectName?: string;
  decision: AccessDecision;
  denyReason?: DenyReason;
  identifierUsed: string;
  localSeq: number;
  eventTime: Date;
  syncedAt?: Date;
  createdAt: Date;
}

const accessEventSchema = new Schema<IAccessEvent>(
  {
    edgeDeviceId: { type: String, required: true, index: true },
    branchId:     { type: String, required: true, index: true },
    zone:         { type: String, required: true },
    subjectType:  { type: String, required: true },
    subjectId:    { type: String, required: true, index: true },
    subjectName:  String,
    decision:     { type: String, required: true },
    denyReason:   String,
    identifierUsed: { type: String, required: true },
    localSeq:     { type: Number, required: true },
    eventTime:    { type: Date, required: true, index: true },
    syncedAt:     Date,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// Dedupe index — prevents duplicate sync pushes
accessEventSchema.index({ edgeDeviceId: 1, localSeq: 1 }, { unique: true });
accessEventSchema.index({ branchId: 1, eventTime: -1 });
accessEventSchema.index({ subjectId: 1, eventTime: -1 });

export const AccessEvent = model<IAccessEvent>('AccessEvent', accessEventSchema);
