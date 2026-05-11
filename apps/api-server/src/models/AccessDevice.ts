import { Schema, model, type Document } from 'mongoose';
import type { DeviceType, DeviceProtocol, Zone } from '@edge-gym/shared-types';

export interface IAccessDevice extends Document {
  deviceCode: string;
  name: string;
  branchId: string;
  zone: Zone;
  type: DeviceType;
  protocol: DeviceProtocol;
  ipAddress?: string;
  port?: number;
  edgeServiceIp?: string;
  edgeServicePort?: number;
  machinePassword?: string;
  machineSn?: string;        // U5 physical serial number printed on device (e.g. ZY20240703003)
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
  // MQTT live-access config (set via Settings → Live Access wizard)
  mqttBrokerUrl?: string;    // e.g. "mqtt://localhost:1883"
  mqttInfoTopic?: string;    // full topic device publishes to: "info/TOKEN/ZY20240703003"
  mqttUsername?: string;
  mqttPassword?: string;
  mqttLiveEnabled?: boolean; // true once configured and edge service confirmed connection
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
    machineSn:       String,
    serialPort:      String,
    baudRate:        Number,
    mqttBrokerUrl:   String,
    mqttInfoTopic:   String,
    mqttUsername:    String,
    mqttPassword:    String,
    mqttLiveEnabled: Boolean,
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
