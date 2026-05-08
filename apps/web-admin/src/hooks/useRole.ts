import { useAuthStore } from '../store/auth';

type Role = 'owner' | 'manager' | 'trainer' | 'receptionist';

export function useRole() {
  const user = useAuthStore((s) => s.user);
  const role = user?.role ?? 'receptionist';

  return {
    role,
    isOwner:       role === 'owner',
    isManager:     role === 'manager' || role === 'owner',
    isTrainer:     role === 'trainer',
    isReceptionist: role === 'receptionist',
    can: (allowed: Role[]) => allowed.includes(role as Role),
  };
}
