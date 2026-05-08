import { Schema, model, type Document } from 'mongoose';

export interface ISyncCheckpoint extends Document {
  edgeDeviceId:      string;
  branchId:          string;
  lastPolicyVersion: number;
  lastEventAckCursor: number;
  lastHeartbeatAt:   Date;
  syncLag:           number;
  pendingEventCount: number;
  uptimeSeconds:     number;
  updatedAt:         Date;
}

const syncCheckpointSchema = new Schema<ISyncCheckpoint>(
  {
    edgeDeviceId:       { type: String, required: true, unique: true, index: true },
    branchId:           { type: String, required: true, index: true },
    lastPolicyVersion:  { type: Number, default: 0 },
    lastEventAckCursor: { type: Number, default: 0 },
    lastHeartbeatAt:    { type: Date, default: Date.now },
    syncLag:            { type: Number, default: 0 },
    pendingEventCount:  { type: Number, default: 0 },
    uptimeSeconds:      { type: Number, default: 0 },
  },
  { timestamps: { createdAt: false, updatedAt: true } },
);

export const SyncCheckpoint = model<ISyncCheckpoint>('SyncCheckpoint', syncCheckpointSchema);
