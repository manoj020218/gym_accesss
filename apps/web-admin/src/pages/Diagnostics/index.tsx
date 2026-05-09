import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Layout } from '../../components/layout/Layout';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { api } from '../../api/client';
import { fmtDatetime } from '../../utils/format';

interface SetupLog {
  _id: string;
  sessionId: string;
  branchId: string;
  deviceCode: string;
  step: string;
  confirmedValue?: string;
  metadata?: Record<string, unknown>;
  adminIp?: string;
  createdAt: string;
}

const STEP_META: Record<string, { label: string; color: string }> = {
  REGISTERED:             { label: 'Device Registered',      color: 'text-purple-300  bg-purple-900/30  border-purple-500/20' },
  CONFIRM_DEVICE_ID:      { label: 'Device ID Confirmed',    color: 'text-cyan-300    bg-cyan-900/30    border-cyan-500/20'   },
  CONFIRM_BRANCH_ID:      { label: 'Branch Code Confirmed',  color: 'text-cyan-300    bg-cyan-900/30    border-cyan-500/20'   },
  CONFIRM_SERVER_IP:      { label: 'Server IP Confirmed',    color: 'text-cyan-300    bg-cyan-900/30    border-cyan-500/20'   },
  SETUP_COMPLETE:         { label: 'Setup Complete',         color: 'text-blue-300    bg-blue-900/30    border-blue-500/20'   },
  DEVICE_ONLINE:          { label: 'Device Online',          color: 'text-emerald-300 bg-emerald-900/30 border-emerald-500/20'},
  FAST_CONNECT_SUCCESS:   { label: 'Fast Connect ✓',         color: 'text-emerald-300 bg-emerald-900/30 border-emerald-500/20'},
  FAST_CONNECT_FAILED:    { label: 'Fast Connect Failed',    color: 'text-red-300     bg-red-900/30     border-red-500/20'   },
  FAST_CONNECT_SN_MISMATCH:{ label: 'SN Mismatch',          color: 'text-amber-300   bg-amber-900/30   border-amber-500/20' },
  FAST_CONNECT_UI_SUCCESS:{ label: 'Fast Connect Confirmed', color: 'text-emerald-300 bg-emerald-900/30 border-emerald-500/20'},
};

function StepBadge({ step }: { step: string }) {
  const meta = STEP_META[step] ?? { label: step, color: 'text-slate-300 bg-white/5 border-white/10' };
  return (
    <span className={`inline-flex text-[10px] font-semibold px-2 py-0.5 rounded-full border ${meta.color}`}>
      {meta.label}
    </span>
  );
}

function MetaView({ data }: { data?: Record<string, unknown> }) {
  if (!data || Object.keys(data).length === 0) return null;
  return (
    <div className="mt-1.5 space-y-0.5">
      {Object.entries(data).map(([k, v]) => (
        <p key={k} className="text-[10px] font-mono text-slate-500">
          <span className="text-slate-600">{k}: </span>
          <span className="text-slate-400">{String(v)}</span>
        </p>
      ))}
    </div>
  );
}

