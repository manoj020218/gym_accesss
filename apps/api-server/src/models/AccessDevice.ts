import { Schema, model, type Document } from 'mongoose';
import type { DeviceType, DeviceProtocol, Zone } from '@edge-gym/shared-types';

export interface IAccessDevice extends Document {
  deviceCode: string;
  name: string;
  branchId: string;
  zone: Zone;
  type: DeviceType;
  protocol: DeviceProtocol;
  ipAddress?: string;    // physical hardware IP (e.g. ZKTeco terminal)
  port?: number;         // physical hardware port
  edgeServiceIp?: string;   // IP where our edge Node.js service is reachable
  edgeServicePort?: number; // port where our edge Node.js service is reachable
  machinePassword?: string; // U5 web UI admin password (default 123456)
  serialPort?: string;
  baudRate?: number;
  relayEnabled: boolean;
  antiPassback: 'disabled' | 'soft' | 'hard';
  secretKeyHash: string;
  isActive: boolean;
  lastHeartbeatAt?: Date;
  lastSyncAt?: Date;
  firmwareVersion?: string;
  notes?: string;
  registeredAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const accessDeviceSchema = new Schema<IAccessDevice>(
  {
    deviceCode:    { type: String, required: true, unique: true, index: true },
    name:          { type: String, required: true },
    branchId:      { type: String, required: true, index: true },
    zone:          { type: String, required: true },
    type:          { type: String, required: true },
    protocol:      { type: String, required: true },
    ipAddress:       String,
    port:            Number,
    edgeServiceIp:   String,
    edgeServicePort: Number,
    machinePassword: String,
    serialPort:      String,
    baudRate:      Number,
    relayEnabled:  { type: Boolean, default: true },
    antiPassback:  { type: String, default: 'disabled' },
    secretKeyHash: { type: String, required: true, select: false },
    isActive:      { type: Boolean, default: true },
    lastHeartbeatAt: Date,
    lastSyncAt:      Date,
    firmwareVersion: String,
    notes:           String,
    registeredAt:    { type: Date, default: Date.now },
  },
  { timestamps: true },
);

export const AccessDevice = model<IAccessDevice>('AccessDevice', accessDeviceSchema);
