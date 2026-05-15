import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Layout } from '../components/layout/Layout';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { PageSpinner } from '../components/ui/Spinner';
import { EmptyState } from '../components/ui/EmptyState';
import { reportsApi, type StaffPunchRecord } from '../api/reports';
import { useAuthStore } from '../store/auth';
import { fmtDate, fmtDatetime, fmtCurrency } from '../utils/format';
import { api } from '../api/client';

type Tab = 'dues' | 'expiring' | 'collection' | 'denied' | 'lowstock' | 'attendance' | 'staff-attendance';

const TABS: { id: Tab; label: string }[] = [
  { id: 'dues',             label: 'Dues' },
  { id: 'expiring',         label: 'Expiring Soon' },
  { id: 'collection',       label: 'Daily Collection' },
  { id: 'denied',           label: 'Denied Access' },
  { id: 'lowstock',         label: 'Low Stock' },
  { id: 'attendance',       label: 'Attendance' },
  { id: 'staff-attendance', label: 'Staff Attendance' },
];

export default function Reports() {
  const { selectedBranchId } = useAuthStore();
  const branchId = selectedBranchId ?? undefined;
  const [tab, setTab] = useState<Tab>('dues');

  // Date range filter for staff-attendance tab
  const today = new Date().toISOString().substring(0, 10);
  const firstOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().substring(0, 10);
  const [staffFrom, setStaffFrom] = useState(firstOfMonth);
  const [staffTo,   setStaffTo]   = useState(today);
  const [downloading, setDownloading] = useState(false);

  const { data: dues, isLoading: l1 } = useQuery({
    queryKey: ['report-dues', branchId],
    queryFn:  () => reportsApi.dues(branchId),
    enabled:  tab === 'dues',
  });

  const { data: expiring, isLoading: l2 } = useQuery({
    queryKey: ['report-expiring', branchId],
    queryFn:  () => reportsApi.expiring({ branchId, days: 14 }),
    enabled:  tab === 'expiring',
  });

  const { data: collection, isLoading: l3 } = useQuery({
    queryKey: ['report-collection', branchId],
    queryFn:  () => reportsApi.dailyCollection({ branchId }),
    enabled:  tab === 'collection',
  });

  const { data: denied, isLoading: l4 } = useQuery({
    queryKey: ['report-denied', branchId],
    queryFn:  () => reportsApi.accessDenied({ branchId }),
    enabled:  tab === 'denied',
  });

  const { data: lowstock, isLoading: l5 } = useQuery({
    queryKey: ['report-lowstock', branchId],
    queryFn:  () => reportsApi.stockLow(branchId),
    enabled:  tab === 'lowstock',
  });

  const { data: attendance, isLoading: l6 } = useQuery({
    queryKey: ['report-attendance', branchId],
    queryFn:  () => reportsApi.attendance({ branchId }),
    enabled:  tab === 'attendance',
  });

  const { data: staffAtt, isLoading: l7 } = useQuery({
    queryKey: ['report-staff-attendance', branchId, staffFrom, staffTo],
    queryFn:  () => reportsApi.staffAttendance({ branchId, from: staffFrom || undefined, to: staffTo || undefined }),
    enabled:  tab === 'staff-attendance',
  });

  const loading = l1 || l2 || l3 || l4 || l5 || l6 || l7;

  const handleDownloadAlog = async () => {
    setDownloading(true);
    try {
      const params: Record<string, string> = {};
      if (branchId)  params['branchId'] = branchId;
      if (staffFrom) params['from']     = staffFrom;
      if (staffTo)   params['to']       = staffTo;
      const res = await api.get<string>('/reports/staff-attendance/download', {
        params,
        responseType: 'blob',
      });
      const url  = URL.createObjectURL(new Blob([res.data as unknown as BlobPart], { type: 'text/plain' }));
      const month    = staffFrom ? new Date(staffFrom).getMonth() + 1 : new Date().getMonth() + 1;
      const fileName = `ALOG_0${String(month).padStart(2, '0')}.txt`;
      const a    = document.createElement('a');
      a.href     = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Layout title="Reports">
      {/* Tabs */}
      <div className="flex border-b border-white/[0.06] mb-5 -mx-6 px-6 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`py-3 px-4 text-sm font-semibold border-b-2 transition-colors mr-1 whitespace-nowrap ${
              tab === t.id
                ? 'border-purple-500 text-purple-400'
                : 'border-transparent text-muted hover:text-slate-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Card>
        {loading ? (
          <PageSpinner />
        ) : (
          <>
            {/* DUES — expired members */}
            {tab === 'dues' && (
              <ReportTable
                headers={['Member', 'Code', 'Phone', 'Status']}
                data={(dues ?? []) as Record<string, unknown>[]}
                empty="No members with dues"
                row={(m) => [
                  <NameCell key="n" name={`${String(m.firstName ?? '')} ${String(m.lastName ?? '')}`} />,
                  <span key="c" className="font-mono text-xs text-slate-400">{String(m.memberCode ?? '—')}</span>,
                  <span key="p" className="text-slate-300">{String(m.phone ?? '—')}</span>,
                  <Badge key="s" variant={(m.status as string) as Parameters<typeof Badge>[0]['variant']}>{String(m.status)}</Badge>,
                ]}
              />
            )}

            {/* EXPIRING */}
            {tab === 'expiring' && (
              <ReportTable
                headers={['Member ID', 'Plan', 'Expires', 'Days Left', 'Status']}
                data={(expiring ?? []) as Record<string, unknown>[]}
                empty="No memberships expiring in 14 days"
                row={(ms) => {
                  const endDate = new Date(ms.endDate as string);
                  const daysLeft = Math.ceil((endDate.getTime() - Date.now()) / 86_400_000);
                  return [
                    <span key="m" className="font-mono text-xs text-slate-400">{String(ms.memberId ?? '—')}</span>,
                    <span key="p" className="text-slate-300">{String(ms.planType ?? '—')}</span>,
                    <span key="d" className="text-amber-400 text-xs">{fmtDate(ms.endDate as string)}</span>,
                    <span key="dl" className={`text-xs font-semibold ${daysLeft <= 3 ? 'text-red-400' : 'text-amber-400'}`}>{daysLeft}d</span>,
                    <Badge key="s" variant={(ms.status as string) as Parameters<typeof Badge>[0]['variant']}>{String(ms.status)}</Badge>,
                  ];
                }}
              />
            )}

            {/* DAILY COLLECTION — backend returns _id: { date, branchId }, totalAmount, count */}
            {tab === 'collection' && (
              <ReportTable
                headers={['Date', 'Revenue', 'Transactions']}
                data={(collection ?? []) as Record<string, unknown>[]}
                empty="No collection data"
                row={(row) => {
                  const id = row._id as Record<string, unknown> | null;
                  const dateStr = id?.date ?? row.date ?? '—';
                  const total = (row.totalAmount as number) ?? 0;
                  return [
                    <span key="d" className="text-slate-300">{fmtDate(String(dateStr))}</span>,
                    <span key="r" className="text-emerald-400 font-semibold">{fmtCurrency(total)}</span>,
                    <span key="c" className="text-slate-400">{String(row.count ?? 0)}</span>,
                  ];
                }}
              />
            )}

            {/* DENIED ACCESS */}
            {tab === 'denied' && (
              <ReportTable
                headers={['Subject', 'Zone', 'Reason', 'Time']}
                data={(denied ?? []) as Record<string, unknown>[]}
                empty="No denied access events"
                row={(ev) => [
                  <NameCell key="n" name={String(ev.subjectName ?? ev.subjectId ?? '—')} />,
                  <span key="z" className="text-slate-400">{String(ev.zone ?? '—').replace(/_/g, ' ')}</span>,
                  <span key="r" className="text-red-400 text-xs">{String(ev.denyReason ?? '—')}</span>,
                  <span key="t" className="text-muted text-xs">{fmtDate(String(ev.eventTime ?? ''))}</span>,
                ]}
              />
            )}

            {/* LOW STOCK */}
            {tab === 'lowstock' && (
              <ReportTable
                headers={['Product', 'Category', 'SKU', 'Stock', 'Min Level']}
                data={(lowstock ?? []) as Record<string, unknown>[]}
                empty="All products above minimum stock level"
                row={(p) => [
                  <span key="n" className="text-sm font-medium text-slate-200">{String(p.name)}</span>,
                  <span key="cat" className="text-xs text-muted">{String(p.category ?? '—')}</span>,
                  <span key="s" className="font-mono text-xs text-muted">{String(p.sku ?? '—')}</span>,
                  <span key="q" className="text-amber-400 font-semibold">{String(p.stockQty ?? 0)}</span>,
                  <span key="m" className="text-muted">{String(p.minStockLevel ?? 0)}</span>,
                ]}
              />
            )}

            {/* ATTENDANCE — backend returns count, uniqueCount */}
            {tab === 'attendance' && (
              <ReportTable
                headers={['Date', 'Check-ins', 'Unique Members']}
                data={(attendance ?? []) as Record<string, unknown>[]}
                empty="No attendance data"
                row={(row) => {
                  const id = row._id as Record<string, unknown> | null;
                  const dateStr = id?.date ?? row.date ?? '—';
                  return [
                    <span key="d" className="text-slate-300">{fmtDate(String(dateStr))}</span>,
                    <span key="c" className="text-slate-200 font-semibold">{String(row.count ?? 0)}</span>,
                    <span key="u" className="text-purple-400">{String(row.uniqueCount ?? '—')}</span>,
                  ];
                }}
              />
            )}

            {/* STAFF ATTENDANCE */}
            {tab === 'staff-attendance' && (
              <StaffAttendanceTab
                data={staffAtt?.data ?? []}
                total={staffAtt?.total ?? 0}
                from={staffFrom}
                to={staffTo}
                onFromChange={setStaffFrom}
                onToChange={setStaffTo}
                downloading={downloading}
                onDownload={() => void handleDownloadAlog()}
              />
            )}
          </>
        )}
      </Card>
    </Layout>
  );
}

function NameCell({ name }: { name: string }) {
  return <span className="text-sm font-medium text-slate-200">{name}</span>;
}

function StaffAttendanceTab({
  data, total, from, to, onFromChange, onToChange, downloading, onDownload,
}: {
  data: StaffPunchRecord[];
  total: number;
  from: string;
  to: string;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
  downloading: boolean;
  onDownload: () => void;
}) {
  return (
    <div>
      {/* Controls */}
      <div className="flex items-center gap-3 px-5 py-3.5 border-b border-white/[0.06] flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-[11px] text-muted font-semibold">From</label>
          <input
            type="date"
            value={from}
            onChange={(e) => onFromChange(e.target.value)}
            className="bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-purple-500/50"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-[11px] text-muted font-semibold">To</label>
          <input
            type="date"
            value={to}
            onChange={(e) => onToChange(e.target.value)}
            className="bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-purple-500/50"
          />
        </div>
        <span className="text-xs text-muted ml-1">{total} records</span>
        {total > 0 && (
          <span className="text-[11px] text-muted hidden sm:block">
            Save to EDGEFOLIO attendance folder
          </span>
        )}
        <button
          onClick={onDownload}
          disabled={downloading || total === 0}
          className="ml-auto flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-600/20 border border-emerald-500/30 text-emerald-400 text-xs font-semibold hover:bg-emerald-600/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {downloading ? (
            <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity=".25"/>
              <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
            </svg>
          ) : (
            <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          )}
          Download ALOG_003.txt
        </button>
      </div>

      {/* Table */}
      {data.length === 0 ? (
        <EmptyState
          title="No staff attendance records"
          description="Staff check-ins appear here once enrolled on a device and synced."
        />
      ) : (
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/[0.06]">
              {['Staff Member', 'Machine User ID', 'Identifier', 'Device', 'Zone', 'Time'].map((h) => (
                <th key={h} className="text-left text-[11px] font-semibold text-dimmed tracking-widest uppercase px-5 py-3.5">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((rec) => (
              <tr key={rec._id} className="border-b border-white/[0.04] hover:bg-purple-500/[0.03] last:border-0">
                <td className="px-5 py-3 text-sm font-medium text-slate-200">{rec.subjectName ?? rec.subjectId}</td>
                <td className="px-5 py-3 text-xs font-mono text-slate-400">
                  {rec.machineUserId ? String(rec.machineUserId).padStart(8, '0') : '—'}
                </td>
                <td className="px-5 py-3">
                  <span className="text-xs bg-white/[0.05] border border-white/[0.08] rounded px-2 py-0.5 text-slate-400">
                    {rec.identifierUsed}
                  </span>
                </td>
                <td className="px-5 py-3 text-xs text-muted font-mono">{rec.edgeDeviceId}</td>
                <td className="px-5 py-3 text-xs text-slate-400">{rec.zone.replace(/_/g, ' ')}</td>
                <td className="px-5 py-3 text-xs text-muted">{fmtDatetime(rec.eventTime)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ReportTable({
  headers, data, row, empty,
}: {
  headers: string[];
  data: Record<string, unknown>[];
  row: (item: Record<string, unknown>) => React.ReactNode[];
  empty: string;
}) {
  if (!data.length) return <EmptyState title={empty} />;
  return (
    <table className="w-full">
      <thead>
        <tr className="border-b border-white/[0.06]">
          {headers.map((h) => (
            <th key={h} className="text-left text-[11px] font-semibold text-dimmed tracking-widest uppercase px-5 py-3.5">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.map((item, i) => (
          <tr key={i} className="border-b border-white/[0.04] hover:bg-purple-500/[0.03] last:border-0">
            {row(item).map((cell, j) => (
              <td key={j} className="px-5 py-3 text-sm text-slate-400">{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
