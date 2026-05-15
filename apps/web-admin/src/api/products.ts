import { api, type PaginatedResponse } from './client';

export interface Product {
  _id: string;
  name: string;
  sku?: string;
  branchId: string;
  category?: string;
  price: number;
  gstPercent: number;
  gstIncluded: boolean;
  photos: string[];
  stockQty: number;
  minStockLevel: number;
  isActive: boolean;
  broadcastEnabled: boolean;
  createdAt: string;
}

export const productApi = {
  list: (params: { branchId?: string; lowStock?: boolean; broadcast?: boolean; page?: number; limit?: number }) =>
    api.get<PaginatedResponse<Product>>('/products', { params }).then((r) => r.data),

  get: (id: string) => api.get<Product>(`/products/${id}`).then((r) => r.data),

  create: (body: Partial<Product>) => api.post<Product>('/products', body).then((r) => r.data),

  update: (id: string, body: Partial<Product>) =>
    api.put<Product>(`/products/${id}`, body).then((r) => r.data),

  toggleBroadcast: (id: string, enabled: boolean) =>
    api.patch<Product>(`/products/${id}/broadcast`, { enabled }).then((r) => r.data),

  remove: (id: string) => api.delete(`/products/${id}`),

  stockIn: (id: string, qty: number, note?: string) =>
    api.post(`/products/${id}/stock-in`, { qty, note }).then((r) => r.data),

  sell: (id: string, qty: number, memberId?: string) =>
    api.post(`/products/${id}/sell`, { qty, memberId }).then((r) => r.data),
};
