import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export function Input({ label, error, hint, className = '', id, ...rest }: InputProps) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={inputId} className="text-xs font-semibold text-slate-400 tracking-wide">
          {label}
        </label>
      )}
      <input
        id={inputId}
        className={`
          bg-white/[0.06] border rounded-[10px] px-3.5 py-2.5 text-sm text-slate-100
          placeholder:text-slate-600 transition-all duration-200 outline-none
          ${error
            ? 'border-red-500/50 focus:border-red-500 focus:shadow-[0_0_0_3px_rgba(239,68,68,0.08)]'
            : 'border-white/10 focus:border-purple-500/50 focus:shadow-[0_0_0_3px_rgba(124,58,237,0.08)]'}
          ${className}
        `}
        {...rest}
      />
      {error && <p className="text-xs text-red-400">{error}</p>}
      {hint && !error && <p className="text-xs text-slate-600">{hint}</p>}
    </div>
  );
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: { value: string; label: string }[];
}

export function Select({ label, error, options, className = '', id, ...rest }: SelectProps) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={inputId} className="text-xs font-semibold text-slate-400 tracking-wide">
          {label}
        </label>
      )}
      <select
        id={inputId}
        className={`
          bg-white/[0.06] border border-white/10 rounded-[10px] px-3.5 py-2.5 text-sm text-slate-100
          outline-none focus:border-purple-500/50 focus:shadow-[0_0_0_3px_rgba(124,58,237,0.08)]
          transition-all duration-200 cursor-pointer
          ${error ? 'border-red-500/50' : ''}
          ${className}
        `}
        style={{ background: 'rgba(255,255,255,0.06)' }}
        {...rest}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} style={{ background: '#0C0C1A', color: '#F1F5F9' }}>
            {o.label}
          </option>
        ))}
      </select>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
