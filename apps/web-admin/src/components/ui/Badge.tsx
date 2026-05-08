import React from 'react';

const variants = {
  active:  'bg-emerald-500/10 text-emerald-400 border border-emerald-500/25',
  expired: 'bg-red-500/10 text-red-400 border border-red-500/25',
  frozen:  'bg-cyan-500/10 text-cyan-400 border border-cyan-500/25',
  pending: 'bg-amber-500/10 text-amber-400 border border-amber-500/25',
  blocked: 'bg-red-900/20 text-red-500 border border-red-900/30',
  allow:   'bg-emerald-500/10 text-emerald-400',
  deny:    'bg-red-500/10 text-red-400',
  online:  'bg-emerald-500/10 text-emerald-400 border border-emerald-500/25',
  offline: 'bg-red-500/10 text-red-400 border border-red-500/25',
  owner:      'bg-purple-500/10 text-purple-400 border border-purple-500/25',
  manager:    'bg-purple-500/10 text-purple-400 border border-purple-500/25',
  trainer:    'bg-cyan-500/10 text-cyan-400 border border-cyan-500/25',
  receptionist: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/25',
  cleaner:    'bg-slate-500/10 text-slate-400 border border-slate-500/20',
  security:   'bg-amber-500/10 text-amber-400 border border-amber-500/25',
  default:    'bg-white/5 text-slate-400 border border-white/10',
} as const;

type Variant = keyof typeof variants;

interface BadgeProps {
  variant?: Variant;
  children: React.ReactNode;
  className?: string;
}

export function Badge({ variant = 'default', children, className = '' }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold tracking-wide ${variants[variant]} ${className}`}
    >
      {children}
    </span>
  );
}

export function statusBadge(status: string) {
  const v = status as Variant;
  return <Badge variant={v in variants ? v : 'default'}>{status}</Badge>;
}
