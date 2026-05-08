import { Schema, model, type Document } from 'mongoose';

export type TxType = 'purchase' | 'sale' | 'adjustment' | 'damage';

export interface IInventoryTransaction extends Document {
  branchId:    string;
  productId:   string;
  type:        TxType;
  qty:         number;
  unitPrice:   number;
  totalAmount: number;
  memberId?:   string;
  doneBy:      string;
  notes?:      string;
  createdAt:   Date;
}

const inventoryTxSchema = new Schema<IInventoryTransaction>(
  {
    branchId:    { type: String, required: true, index: true },
    productId:   { type: String, required: true, index: true },
    type:        { type: String, required: true },
    qty:         { type: Number, required: true },
    unitPrice:   { type: Number, required: true },
    totalAmount: { type: Number, required: true },
    memberId:    { type: String, index: true },
    doneBy:      { type: String, required: true },
    notes:       String,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

inventoryTxSchema.index({ branchId: 1, createdAt: -1 });
inventoryTxSchema.index({ productId: 1, createdAt: -1 });

export const InventoryTransaction = model<IInventoryTransaction>('InventoryTransaction', inventoryTxSchema);
