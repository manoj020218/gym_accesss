import { Schema, model, type Document } from 'mongoose';

export const DEFAULT_PASS_DATE = '2000/01/01 - 2099/12/31';
export const DEFAULT_PASS_TIME = JSON.stringify([
  { id: 1, name: 'All Day', timeRanges: [{ weekday: '1,2,3,4,5,6,7', time: '00:00-24:00' }] },
]);

export interface IZkbioEmployee extends Document {
  deviceSn:      string;
  machineUserId: string;
  name:          string;
  picLarge?:     string;  // base64 face photo — sent to machine via selectPassInfo so it can create template
  passDate:      string;  // "YYYY/MM/DD - YYYY/MM/DD"
  passTime:      string;  // JSON string of time-range schedule
  memberId?:     string;  // link to Member._id
  importedAt:    Date;
  deletedAt?:    Date;    // set when member is blocked/removed; machine picks up via selectDeleteInfo
  createdAt:     Date;
  updatedAt:     Date;
}

const zkbioEmployeeSchema = new Schema<IZkbioEmployee>(
  {
    deviceSn:      { type: String, required: true, index: true },
    machineUserId: { type: String, required: true },
    name:          { type: String, required: true },
    picLarge:      String,
    passDate:      { type: String, default: DEFAULT_PASS_DATE },
    passTime:      { type: String, default: DEFAULT_PASS_TIME },
    memberId:      String,
    importedAt:    { type: Date, default: Date.now },
  },
  { timestamps: true },
);

zkbioEmployeeSchema.index({ deviceSn: 1, machineUserId: 1 }, { unique: true });

export const ZkbioEmployee = model<IZkbioEmployee>('ZkbioEmployee', zkbioEmployeeSchema);
