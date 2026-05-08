import { DenyReason, MemberStatus, SubjectType } from '@edge-gym/shared-types';
import type { Rule } from '../types.js';

export const membershipRule: Rule = (req, ctx) => {
  if (req.subjectType === SubjectType.Staff) return { pass: true };

  const member = ctx.member;
  if (!member) {
    return { pass: false, denyReason: DenyReason.UnknownIdentity };
  }

  switch (member.status) {
    case MemberStatus.Blocked:
      return { pass: false, denyReason: DenyReason.MemberBlocked };
    case MemberStatus.Frozen:
      return { pass: false, denyReason: DenyReason.MemberFrozen };
    case MemberStatus.Expired:
      return { pass: false, denyReason: DenyReason.MemberExpired };
    case MemberStatus.Pending:
      return { pass: false, denyReason: DenyReason.MemberExpired };
  }

  const activeUntil = new Date(member.activeUntil);
  if (req.requestTime > activeUntil) {
    return { pass: false, denyReason: DenyReason.MemberExpired };
  }

  if (member.hasDues) {
    return { pass: false, denyReason: DenyReason.PaymentDue };
  }

  return { pass: true };
};
