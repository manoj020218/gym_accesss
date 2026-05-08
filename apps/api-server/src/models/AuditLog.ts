import { Schema, model, type Document } from 'mongoose';

export interface IAuditLog extends Document {
  actorId: string;
  actorEmail: string;
  actorRole: string;
  branchId?: string;
  action: string;
  resourceType: string;
  resourceId: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
  createdAt: Date;
}

const auditLogSchema = new Schema<IAuditLog>(
  {
    actorId:      { type: String, required: true, index: true },
    actorEmail:   { type: String, required: true },
    actorRole:    { type: String, required: true },
    branchId:     { type: String, index: true },
    action:       { type: String, required: true, index: true },
    resourceType: { type: String, required: true },
    resourceId:   { type: String, required: true, index: true },
    before:       Schema.Types.Mixed,
    after:        Schema.Types.Mixed,
    ip:           String,
    userAgent:    String,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

auditLogSchema.index({ createdAt: -1 });

export const AuditLog = model<IAuditLog>('AuditLog', auditLogSchema);
