import axios from 'axios';
import { useAuthStore } from '../store/auth';

const BASE_URL = process.env['EXPO_PUBLIC_API_URL'] ?? 'http://localhost:3000';

export const api = axios.create({
  baseURL: `${BASE_URL}/api/v1`,
  headers: { 'Content-Type': 'application/json' },
  timeout: 15_000,
});

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) config.headers['Authorization'] = `Bearer ${token}`;
  return config;
});

let refreshing: Promise<string> | null = null;

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config;
    if (err.response?.status === 401 && !original._retry) {
      original._retry = true;
      try {
        const { refreshToken } = useAuthStore.getState();
        if (!refreshToken) throw new Error('No refresh token');

        if (!refreshing) {
          refreshing = axios
            .post(`${BASE_URL}/api/v1/auth/refresh`, { refreshToken })
            .then((r) => {
              const t: string = r.data.accessToken;
              useAuthStore.getState().setToken(t);
              return t;
            })
            .finally(() => { refreshing = null; });
        }

        const newToken = await refreshing;
        original.headers['Authorization'] = `Bearer ${newToken}`;
        return api(original);
      } catch {
        useAuthStore.getState().logout();
      }
    }
    return Promise.reject(err);
  },
);
