import { AccessDecision, SubjectType } from '@edge-gym/shared-types';
import type { AccessRequest, AccessContext, AccessResult } from './types.js';
import { blocklistRule }    from './rules/blocklist.js';
import { membershipRule }   from './rules/membership.js';
import { zoneRule }         from './rules/zone.js';
import { timeWindowRule }   from './rules/time-window.js';
import { antiPassbackRule } from './rules/anti-passback.js';

// Decision order matches README §9 exactly:
// 1. Identity resolution (handled by caller — member/staff lookup)
// 2. Blocklist
// 3. Membership validity
// 4. Branch permission + Zone entitlement  (combined in zoneRule)
// 5. Time window
// 6. Anti-passback
const RULES = [
  blocklistRule,
  membershipRule,
  zoneRule,
  timeWindowRule,
  antiPassbackRule,
] as const;

export function evaluateAccess(
  req: AccessRequest,
  ctx: AccessContext,
): AccessResult {
  // Resolve subject name for logging
  const subjectName =
    req.subjectType === SubjectType.Member
      ? ctx.member?.memberCode
      : ctx.staff?.name;

  for (const rule of RULES) {
    const result = rule(req, ctx);
    if (!result.pass) {
      return {
        decision:    AccessDecision.Deny,
        denyReason:  result.denyReason,
        subjectName,
        triggerRelay: false,
      };
    }
  }

  // All rules passed — update anti-passback state and allow
  const key = `${req.subjectId}:${req.zone}`;
  ctx.lastEntryBySubject.set(key, req.requestTime);

  return {
    decision:     AccessDecision.Allow,
    subjectName,
    triggerRelay: true,
    allowedUntil: req.subjectType === SubjectType.Member
      ? ctx.member ? new Date(ctx.member.activeUntil) : undefined
      : undefined,
  };
}
