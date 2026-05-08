import { DenyReason } from '@edge-gym/shared-types';
import type { Rule } from '../types.js';

export const blocklistRule: Rule = (req, ctx) => {
  if (ctx.blocklist.has(req.subjectId)) {
    return { pass: false, denyReason: DenyReason.Blacklisted };
  }
  return { pass: true };
};
