import { format, formatDistanceToNow, parseISO } from 'date-fns';

export function fmtDate(iso: string | Date) {
  const d = typeof iso === 'string' ? parseISO(iso) : iso;
  return format(d, 'dd MMM yyyy');
}

export function fmtDatetime(iso: string | Date) {
  const d = typeof iso === 'string' ? parseISO(iso) : iso;
  return format(d, 'dd MMM yyyy, h:mm a');
}

export function fmtRelative(iso: string | Date) {
  const d = typeof iso === 'string' ? parseISO(iso) : iso;
  return formatDistanceToNow(d, { addSuffix: true });
}

export function fmtCurrency(amount: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

export function initials(name: string) {
  return name
    .split(' ')
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('');
}

export function avatarColor(str: string): string {
  const colors = [
    'from-purple-600 to-purple-800',
    'from-cyan-600 to-cyan-800',
    'from-emerald-600 to-emerald-800',
    'from-amber-600 to-amber-800',
    'from-red-600 to-red-800',
    'from-indigo-600 to-indigo-800',
    'from-pink-600 to-pink-800',
  ];
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length]!;
}
