import { DenyReason, SubjectType } from '@edge-gym/shared-types';
import type { Rule } from '../types.js';

export const zoneRule: Rule = (req, ctx) => {
  if (req.subjectType === SubjectType.Member) {
    const member = ctx.member;
    if (!member) return { pass: false, denyReason: DenyReason.UnknownIdentity };

    if (!member.allowedZones.includes(req.zone)) {
      return { pass: false, denyReason: DenyReason.NotInAllowedZone };
    }

    if (!member.allowedBranchIds.includes(req.branchId)) {
      return { pass: false, denyReason: DenyReason.BranchNotPermitted };
    }
  }

  if (req.subjectType === SubjectType.Staff) {
    const staff = ctx.staff;
    if (!staff) return { pass: false, denyReason: DenyReason.UnknownIdentity };

    if (!staff.allowedZones.includes(req.zone)) {
      return { pass: false, denyReason: DenyReason.NotInAllowedZone };
    }
  }

  return { pass: true };
};
