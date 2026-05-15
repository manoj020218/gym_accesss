import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface AuthUser {
  _id: string;
  displayName: string;
  email: string;
  photoURL?: string;
  role: 'owner' | 'manager' | 'trainer' | 'receptionist';
  branchIds: string[];
  permissions?: string[];
}

export function hasPerm(user: AuthUser | null, perm: string): boolean {
  return user?.role === 'owner' || (user?.permissions ?? []).includes(perm);
}

interface AuthState {
  token: string | null;
  refreshToken: string | null;
  user: AuthUser | null;
  selectedBranchId: string | null;
  _hydrated: boolean;

  setAuth: (token: string, refreshToken: string, user: AuthUser) => void;
  setToken: (token: string) => void;
  setSelectedBranch: (branchId: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      refreshToken: null,
      user: null,
      selectedBranchId: null,
      _hydrated: false,

      setAuth: (token, refreshToken, user) =>
        set({ token, refreshToken, user, selectedBranchId: user.branchIds[0] ?? null }),

      setToken: (token) => set({ token }),

      setSelectedBranch: (branchId) => set({ selectedBranchId: branchId }),

      logout: () => set({ token: null, refreshToken: null, user: null, selectedBranchId: null }),
    }),
    {
      name: 'edge-gym-auth',
      partialize: (s) => ({
        token: s.token,
        refreshToken: s.refreshToken,
        user: s.user,
        selectedBranchId: s.selectedBranchId,
      }),
    },
  ),
);

// Mark hydrated after persist finishes loading from localStorage
useAuthStore.persist.onFinishHydration(() => {
  useAuthStore.setState({ _hydrated: true });
});
// In case it already finished before any subscriber attached (synchronous storage)
if (useAuthStore.persist.hasHydrated()) {
  useAuthStore.setState({ _hydrated: true });
}