export default function DiagnosticsPage() {
  const [filterDevice, setFilterDevice] = useState('');
  const [filterSession, setFilterSession] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data: logs = [], isLoading, refetch } = useQuery<SetupLog[]>({
    queryKey: ['device-setup-logs', filterDevice, filterSession],
    queryFn: () => {
      const params = new URLSearchParams();
      if (filterDevice.trim())  params.set('deviceCode', filterDevice.trim());
      if (filterSession.trim()) params.set('sessionId',  filterSession.trim());
      return api.get<SetupLog[]>(`/device-setup-log?${params}`).then((r) => r.data);
    },
    refetchInterval: 30_000,
  });

  // Group logs by sessionId for timeline view
  const sessions = logs.reduce<Record<string, SetupLog[]>>((acc, log) => {
    if (!acc[log.sessionId]) acc[log.sessionId] = [];
    acc[log.sessionId].push(log);
    return acc;
  }, {});

  return (
    <Layout
      title="Device Setup Diagnostics"
      actions={
        <button
          onClick={() => void refetch()}
          className="text-xs text-muted hover:text-slate-300 flex items-center gap-1.5 transition-colors"
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-3.5 h-3.5">
            <path d="M13.5 2.5A6.5 6.5 0 1 1 2 8.5"/>
            <polyline points="2 2.5 2 8.5 8 8.5"/>
          </svg>
          Refresh
        </button>
      }
    >
      {/* Filters */}
      <Card className="p-4 mb-4">
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Filter by Device Code"
            value={filterDevice}
            onChange={(e) => setFilterDevice(e.target.value)}
            placeholder="DEV-43E2-…"
          />
          <Input
            label="Filter by Session ID"
            value={filterSession}
            onChange={(e) => setFilterSession(e.target.value)}
            placeholder="sess_…"
          />
        </div>
      </Card>

      {isLoading && (
        <div className="text-sm text-muted text-center py-12">Loading logs…</div>
      )}

      {!isLoading && Object.keys(sessions).length === 0 && (
        <Card className="p-8 text-center">
          <p className="text-sm text-muted">No setup logs found.</p>
          <p className="text-xs text-slate-600 mt-1">Logs appear here each time an admin goes through the "Add Machine" wizard.</p>
        </Card>
      )}

      <div className="space-y-3">
        {Object.entries(sessions).map(([sessionId, entries]) => {
          const first = entries[entries.length - 1];
          const last  = entries[0];
          const isExpanded = expanded === sessionId;
          const hasError = entries.some((e) => e.step.includes('FAILED') || e.step.includes('MISMATCH'));
          const isDone   = entries.some((e) => e.step === 'DEVICE_ONLINE' || e.step === 'FAST_CONNECT_SUCCESS' || e.step === 'FAST_CONNECT_UI_SUCCESS');

          return (
            <Card key={sessionId} className="overflow-hidden">
              {/* Session header */}
              <button
                className="w-full flex items-center gap-4 p-4 text-left hover:bg-white/[0.02] transition-colors"
                onClick={() => setExpanded(isExpanded ? null : sessionId)}
              >
                {/* Status dot */}
                <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                  isDone ? 'bg-emerald-500' : hasError ? 'bg-red-500' : 'bg-amber-400 animate-pulse'
                }`} />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    <span className="font-mono text-xs text-purple-300 font-semibold">{first?.deviceCode}</span>
                    <StepBadge step={last.step} />
                  </div>
                  <p className="text-[11px] text-muted font-mono truncate">{sessionId}</p>
                </div>

                <div className="text-right shrink-0">
                  <p className="text-[11px] text-slate-400">{fmtDatetime(last.createdAt)}</p>
                  <p className="text-[10px] text-muted">{entries.length} events</p>
                </div>

                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8"
                  className={`w-4 h-4 text-muted shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                  <polyline points="4 6 8 10 12 6"/>
                </svg>
              </button>

              {/* Timeline */}
              {isExpanded && (
                <div className="border-t border-white/[0.06] px-4 pt-3 pb-4 space-y-0">
                  {[...entries].reverse().map((log, i) => (
                    <div key={log._id} className="flex gap-3">
                      {/* Line */}
                      <div className="flex flex-col items-center">
                        <div className={`w-2 h-2 rounded-full shrink-0 mt-1.5 ${
                          log.step.includes('FAILED') || log.step.includes('MISMATCH')
                            ? 'bg-red-500'
                            : log.step === 'DEVICE_ONLINE' || log.step.includes('SUCCESS')
                              ? 'bg-emerald-500'
                              : 'bg-purple-500'
                        }`} />
                        {i < entries.length - 1 && (
                          <div className="w-px flex-1 bg-white/[0.06] mt-1" />
                        )}
                      </div>

                      {/* Content */}
                      <div className="pb-4 flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <StepBadge step={log.step} />
                          <span className="text-[10px] text-slate-600">{fmtDatetime(log.createdAt)}</span>
                          {log.adminIp && <span className="text-[10px] text-slate-700 font-mono">from {log.adminIp}</span>}
                        </div>
                        {log.confirmedValue && (
                          <p className="text-xs font-mono text-slate-400 mt-1 break-all">{log.confirmedValue}</p>
                        )}
                        <MetaView data={log.metadata} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </Layout>
  );
}
