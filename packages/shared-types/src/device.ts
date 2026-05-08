import type { DeviceType, DeviceProtocol, Zone } from './enums.js';

export interface AccessDeviceDTO {
  id: string;
  deviceCode: string;
  name: string;
  branchId: string;
  zone: Zone;
  type: DeviceType;
  protocol: DeviceProtocol;
  ipAddress?: string;
  port?: number;
  serialPort?: string;
  baudRate?: number;
  relayEnabled: boolean;
  antiPassback: 'disabled' | 'soft' | 'hard';
  isActive: boolean;
  lastHeartbeatAt?: string;
  lastSyncAt?: string;
  firmwareVersion?: string;
  notes?: string;
  registeredAt: string;
}

export interface RegisterDeviceBody {
  name: string;
  branchId: string;
  zone: Zone;
  type: DeviceType;
  protocol: DeviceProtocol;
  ipAddress?: string;
  port?: number;
  serialPort?: string;
  baudRate?: number;
  relayEnabled?: boolean;
  antiPassback?: 'disabled' | 'soft' | 'hard';
  notes?: string;
}

export interface EdgeHeartbeatBody {
  edgeDeviceId: string;
  branchId: string;
  localTime: string;
  syncLag: number;
  pendingEventCount: number;
  uptime: number;
}

export interface EdgeRegisterBody {
  branchId: string;
  name: string;
  secretHash: string;
}

export interface DeviceStatusDTO {
  deviceId: string;
  online: boolean;
  lastHeartbeatAt?: string;
  pendingEvents: number;
  syncLag?: number;
  uptimeSeconds?: number;
}
