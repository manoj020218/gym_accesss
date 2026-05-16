import { NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/auth';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { branchApi } from '../../api/branches';
import { logout } from '../../api/auth';
import { initials, avatarColor } from '../../utils/format';
import AddDeviceWizard from '../../pages/Members/AddDeviceWizard';

const navMain = [
  {
    to: '/dashboard',
    label: 'Dashboard',
    icon: (
      <svg fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16" viewBox="0 0 24 24">
        <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
        <rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>
      </svg>
    ),
  },
  {
    to: '/members',
    label: 'Members',
    icon: (
      <svg fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16" viewBox="0 0 24 24">
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
      </svg>
    ),
  },
  {
    to: '/access',
    label: 'Access Monitor',
    live: true,
    icon: (
      <svg fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16" viewBox="0 0 24 24">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
      </svg>
    ),
  },
  {
    to: '/billing',
    label: 'Fees & Billing',
    icon: (
      <svg fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16" viewBox="0 0 24 24">
        <rect x="1" y="4" width="22" height="16" rx="2"/><path d="M1 10h22"/>
      </svg>
    ),
  },
];

const navOps = [
  {
    to: '/staff',
    label: 'Staff',
    icon: (
      <svg fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16" viewBox="0 0 24 24">
        <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
        <polyline points="16 11 18 13 22 9"/>
      </svg>
    ),
  },
  {
    to: '/products',
    label: 'Products',
    icon: (
      <svg fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16" viewBox="0 0 24 24">
        <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>
        <polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>
      </svg>
    ),
  },
  {
    to: '/reports',
    label: 'Reports',
    icon: (
      <svg fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16" viewBox="0 0 24 24">
        <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/>
        <line x1="6" y1="20" x2="6" y2="14"/>
      </svg>
    ),
  },
];

const navSystem = [
  {
    to: '/machines',
    label: 'Face Machines',
    icon: (
      <svg fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16" viewBox="0 0 24 24">
        <rect x="2" y="3" width="20" height="14" rx="2"/><circle cx="12" cy="10" r="3"/>
        <path d="M8 10a4 4 0 008 0"/><path d="M5 21h14"/>
      </svg>
    ),
  },
  {
    to: '/settings',
    label: 'Settings',
    icon: (
      <svg fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
      </svg>
    ),
  },
  {
    to: '/diagnostics',
    label: 'Diagnostics',
    icon: (
      <svg fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16" viewBox="0 0 24 24">
        <path d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18"/>
      </svg>
    ),
  },
];

function NavItem({ to, label, icon, live }: { to: string; label: string; icon: React.ReactNode; live?: boolean }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex items-center gap-2.5 px-3.5 py-2.5 rounded-[10px] mx-2.5 mb-0.5 text-[13px] font-medium border transition-all duration-150 ${
          isActive
            ? 'bg-purple-500/15 text-purple-300 border-purple-500/20'
            : 'text-slate-500 border-transparent hover:bg-white/[0.05] hover:text-slate-300'
        }`
      }
    >
      {icon}
      {label}
      {live && (
        <span className="ml-auto w-[7px] h-[7px] rounded-full bg-emerald-500 blink flex-shrink-0" />
      )}
    </NavLink>
  );
}

import React, { useState } from 'react';
import { accessApi } from '../../api/access';

export function Sidebar() {
  const { user, selectedBranchId, setSelectedBranch } = useAuthStore();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showMachineWizard, setShowMachineWizard] = useState(false);

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn:  () => branchApi.list(),
    enabled:  !!user,
  });

  const { data: branchDevices = [] } = useQuery({
    queryKey: ['access-devices', selectedBranchId],
    queryFn:  () => accessApi.devices(selectedBranchId ?? undefined),
    enabled:  !!selectedBranchId,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const selectedBranch = branches.find((b) => b._id === selectedBranchId) ?? branches[0];

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const name = user ? `${user.displayName}` : '';
  const roleLabel =
    user?.role === 'owner' ? 'Owner · All Branches' : `${user?.role ?? ''} · ${selectedBranch?.name ?? ''}`;

  return (
    <aside
      className="fixed left-0 top-0 h-screen z-[100] flex flex-col"
      style={{ width: 228, background: 'rgba(6,6,14,0.96)', borderRight: '1px solid rgba(255,255,255,0.06)' }}
    >
      {/* Logo + branch selector */}
      <div className="px-4 pt-5 pb-3.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="flex items-center gap-2.5 mb-3.5">
          <div
            className="w-[34px] h-[34px] grad-bg rounded-[10px] flex items-center justify-center text-lg flex-shrink-0"
            style={{ boxShadow: '0 0 16px rgba(124,58,237,0.4)' }}
          >
            ⚡
          </div>
          <div>
            <div className="text-[15px] font-extrabold tracking-tight grad-text">EDGE GYM</div>
            <div className="text-[10px] text-dimmed font-semibold">CONTROL PANEL</div>
          </div>
        </div>

        {/* Branch selector */}
        <div>
          <div className="text-[10px] font-semibold tracking-widest text-dimmed mb-1.5">BRANCH</div>
          <div className="bg-white/[0.05] border border-white/[0.08] rounded-[9px] p-2 overflow-hidden">
            <select
              value={selectedBranchId ?? ''}
              onChange={(e) => setSelectedBranch(e.target.value)}
              className="w-full bg-transparent text-xs font-semibold text-slate-200 outline-none cursor-pointer"
              style={{ background: 'transparent' }}
            >
              {user?.role === 'owner' && (
                <option value="" style={{ background: '#0C0C1A' }}>All Branches</option>
              )}
              {branches.map((b) => (
                <option key={b._id} value={b._id} style={{ background: '#0C0C1A' }}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Machines section */}
        {selectedBranchId && (
          <div className="mt-2.5">
            {branchDevices.length > 0 ? (
              <div className="rounded-[9px] border border-white/[0.07] overflow-hidden">
                <div className="px-2.5 pt-1.5 pb-1">
                  <p className="text-[9px] font-bold tracking-widest text-dimmed uppercase">Machines</p>
                </div>
                {branchDevices.map(d => (
                  <NavLink
                    key={d._id}
                    to="/machines"
                    className="flex items-center gap-2 px-2.5 py-1.5 border-t border-white/[0.05] hover:bg-white/[0.04] transition-colors"
                  >
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${d.isOnline ? 'bg-emerald-400 blink' : 'bg-slate-600'}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-semibold text-slate-300 truncate">{d.name}</p>
                      <p className="text-[10px] text-dimmed">{d.isOnline ? 'Live' : 'Offline'}</p>
                    </div>
                  </NavLink>
                ))}
                <button
                  onClick={() => setShowMachineWizard(true)}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 border-t border-white/[0.05] text-[10px] font-semibold text-purple-400 hover:bg-purple-500/10 transition-all"
                >
                  <svg fill="none" stroke="currentColor" strokeWidth="2.5" width="10" height="10" viewBox="0 0 24 24">
                    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                  </svg>
                  Add Machine
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowMachineWizard(true)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-[9px] border border-dashed border-purple-500/30 text-[11px] font-semibold text-purple-400 hover:border-purple-500/60 hover:bg-purple-500/10 transition-all"
              >
                <svg fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13" viewBox="0 0 24 24">
                  <rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/>
                  <line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>
                </svg>
                Machine Installation
              </button>
            )}
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2.5">
        <p className="text-[11px] font-semibold tracking-widest text-dimmed px-[18px] pt-2 pb-1">MAIN</p>
        {navMain.map((item) => (
          <NavItem key={item.to} {...item} />
        ))}
        <p className="text-[11px] font-semibold tracking-widest text-dimmed px-[18px] pt-3.5 pb-1">OPERATIONS</p>
        {navOps.map((item) => (
          <NavItem key={item.to} {...item} />
        ))}
        <p className="text-[11px] font-semibold tracking-widest text-dimmed px-[18px] pt-3.5 pb-1">SYSTEM</p>
        {navSystem.map((item) => (
          <NavItem key={item.to} {...item} />
        ))}
      </nav>

      {/* User profile */}
      <div className="p-3.5" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2.5 p-2.5 bg-white/[0.04] rounded-xl hover:bg-white/[0.07] transition-all text-left"
        >
          <div
            className={`w-[34px] h-[34px] rounded-[9px] flex items-center justify-center text-xs font-bold text-white flex-shrink-0 bg-gradient-to-br ${avatarColor(name)}`}
          >
            {initials(name)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold text-slate-200 truncate">{name}</div>
            <div className="text-[11px] text-dimmed truncate">{roleLabel}</div>
          </div>
          <svg width="14" height="14" fill="none" stroke="#475569" strokeWidth="1.5" viewBox="0 0 24 24">
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
        </button>
      </div>
      {showMachineWizard && selectedBranchId && (
        <AddDeviceWizard
          open={showMachineWizard}
          branchId={selectedBranchId}
          onClose={() => setShowMachineWizard(false)}
          onDeviceOnline={() => {
            void qc.invalidateQueries({ queryKey: ['access-devices'] });
            setShowMachineWizard(false);
          }}
        />
      )}
    </aside>
  );
}
