import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Layout } from '../components/layout/Layout';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { PageSpinner } from '../components/ui/Spinner';
import { EmptyState } from '../components/ui/EmptyState';
import { reportsApi } from '../api/reports';
import { useAuthStore } from '../store/auth';
import { fmtDate, fmtCurrency } from '../utils/format';

type Tab = 'dues' | 'expiring' | 'collection' | 'denied' | 'lowstock' | 'attendance';

const TABS: { id: Tab; label: string }[] = [
  { id: 'dues',       label: 'Dues' },
  { id: 'expiring',   label: 'Expiring Soon' },
  { id: 'collection', label: 'Daily Collection' },
  { id: 'denied',     label: 'Denied Access' },
  { id: 'lowstock',   label: 'Low Stock' },
  { id: 'attendance', label: 'Attendance' },
];

export default function Reports() {
  const { selectedBranchId } = useAuthStore();
  const branchId = selectedBranchId ?? undefined;
  const [tab, setTab] = useState<Tab>('dues');

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

  const loading = l1 || l2 || l3 || l4 || l5 || l6;

  return (
    <Layout title="Reports">
      {/* Tabs */}
      <div className="flex border-b border-white/[0.06] mb-5 -mx-6 px-6">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`py-3 px-4 text-sm font-semibold border-b-2 transition-colors mr-1 ${
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
            {/* DUES */}
            {tab === 'dues' && (
              <ReportTable
                headers={['Member', 'Code', 'Phone', 'Status', 'Branch']}
                data={Array.isArray(dues) ? dues : []}
                empty="No members with dues"
                row={(m: Record<string, unknown>) => [
                  <NameCell key="n" name={`${m.firstName} ${m.lastName}`} />,
                  <span key="c" className="font-mono text-xs text-slate-400">{String(m.memberCode)}</span>,
                  String(m.phone),
                  <Badge key="s" variant={(m.status as string) as Parameters<typeof Badge>[0]['variant']}>{String(m.status)}</Badge>,
                  String(m.branchId),
                ]}
              />
            )}

            {/* EXPIRING */}
            {tab === 'expiring' && (
              <ReportTable
                headers={['Member', 'Plan', 'Expires', 'Status']}
                data={Array.isArray(expiring) ? expiring : []}
                empty="No memberships expiring in 14 days"
                row={(ms: Record<string, unknown>) => {
                  const member = ms.memberId as Record<string, unknown>;
                  return [
                    <NameCell key="n" name={`${member?.firstName ?? ''} ${member?.lastName ?? ''}`} />,
                    String(ms.planType),
                    <span key="d" className="text-amber-400 text-xs">{fmtDate(ms.endDate as string)}</span>,
                    <Badge key="s" variant={(ms.status as string) as Parameters<typeof Badge>[0]['variant']}>{String(ms.status)}</Badge>,
                  ];
                }}
              />
            )}

            {/* DAILY COLLECTION */}
            {tab === 'collection' && (
              <ReportTable
                headers={['Date', 'Revenue', 'Transactions']}
                data={Array.isArray(collection) ? collection : []}
                empty="No collection data"
                row={(row: Record<string, unknown>) => [
                  fmtDate(row._id as string),
                  <span key="r" className="text-emerald-400 font-semibold">{fmtCurrency(row.total as number)}</span>,
                  String(row.count),
                ]}
              />
            )}

            {/* DENIED ACCESS */}
            {tab === 'denied' && (
              <ReportTable
                headers={['Subject', 'Zone', 'Reason', 'Time']}
                data={Array.isArray(denied) ? denied : []}
                empty="No denied access events"
                row={(ev: Record<string, unknown>) => [
                  String(ev.subjectName ?? ev.subjectId),
                  String(ev.zone).replace(/_/g, ' '),
                  <span key="r" className="text-red-400 text-xs">{String(ev.denyReason ?? '—')}</span>,
                  fmtDate(ev.eventTime as string),
                ]}
              />
            )}

            {/* LOW STOCK */}
            {tab === 'lowstock' && (
              <ReportTable
                headers={['Product', 'SKU', 'Current Stock', 'Min Level']}
                data={Array.isArray(lowstock) ? lowstock : []}
                empty="All products above minimum stock level"
                row={(p: Record<string, unknown>) => [
                  String(p.name),
                  String(p.sku ?? '—'),
                  <span key="s" className="text-amber-400 font-semibold">{String(p.stockQty)}</span>,
                  String(p.minStockLevel),
                ]}
              />
            )}

            {/* ATTENDANCE */}
            {tab === 'attendance' && (
              <ReportTable
                headers={['Date', 'Check-ins', 'Unique Members']}
                data={Array.isArray(attendance) ? attendance : []}
                empty="No attendance data"
                row={(row: Record<string, unknown>) => [
                  fmtDate(row._id as string),
                  String(row.total),
                  String(row.unique ?? '—'),
                ]}
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
