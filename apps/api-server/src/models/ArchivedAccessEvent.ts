import { Schema, model, type Document } from 'mongoose';
import type { AccessDecision, DenyReason, SubjectType, Zone } from '@edge-gym/shared-types';

export interface IArchivedAccessEvent extends Document {
  edgeDeviceId:   string;
  branchId:       string;
  zone:           Zone;
  subjectType:    SubjectType;
  subjectId:      string;
  subjectName?:   string;
  decision:       AccessDecision;
  denyReason?:    DenyReason;
  identifierUsed: string;
  localSeq:       number;
  eventTime:      Date;
  syncedAt?:      Date;
  originalCreatedAt?: Date;
  archivedAt:     Date;
}

const archivedEventSchema = new Schema<IArchivedAccessEvent>(
  {
    edgeDeviceId:   { type: String, required: true, index: true },
    branchId:       { type: String, required: true, index: true },
    zone:           { type: String, required: true },
    subjectType:    { type: String, required: true },
    subjectId:      { type: String, required: true, index: true },
    subjectName:    String,
    decision:       { type: String, required: true },
    denyReason:     String,
    identifierUsed: { type: String, required: true },
    localSeq:       { type: Number, required: true },
    eventTime:      { type: Date, required: true, index: true },
    syncedAt:       Date,
    originalCreatedAt: Date,
    archivedAt:     { type: Date, required: true, default: Date.now, index: true },
  },
  { timestamps: false },
);

archivedEventSchema.index({ branchId: 1, eventTime: -1 });
archivedEventSchema.index({ edgeDeviceId: 1, localSeq: 1 }, { unique: true });

export const ArchivedAccessEvent = model<IArchivedAccessEvent>('ArchivedAccessEvent', archivedEventSchema);
