import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Layout } from '../components/layout/Layout';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Select } from '../components/ui/Input';
import { PageSpinner } from '../components/ui/Spinner';
import { EmptyState } from '../components/ui/EmptyState';
import { accessApi } from '../api/access';
import { useAuthStore } from '../store/auth';
import { fmtDatetime } from '../utils/format';

const ZONE_OPTIONS = [
  { value: '', label: 'All Zones' },
  { value: 'main_entry',  label: 'Main Entry' },
  { value: 'cardio',      label: 'Cardio' },
  { value: 'weights',     label: 'Weights' },
  { value: 'pt_room',     label: 'PT Room' },
  { value: 'pool',        label: 'Pool' },
  { value: 'spa',         label: 'Spa' },
];

const DECISION_OPTIONS = [
  { value: '', label: 'All Decisions' },
  { value: 'ALLOW', label: 'Allowed' },
  { value: 'DENY',  label: 'Denied' },
];

export default function AccessMonitor() {
  const { selectedBranchId } = useAuthStore();
  const branchId = selectedBranchId ?? undefined;
  const [zone, setZone]         = useState('');
  const [decision, setDecision] = useState('');
  const [page, setPage]         = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['access-events', branchId, zone, decision, page],
    queryFn:  () =>
      accessApi.events({
        branchId,
        zone:     zone     || undefined,
        decision: decision || undefined,
        page,
        limit:    30,
      }),
    refetchInterval: 8_000,
  });

  const { data: devices = [] } = useQuery({
    queryKey: ['devices', branchId],
    queryFn:  () => accessApi.devices(branchId),
    refetchInterval: 30_000,
  });

  const events  = data?.data ?? [];
  const total   = data?.total ?? 0;
  const pages   = Math.ceil(total / 30);
  const online  = devices.filter((d) => d.isOnline).length;
  const offline = devices.length - online;

  return (
    <Layout title="Access Monitor">
      {/* Device status strip */}
      {devices.length > 0 && (
        <div className="flex items-center gap-3 mb-5 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-emerald-500 rounded-full blink" />
            <span className="text-xs text-emerald-400 font-semibold">{online} online</span>
          </div>
          {offline > 0 && (
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-red-500 rounded-full" />
              <span className="text-xs text-red-400 font-semibold">{offline} offline</span>
            </div>
          )}
          {devices.map((d) => (
            <div
              key={d._id}
              className={`text-[11px] px-2.5 py-1 rounded-lg border font-medium ${
                d.isOnline
                  ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400'
                  : 'bg-red-500/10 border-red-500/25 text-red-400'
              }`}
            >
              {d.name} · {d.zone.replace(/_/g, ' ')}
              {d.pendingEventCount ? ` · ${d.pendingEventCount} pending` : ''}
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <div className="w-44">
          <Select options={ZONE_OPTIONS} value={zone} onChange={(e) => { setZone(e.target.value); setPage(1); }} />
        </div>
        <div className="w-44">
          <Select options={DECISION_OPTIONS} value={decision} onChange={(e) => { setDecision(e.target.value); setPage(1); }} />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="w-2 h-2 bg-emerald-500 rounded-full blink" />
          <span className="text-xs text-muted">Auto-refresh · {total.toLocaleString()} events</span>
        </div>
      </div>

      {/* Events table */}
      <Card>
        {isLoading ? (
          <PageSpinner />
        ) : events.length === 0 ? (
          <EmptyState
            title="No access events"
            description="Events appear here as members scan in at the door."
          />
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/[0.06]">
                {['Decision', 'Subject', 'Zone', 'Identifier', 'Device', 'Time'].map((h) => (
                  <th key={h} className="text-left text-[11px] font-semibold text-dimmed tracking-widest uppercase px-5 py-3.5">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {events.map((ev) => (
                <tr
                  key={ev._id}
                  className="border-b border-white/[0.04] hover:bg-purple-500/[0.03] last:border-0 animate-slide-in"
                >
                  <td className="px-5 py-3">
                    <Badge variant={ev.decision === 'ALLOW' ? 'allow' : 'deny'}>
                      {ev.decision}
                    </Badge>
                  </td>
                  <td className="px-5 py-3">
                    <p className="text-sm text-slate-200 font-medium">
                      {ev.subjectName ?? ev.subjectId}
                    </p>
                    <p className="text-[11px] text-muted">{ev.subjectType}</p>
                  </td>
                  <td className="px-5 py-3 text-sm text-slate-400">
                    {ev.zone.replace(/_/g, ' ')}
                  </td>
                  <td className="px-5 py-3">
                    <span className="text-xs bg-white/[0.05] border border-white/[0.08] rounded px-2 py-0.5 text-slate-400">
                      {ev.identifierUsed}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-xs text-muted font-mono">{ev.edgeDeviceId}</td>
                  <td className="px-5 py-3 text-xs text-muted">{fmtDatetime(ev.eventTime)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {pages > 1 && (
          <div className="flex items-center justify-between px-5 py-3.5 border-t border-white/[0.06]">
            <button
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
              className="text-xs text-slate-400 hover:text-slate-200 disabled:opacity-40"
            >
              ← Prev
            </button>
            <span className="text-xs text-muted">Page {page} of {pages}</span>
            <button
              disabled={page === pages}
              onClick={() => setPage((p) => p + 1)}
              className="text-xs text-slate-400 hover:text-slate-200 disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        )}
      </Card>
    </Layout>
  );
}
