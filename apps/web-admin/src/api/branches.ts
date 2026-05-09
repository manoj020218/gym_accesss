import { api } from './client';

export interface Branch {
  _id: string;
  name: string;
  address?: string;
  phone?: string;
  isActive: boolean;
  createdAt: string;
}

export const branchApi = {
  list: () => api.get<{ data: Branch[]; total: number }>('/branches').then((r) => r.data.data),
  get:  (id: string) => api.get<Branch>(`/branches/${id}`).then((r) => r.data),
  create: (body: Partial<Branch>) => api.post<Branch>('/branches', body).then((r) => r.data),
  update: (id: string, body: Partial<Branch>) =>
    api.put<Branch>(`/branches/${id}`, body).then((r) => r.data),
  remove: (id: string) => api.delete(`/branches/${id}`),
};
