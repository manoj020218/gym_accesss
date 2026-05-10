import { Schema, model } from 'mongoose';

const counterSchema = new Schema({ _id: String, seq: { type: Number, default: 0 } });
const Counter = model('Counter', counterSchema);

/** Atomic auto-increment per key. Use key like `"member_branchId"` */
export async function nextSeq(key: string): Promise<number> {
  const doc = await Counter.findByIdAndUpdate(
    key,
    { $inc: { seq: 1 } },
    { upsert: true, new: true },
  );
  return doc!.seq;
}
