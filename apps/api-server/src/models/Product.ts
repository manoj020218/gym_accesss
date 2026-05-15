import { Schema, model, type Document } from 'mongoose';

export interface IProduct extends Document {
  branchId: string;
  name: string;
  category?: string;
  sku?: string;
  price: number;
  gstPercent: number;
  gstIncluded: boolean;
  photos: string[];
  stockQty: number;
  minStockLevel: number;
  isActive: boolean;
  broadcastEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const productSchema = new Schema<IProduct>(
  {
    branchId:      { type: String, required: true, index: true },
    name:          { type: String, required: true },
    category:      { type: String },
    sku:           { type: String, sparse: true },
    price:         { type: Number, required: true },
    gstPercent:    { type: Number, default: 18 },
    gstIncluded:   { type: Boolean, default: false },
    photos:        { type: [String], default: [] },
    stockQty:      { type: Number, default: 0 },
    minStockLevel: { type: Number, default: 5 },
    isActive:         { type: Boolean, default: true },
    broadcastEnabled: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export const Product = model<IProduct>('Product', productSchema);
