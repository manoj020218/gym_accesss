import type { PaymentMode } from './enums.js';

export interface PaymentDTO {
  id: string;
  memberId: string;
  branchId: string;
  membershipId?: string;
  amount: number;
  discount: number;
  gstAmount: number;
  totalAmount: number;
  mode: PaymentMode;
  referenceNo?: string;
  notes?: string;
  paidAt: string;
  receiptNo: string;
  collectedBy: string;
}

export interface CreatePaymentBody {
  memberId: string;
  branchId: string;
  membershipId?: string;
  amount: number;
  discount?: number;
  mode: PaymentMode;
  referenceNo?: string;
  notes?: string;
}

export interface DueReportRow {
  memberId: string;
  memberName: string;
  phone: string;
  planType: string;
  dueAmount: number;
  dueSince: string;
  daysPending: number;
}

export interface DailyCollectionReport {
  date: string;
  branchId: string;
  branchName: string;
  totalAmount: number;
  byMode: Record<PaymentMode, number>;
  transactionCount: number;
}

export interface ProductSaleDTO {
  id: string;
  branchId: string;
  productId: string;
  productName: string;
  memberId?: string;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  soldBy: string;
  soldAt: string;
}

export interface CreateProductSaleBody {
  branchId: string;
  productId: string;
  memberId?: string;
  quantity: number;
  mode: PaymentMode;
  referenceNo?: string;
}
