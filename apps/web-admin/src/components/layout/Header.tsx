import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';

interface HeaderProps {
  title: string;
  actions?: React.ReactNode;
}

export function Header({ title, actions }: HeaderProps) {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (search.trim()) {
      navigate(`/members?search=${encodeURIComponent(search.trim())}`);
      setSearch('');
    }
  };

  return (
    <div
      className="flex items-center gap-3.5 px-6 py-3 sticky top-0 z-50 flex-shrink-0"
      style={{
        background: 'rgba(5,5,10,0.9)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        backdropFilter: 'blur(12px)',
      }}
    >
      {/* Page title */}
      <div className="flex-1">
        <div className="text-[18px] font-extrabold tracking-tight text-slate-100">{title}</div>
        <div className="text-xs text-dimmed">{format(new Date(), 'EEEE, d MMMM yyyy')}</div>
      </div>

      {/* Global search */}
      <form onSubmit={handleSearch} className="relative">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 text-dimmed"
          width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
        >
          <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
        </svg>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-white/[0.06] border border-white/10 rounded-[10px] pl-9 pr-4 py-2 text-sm text-slate-100 placeholder:text-slate-600 outline-none focus:border-purple-500/50 transition-all w-[200px] focus:w-[260px]"
          placeholder="Search members…"
        />
      </form>

      {/* Notification bell */}
      <button className="relative w-9 h-9 flex items-center justify-center rounded-[10px] text-slate-500 hover:text-slate-300 hover:bg-white/[0.05] transition-all">
        <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
          <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/>
        </svg>
        <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-400 rounded-full border-2 border-[#05050A]" />
      </button>

      {/* Page-level actions */}
      {actions}
    </div>
  );
}
