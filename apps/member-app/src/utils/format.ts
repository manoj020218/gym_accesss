import { format, formatDistanceToNow, parseISO, differenceInDays } from 'date-fns';

export const fmtDate = (iso: string | Date) =>
  format(typeof iso === 'string' ? parseISO(iso) : iso, 'dd MMM yyyy');

export const fmtDatetime = (iso: string | Date) =>
  format(typeof iso === 'string' ? parseISO(iso) : iso, 'dd MMM, h:mm a');

export const fmtRelative = (iso: string | Date) =>
  formatDistanceToNow(typeof iso === 'string' ? parseISO(iso) : iso, { addSuffix: true });

export const fmtCurrency = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);

export const daysLeft = (endDate: string) =>
  Math.max(0, differenceInDays(parseISO(endDate), new Date()));

export const membershipPercent = (startDate: string, endDate: string) => {
  const total = differenceInDays(parseISO(endDate), parseISO(startDate));
  const used  = differenceInDays(new Date(), parseISO(startDate));
  return total <= 0 ? 0 : Math.min(100, Math.max(0, Math.round((used / total) * 100)));
};

export const initials = (name: string) =>
  name.split(' ').slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('');
