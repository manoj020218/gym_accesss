import React from 'react';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
  onClick?: () => void;
}

export function Card({ children, className = '', hover = false, onClick }: CardProps) {
  return (
    <div
      onClick={onClick}
      className={`
        bg-white/[0.04] border border-white/[0.08] rounded-2xl
        ${hover ? 'transition-all duration-200 hover:-translate-y-0.5 hover:border-purple-500/30 hover:shadow-lg hover:shadow-black/40 cursor-pointer' : ''}
        ${className}
      `}
    >
      {children}
    </div>
  );
}

interface KpiCardProps {
  label: string;
  value: React.ReactNode;
  icon: React.ReactNode;
  iconBg?: string;
  trend?: { value: string; up: boolean };
  progress?: number;
}

export function KpiCard({ label, value, icon, iconBg = 'bg-emerald-500/12', trend, progress }: KpiCardProps) {
  return (
    <Card hover className="p-5">
      <div className="flex items-center justify-between mb-3.5">
        <div className="text-[11px] font-semibold tracking-widest text-dimmed uppercase">{label}</div>
        <div className={`w-9 h-9 ${iconBg} rounded-[10px] flex items-center justify-center`}>
          {icon}
        </div>
      </div>
      <div className="text-[28px] font-extrabold tracking-tight leading-none text-slate-100">{value}</div>
      {trend && (
        <div className="mt-2 flex items-center gap-1.5">
          <span className={`text-xs font-semibold ${trend.up ? 'text-emerald-400' : 'text-red-400'}`}>
            {trend.up ? '▲' : '▼'} {trend.value}
          </span>
          <span className="text-xs text-dimmed">vs yesterday</span>
        </div>
      )}
      {progress !== undefined && (
        <div className="mt-3 h-1 bg-white/[0.08] rounded-full overflow-hidden">
          <div className="h-full rounded-full bg-grad-primary" style={{ width: `${progress}%` }} />
        </div>
      )}
    </Card>
  );
}
