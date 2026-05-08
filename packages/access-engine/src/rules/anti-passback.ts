import { DenyReason } from '@edge-gym/shared-types';
import type { Rule } from '../types.js';

const PASSBACK_WINDOW_MS = 60_000; // 60 seconds

export const antiPassbackRule: Rule = (req, ctx) => {
  const policy = ctx.policies.find(p => p.zone === req.zone);
  if (!policy?.antiPassbackEnabled) return { pass: true };

  const key = `${req.subjectId}:${req.zone}`;
  const lastEntry = ctx.lastEntryBySubject.get(key);

  if (lastEntry && req.requestTime.getTime() - lastEntry.getTime() < PASSBACK_WINDOW_MS) {
    return { pass: false, denyReason: DenyReason.AntiPassback };
  }

  ctx.lastEntryBySubject.set(key, req.requestTime);
  return { pass: true };
};
