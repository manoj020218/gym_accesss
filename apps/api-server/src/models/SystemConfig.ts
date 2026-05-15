import { Schema, model, type Document } from 'mongoose';

export interface ISystemConfig extends Document {
  key:       string;
  value:     unknown;
  updatedAt: Date;
}

const systemConfigSchema = new Schema<ISystemConfig>(
  { key: { type: String, required: true, unique: true }, value: { type: Schema.Types.Mixed } },
  { timestamps: true },
);

export const SystemConfig = model<ISystemConfig>('SystemConfig', systemConfigSchema);
