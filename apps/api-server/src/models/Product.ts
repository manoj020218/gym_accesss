import { Schema, model, type Document } from 'mongoose';

export interface IProduct extends Document {
  branchId: string;
  name: string;
  category: string;
  sku?: string;
  unitPrice: number;
  costPrice?: number;
  gstPercent: number;
  currentStock: number;
  minStockLevel: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const productSchema = new Schema<IProduct>(
  {
    branchId:      { type: String, required: true, index: true },
    name:          { type: String, required: true },
    category:      { type: String, required: true },
    sku:           { type: String, sparse: true },
    unitPrice:     { type: Number, required: true },
    costPrice:     Number,
    gstPercent:    { type: Number, default: 18 },
    currentStock:  { type: Number, default: 0 },
    minStockLevel: { type: Number, default: 5 },
    isActive:      { type: Boolean, default: true },
  },
  { timestamps: true },
);

export const Product = model<IProduct>('Product', productSchema);
