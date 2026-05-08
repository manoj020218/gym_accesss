import { DenyReason } from '@edge-gym/shared-types';
import type { Rule } from '../types.js';

export const timeWindowRule: Rule = (req, ctx) => {
  const policy = ctx.policies.find(p => p.zone === req.zone);
  if (!policy || policy.timeWindows.length === 0) return { pass: true };

  const now = req.requestTime;
  const dow = now.getDay();
  const hhmm = now.getHours() * 60 + now.getMinutes();

  const inWindow = policy.timeWindows.some(w => {
    if (!w.dayOfWeek.includes(dow)) return false;
    const [startH, startM] = w.startTime.split(':').map(Number);
    const [endH, endM]     = w.endTime.split(':').map(Number);
    const start = (startH ?? 0) * 60 + (startM ?? 0);
    const end   = (endH ?? 23) * 60 + (endM ?? 59);
    return hhmm >= start && hhmm <= end;
  });

  if (!inWindow) {
    return { pass: false, denyReason: DenyReason.OutsideTimeWindow };
  }
  return { pass: true };
};
