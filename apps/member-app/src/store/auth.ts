import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface AuthUser {
  _id: string;
  displayName: string;
  email: string;
  photoURL?: string;
  role: string;
  branchIds: string[];
}

interface AuthState {
  token: string | null;
  refreshToken: string | null;
  user: AuthUser | null;
  memberId: string | null;

  setAuth: (token: string, refreshToken: string, user: AuthUser, memberId?: string) => void;
  setToken: (token: string) => void;
  setMemberId: (id: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      refreshToken: null,
      user: null,
      memberId: null,

      setAuth: (token, refreshToken, user, memberId) =>
        set({ token, refreshToken, user, memberId: memberId ?? null }),

      setToken: (token) => set({ token }),

      setMemberId: (id) => set({ memberId: id }),

      logout: () => set({ token: null, refreshToken: null, user: null, memberId: null }),
    }),
    {
      name: 'edge-gym-member-auth',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
