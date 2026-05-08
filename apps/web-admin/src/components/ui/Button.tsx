import React from 'react';
import { Spinner } from './Spinner';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: React.ReactNode;
}

const base = 'inline-flex items-center justify-center gap-2 font-semibold rounded-[10px] transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed';

const variants = {
  primary: 'bg-grad-primary text-white hover:opacity-90 hover:-translate-y-px shadow-lg hover:shadow-purple-500/30',
  outline: 'bg-transparent border border-white/12 text-slate-400 hover:border-purple-500/40 hover:text-purple-400',
  ghost:   'bg-transparent border-0 text-slate-500 hover:bg-white/5 hover:text-slate-300',
  danger:  'bg-red-500/10 border border-red-500/25 text-red-400 hover:bg-red-500/20',
};

const sizes = {
  sm: 'text-xs px-3 py-1.5',
  md: 'text-sm px-4 py-2.5',
  lg: 'text-sm px-5 py-3',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  children,
  disabled,
  className = '',
  ...rest
}: ButtonProps) {
  return (
    <button
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Spinner size={14} /> : icon}
      {children}
    </button>
  );
}
