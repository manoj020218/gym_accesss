import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Layout } from '../components/layout/Layout';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Input';
import { PageSpinner } from '../components/ui/Spinner';
import { EmptyState } from '../components/ui/EmptyState';
import { accessApi } from '../api/access';
import { useAuthStore } from '../store/auth';
import { fmtDatetime } from '../utils/format';
import { toast } from '../store/toast';

const WS_BASE = (import.meta.env['VITE_API_URL'] ?? 'http://localhost:8080')
  .replace('https://', 'wss://')
  .replace('http://', 'ws://');

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

type Segment = 'members' | 'staff' | 'strangers';

export default function AccessMonitor() {
  const qc = useQueryClient();
  const { selectedBranchId, token: accessToken } = useAuthStore();
  const branchId = selectedBranchId ?? undefined;

  const [segment, setSegment]   = useState<Segment>('members');
  const [zone, setZone]         = useState('');
  const [decision, setDecision] = useState('');
  const [page, setPage]         = useState(1);
  const [wsConnected, setWsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  // Access events — filtered by segment; WS triggers refetch
  const subjectTypeFilter = segment === 'staff' ? 'staff' : segment === 'members' ? 'member' : undefined;
  const { data, isLoading, refetch: refetchEvents } = useQuery({
    queryKey: ['access-events', branchId, zone, decision, subjectTypeFilter, page],
    queryFn:  () =>
      accessApi.events({
        branchId,
        zone:        zone || undefined,
        decision:    decision || undefined,
        subjectType: subjectTypeFilter,
        page,
        limit:       30,
      }),
    enabled: segment !== 'strangers',
  });

  // WebSocket — real-time event push from server
  useEffect(() => {
    if (!accessToken) return;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      const ws = new WebSocket(`${WS_BASE}/api/v1/ws?token=${accessToken}`);
      wsRef.current = ws;

      ws.onopen  = () => setWsConnected(true);
      ws.onclose = () => {
        setWsConnected(false);
        reconnectTimer = setTimeout(connect, 5_000);
      };
      ws.onerror = () => ws.close();
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data as string) as { type: string };
          if (msg.type === 'access_event') {
            void qc.invalidateQueries({ queryKey: ['access-events'] });
          }
        } catch { /* ignore */ }
      };
    }

    connect();
    return () => {
      clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, [accessToken]);  // eslint-disable-line react-hooks/exhaustive-deps

  const { data: devices = [], isLoading: devicesLoading } = useQuery({
    queryKey: ['devices', branchId],
    queryFn:  () => accessApi.devices(branchId),
    refetchInterval: 30_000,
  });

  const events  = data?.data ?? [];
  const total   = data?.total ?? 0;
  const pages   = Math.ceil(total / 30);
  const online  = devices.filter((d) => d.isOnline).length;
  const offline = devices.length - online;

  // U5 devices (have IP — can reach machine directly)
  const u5Devices = devices.filter((d) => d.ipAddress);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const activeDeviceId = selectedDeviceId || u5Devices[0]?.deviceId || '';

  // Member sync results — ALL records from machine (matched + unmatched) with captured pics
  const [syncResults, setSyncResults] = useState<{
    imported: number; total: number;
    records: Array<{
      subjectName?: string; eventTime: string;
      faceUrl?: string; // edge storage URL for matched members
      pic?: string;     // inline base64 for unmatched faces only
      isNew: boolean; matched: boolean; ispass: number;
    }>;
  } | null>(null);
  const [showSyncGrid, setShowSyncGrid] = useState(false);

  const syncMembersMut = useMutation({
    mutationFn: () => accessApi.syncAttendance(activeDeviceId),
    onSuccess: (res) => {
      setSyncResults(res);
      setShowSyncGrid(true);
      void qc.invalidateQueries({ queryKey: ['access-events'] });
      const unmatched = res.records.filter(r => !r.matched).length;
      toast.success(
        `${res.imported} new imported from ${res.total} total` +
        (unmatched > 0 ? ` · ${unmatched} unmatched (re-enroll needed)` : ''),
      );
    },
    onError: () => toast.error('Could not reach machine — check device connection'),
  });

  // Stranger logs — on-demand mutation (not auto-polled)
  const [strangerData, setStrangerData] = useState<{
    total: number;
    data: Array<{ userid: string | number; checkin_time: string; pic?: string }>;
  } | null>(null);

  const syncStrangersMut = useMutation({
    mutationFn: () => accessApi.strangerLogs(activeDeviceId),
    onSuccess: (res) => {
      setStrangerData(res);
      toast.success(`Fetched ${res.total} stranger record${res.total !== 1 ? 's' : ''} from machine`);
    },
    onError: () => toast.error('Could not reach machine — check device connection'),
  });

  return (
    <Layout title="Access Monitor">
      {/* Device status strip */}
      {!devicesLoading && devices.length > 0 && (
        <div className="flex items-center gap-3 mb-5 flex-wrap">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-emerald-500 blink' : 'bg-slate-600'}`} />
            <span className={`text-xs font-semibold ${wsConnected ? 'text-emerald-400' : 'text-slate-500'}`}>
              {wsConnected ? 'Live' : 'Connecting…'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-emerald-500 rounded-full" />
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
              {d.mqttLiveEnabled && (
                <span className={`ml-1.5 ${d.mqttConnected ? 'text-purple-400' : 'text-slate-500'}`}>
                  · MQTT {d.mqttConnected ? '●' : '○'}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Segment toggle */}
      <div className="flex items-center gap-1 mb-5 p-1 bg-white/[0.04] border border-white/[0.07] rounded-xl w-fit">
        {([
          { id: 'members',   label: 'Members' },
          { id: 'staff',     label: 'Staff' },
          { id: 'strangers', label: 'Strangers' },
        ] as { id: Segment; label: string }[]).map((seg) => (
          <button
            key={seg.id}
            onClick={() => { setSegment(seg.id); setPage(1); }}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              segment === seg.id
                ? 'bg-purple-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {seg.label}
          </button>
        ))}
      </div>

      {/* ── MEMBERS SEGMENT ── */}
      {segment === 'members' && (
        <>
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <div className="w-44">
              <Select options={ZONE_OPTIONS} value={zone} onChange={(e) => { setZone(e.target.value); setPage(1); }} />
            </div>
            <div className="w-44">
              <Select options={DECISION_OPTIONS} value={decision} onChange={(e) => { setDecision(e.target.value); setPage(1); }} />
            </div>
            <div className="ml-auto flex items-center gap-3">
              {/* Device picker — only shown when there are multiple U5 machines */}
              {u5Devices.length > 1 && (
                <div className="w-44">
                  <Select
                    options={u5Devices.map((d) => ({ value: d.deviceId, label: d.name }))}
                    value={activeDeviceId}
                    onChange={(e) => setSelectedDeviceId(e.target.value)}
                  />
                </div>
              )}
              {activeDeviceId && (
                <Button
                  size="sm"
                  disabled={syncMembersMut.isPending}
                  onClick={() => syncMembersMut.mutate()}
                >
                  {syncMembersMut.isPending ? (
                    <>
                      <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity=".25"/>
                        <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
                      </svg>
                      Syncing…
                    </>
                  ) : 'Sync from Machine'}
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => void refetchEvents()}>
                Refresh
              </Button>
              <span className="text-xs text-muted">{total.toLocaleString()} events</span>
            </div>
          </div>

          {/* Sync results — "What the machine saw" face-capture grid */}
          {syncResults && showSyncGrid && (
            <div className="mb-4 rounded-xl border border-white/[0.08] bg-white/[0.03]">
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold text-slate-200">What the Machine Saw</span>
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/[0.06] text-slate-400">
                    {syncResults.total} total · {syncResults.imported} new imported
                  </span>
                  {syncResults.records.filter(r => !r.matched).length > 0 && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-900/30 border border-amber-500/20 text-amber-400">
                      {syncResults.records.filter(r => !r.matched).length} unmatched — re-enroll needed
                    </span>
                  )}
                </div>
                <button onClick={() => setShowSyncGrid(false)} className="text-[11px] text-slate-500 hover:text-slate-300">
                  Dismiss ×
                </button>
              </div>

              {/* Face capture grid */}
              <div className="p-4 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-2">
                {syncResults.records.map((rec, i) => {
                  // Matched members: faceUrl is an HTTP URL to edge storage
                  // Unmatched faces: pic is inline base64 from machine punch record
                  const src = rec.faceUrl
                    ?? (rec.pic
                      ? (rec.pic.startsWith('data:') ? rec.pic : `data:image/jpeg;base64,${rec.pic}`)
                      : null);
                  return (
                    <div
                      key={i}
                      title={rec.matched ? `${rec.subjectName} — ${rec.eventTime}` : `Unmatched — ${rec.eventTime}`}
                      className={`rounded-lg overflow-hidden border transition-colors ${
                        !rec.matched   ? 'border-amber-500/40'
                        : rec.isNew    ? 'border-emerald-500/40'
                                       : 'border-white/[0.07]'
                      }`}
                    >
                      {/* Photo */}
                      <div className="aspect-square bg-black/40 flex items-center justify-center">
                        {src ? (
                          <img src={src} alt="" className="w-full h-full object-cover" loading="lazy" />
                        ) : (
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-6 h-6 text-slate-600">
                            <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
                          </svg>
                        )}
                      </div>
                      {/* Label */}
                      <div className="px-1 py-1 bg-black/30">
                        <p className={`text-[9px] font-semibold truncate leading-none mb-0.5 ${rec.matched ? 'text-slate-200' : 'text-amber-400'}`}>
                          {rec.matched ? (rec.subjectName ?? '—') : 'Unmatched'}
                        </p>
                        <p className="text-[9px] text-slate-600 truncate leading-none">
                          {rec.eventTime.slice(11, 16)}
                        </p>
                        <div className="flex gap-1 mt-0.5">
                          {rec.ispass === 1
                            ? <span className="text-[8px] text-emerald-400 font-bold">OPEN</span>
                            : <span className="text-[8px] text-red-400 font-bold">DENY</span>}
                          {rec.isNew && <span className="text-[8px] text-blue-400 font-bold">NEW</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

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
        </>
      )}

      {/* ── STAFF SEGMENT ── */}
      {segment === 'staff' && (
        <>
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <div className="w-44">
              <Select options={ZONE_OPTIONS} value={zone} onChange={(e) => { setZone(e.target.value); setPage(1); }} />
            </div>
            <div className="ml-auto flex items-center gap-3">
              <Button variant="outline" size="sm" onClick={() => void refetchEvents()}>Refresh</Button>
              <span className="text-xs text-muted">{(data?.total ?? 0).toLocaleString()} events</span>
            </div>
          </div>

          <Card>
            {isLoading ? (
              <PageSpinner />
            ) : (data?.data ?? []).length === 0 ? (
              <EmptyState
                title="No staff access events"
                description="Staff members appear here once enrolled on a device and checked in."
              />
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/[0.06]">
                    {['Decision', 'Staff Member', 'Zone', 'Identifier', 'Device', 'Time'].map((h) => (
                      <th key={h} className="text-left text-[11px] font-semibold text-dimmed tracking-widest uppercase px-5 py-3.5">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(data?.data ?? []).map((ev) => (
                    <tr key={ev._id} className="border-b border-white/[0.04] hover:bg-purple-500/[0.03] last:border-0">
                      <td className="px-5 py-3">
                        <Badge variant={ev.decision === 'ALLOW' ? 'allow' : 'deny'}>{ev.decision}</Badge>
                      </td>
                      <td className="px-5 py-3">
                        <p className="text-sm text-slate-200 font-medium">{ev.subjectName ?? ev.subjectId}</p>
                        <p className="text-[11px] text-muted">Staff</p>
                      </td>
                      <td className="px-5 py-3 text-sm text-slate-400">{ev.zone.replace(/_/g, ' ')}</td>
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
            {Math.ceil((data?.total ?? 0) / 30) > 1 && (
              <div className="flex items-center justify-between px-5 py-3.5 border-t border-white/[0.06]">
                <button disabled={page === 1} onClick={() => setPage((p) => p - 1)} className="text-xs text-slate-400 hover:text-slate-200 disabled:opacity-40">← Prev</button>
                <span className="text-xs text-muted">Page {page} of {Math.ceil((data?.total ?? 0) / 30)}</span>
                <button disabled={page === Math.ceil((data?.total ?? 0) / 30)} onClick={() => setPage((p) => p + 1)} className="text-xs text-slate-400 hover:text-slate-200 disabled:opacity-40">Next →</button>
              </div>
            )}
          </Card>
        </>
      )}

      {/* ── STRANGERS SEGMENT ── */}
      {segment === 'strangers' && (
        <>
          {/* Controls row */}
          <div className="flex items-center gap-3 mb-4">
            {/* Device picker — only if multiple U5 machines */}
            {u5Devices.length > 1 && (
              <div className="w-52">
                <Select
                  options={u5Devices.map((d) => ({ value: d.deviceId, label: `${d.name} (${d.zone.replace(/_/g,' ')})` }))}
                  value={activeDeviceId}
                  onChange={(e) => setSelectedDeviceId(e.target.value)}
                />
              </div>
            )}

            <Button
              size="sm"
              disabled={!activeDeviceId || syncStrangersMut.isPending}
              onClick={() => syncStrangersMut.mutate()}
            >
              {syncStrangersMut.isPending ? (
                <>
                  <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity=".25"/>
                    <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
                  </svg>
                  Fetching…
                </>
              ) : 'Sync from Machine'}
            </Button>

            {strangerData && (
              <span className="text-xs text-amber-400 font-semibold ml-1">
                {strangerData.total} stranger {strangerData.total === 1 ? 'record' : 'records'}
              </span>
            )}

            {u5Devices.length === 0 && (
              <span className="text-xs text-muted ml-1">No U5 device with IP configured for this branch.</span>
            )}
          </div>

          {/* Results */}
          {!strangerData ? (
            <Card>
              <EmptyState
                title="No stranger records loaded"
                description="Press Sync to fetch unrecognised face attempts from the machine."
              />
            </Card>
          ) : strangerData.data.length === 0 ? (
            <Card>
              <EmptyState
                title="No strangers recorded"
                description="The machine has no unrecognised face attempts in its log."
              />
            </Card>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
              {strangerData.data.map((rec, i) => {
                const src = rec.pic
                  ? (rec.pic.startsWith('data:') ? rec.pic : `data:image/jpeg;base64,${rec.pic}`)
                  : null;

                return (
                  <div
                    key={i}
                    className="bg-white/[0.04] border border-white/[0.07] rounded-xl overflow-hidden flex flex-col"
                  >
                    {/* Photo */}
                    <div className="aspect-square bg-black/30 flex items-center justify-center">
                      {src ? (
                        <img
                          src={src}
                          alt="Stranger"
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          className="w-10 h-10 text-slate-600"
                        >
                          <circle cx="12" cy="8" r="4"/>
                          <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
                        </svg>
                      )}
                    </div>

                    {/* Timestamp */}
                    <div className="px-2.5 py-2">
                      <p className="text-[10px] text-amber-400 font-semibold leading-none mb-0.5">Stranger</p>
                      <p className="text-[11px] text-slate-400 leading-snug">{rec.checkin_time}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </Layout>
  );
}
