import { sign } from 'jsonwebtoken';
import { StaffRole } from '@edge-gym/shared-types';

export const TEST_JWT_SECRET  = 'test-jwt-secret-minimum-32-characters!ok';
export const TEST_BRANCH_ID   = 'branch-test-001';
export const TEST_BRANCH_ID_2 = 'branch-test-002';

interface TokenOverrides {
  sub?:       string;
  email?:     string;
  role?:      string;
  branchIds?: string[];
}

export function makeToken(overrides: TokenOverrides = {}): string {
  return sign(
    {
      sub:       overrides.sub       ?? 'user-owner-001',
      email:     overrides.email     ?? 'owner@test.com',
      role:      overrides.role      ?? StaffRole.Owner,
      branchIds: overrides.branchIds ?? [TEST_BRANCH_ID],
    },
    TEST_JWT_SECRET,
    { expiresIn: '1h' },
  );
}

export const ownerToken        = makeToken();
export const managerToken      = makeToken({ sub: 'mgr-001',  email: 'mgr@test.com',  role: StaffRole.Manager });
export const trainerToken      = makeToken({ sub: 'trn-001',  email: 'trn@test.com',  role: StaffRole.Trainer });
export const receptionistToken = makeToken({ sub: 'rcpt-001', email: 'rcpt@test.com', role: StaffRole.Receptionist });
// Manager for a completely different branch
export const otherBranchManagerToken = makeToken({
  sub:       'mgr-002',
  email:     'mgr2@test.com',
  role:      StaffRole.Manager,
  branchIds: [TEST_BRANCH_ID_2],
});
