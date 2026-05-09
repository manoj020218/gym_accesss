import { Schema, model, type Document } from 'mongoose';

export interface IDeviceSetupLog extends Document {
  sessionId:      string;
  branchId:       string;
  deviceCode:     string;
  step:           string;
  confirmedValue?: string;
  metadata:       Record<string, unknown>;
  adminIp?:       string;
  createdAt:      Date;
  updatedAt:      Date;
}

const schema = new Schema<IDeviceSetupLog>(
  {
    sessionId:      { type: String, required: true, index: true },
    branchId:       { type: String, required: true, index: true },
    deviceCode:     { type: String, required: true, index: true },
    step:           { type: String, required: true },
    confirmedValue: String,
    metadata:       { type: Schema.Types.Mixed, default: {} },
    adminIp:        String,
  },
  { timestamps: true },
);

export const DeviceSetupLog = model<IDeviceSetupLog>('DeviceSetupLog', schema);
