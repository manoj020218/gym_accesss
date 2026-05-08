import axios from 'axios';
import { useAuthStore } from '../store/auth';
import { toast } from '../store/toast';

const BASE_URL = import.meta.env['VITE_API_URL'] ?? 'http://localhost:3000';

export const api = axios.create({
  baseURL: `${BASE_URL}/api/v1`,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
});

// Inject access token
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) config.headers['Authorization'] = `Bearer ${token}`;
  return config;
});

let refreshing: Promise<string> | null = null;

// Auto-refresh on 401
api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config;
    if (err.response?.status === 401 && !original._retry) {
      original._retry = true;
      try {
        if (!refreshing) {
          const refreshToken = useAuthStore.getState().refreshToken;
          refreshing = axios
            .post(`${BASE_URL}/api/v1/auth/refresh`, { refreshToken })
            .then((r) => {
              const newToken: string = r.data.accessToken;
              useAuthStore.getState().setToken(newToken);
              return newToken;
            })
            .finally(() => { refreshing = null; });
        }
        const newToken = await refreshing;
        original.headers['Authorization'] = `Bearer ${newToken}`;
        return api(original);
      } catch {
        useAuthStore.getState().logout();
        window.location.href = '/login';
      }
    }

    const message: string =
      err.response?.data?.message ?? err.response?.data?.error ?? err.message ?? 'Request failed';
    if (err.response?.status !== 401) toast.error(message);
    return Promise.reject(err);
  },
);

export type PaginatedResponse<T> = { data: T[]; total: number; page: number; limit: number };
