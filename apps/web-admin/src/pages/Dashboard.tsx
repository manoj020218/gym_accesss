import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Layout } from '../components/layout/Layout';
import { KpiCard, Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { PageSpinner } from '../components/ui/Spinner';
import { paymentApi } from '../api/payments';
import { memberApi } from '../api/members';
import { accessApi } from '../api/access';
import { reportsApi } from '../api/reports';
import { useAuthStore } from '../store/auth';
import { fmtCurrency, fmtRelative, fmtDate } from '../utils/format';
import { subDays, startOfDay, format } from 'date-fns';

export default function Dashboard() {
  const navigate = useNavigate();
  const { user, selectedBranchId } = useAuthStore();
  const branchId = selectedBranchId ?? undefined;
  const todayStart = startOfDay(new Date()).toISOString();

  const { data: summary } = useQuery({
    queryKey: ['payment-summary', branchId],
    queryFn:  () => paymentApi.summary({ branchId, from: todayStart }),
    refetchInterval: 60_000,
  });

  const { data: activeMembers } = useQuery({
    queryKey: ['members-active', branchId],
    queryFn:  () => memberApi.list({ branchId, status: 'active', limit: 1 }),
  });

  const { data: recentEvents, isLoading: eventsLoading } = useQuery({
    queryKey: ['access-events-recent', branchId],
    queryFn:  () => accessApi.events({ branchId, limit: 12 }),
    refetchInterval: 10_000,
  });

  const { data: expiring } = useQuery({
    queryKey: ['expiring', branchId],
    queryFn:  () => reportsApi.expiring({ branchId, days: 7 }),
  });

  const { data: weeklyRevenue } = useQuery({
    queryKey: ['weekly-revenue', branchId],
    queryFn: async () => {
      const days = await reportsApi.dailyCollection({
        branchId,
        from: subDays(new Date(), 6).toISOString(),
      }) as { _id: string; total: number }[];
      return days;
    },
  });

  const firstName = user?.displayName?.split(' ')[0] ?? 'there';

  return (
    <Layout
      title="Dashboard"
      actions={
        <Button size="sm" onClick={() => navigate('/members?new=1')}>
          <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Add Member
        </Button>
      }
    >
      {/* Welcome */}
      <div className="mb-6">
        <h2 className="text-[22px] font-extrabold tracking-tight">Good morning, {firstName} 👋</h2>
        <p className="text-sm text-muted mt-0.5">Here's what's happening at your gym today</p>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <KpiCard
          label="Today's Collection"
          value={fmtCurrency(summary?.totalRevenue ?? 0)}
          iconBg="bg-emerald-500/12"
          icon={
            <svg width="16" height="16" fill="none" stroke="#10B981" strokeWidth="2" viewBox="0 0 24 24">
              <line x1="12" y1="1" x2="12" y2="23"/>
              <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>
            </svg>
          }
          trend={{ value: `${summary?.count ?? 0} txns`, up: true }}
          progress={72}
        />
        <KpiCard
          label="Active Members"
          value={activeMembers?.total?.toLocaleString() ?? '—'}
          iconBg="bg-purple-500/12"
          icon={
            <svg width="16" height="16" fill="none" stroke="#A78BFA" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
            </svg>
          }
        />
        <KpiCard
          label="Check-ins Today"
          value={recentEvents?.data?.filter(e => e.decision === 'ALLOW').length?.toString() ?? '0'}
          iconBg="bg-cyan-500/12"
          icon={
            <svg width="16" height="16" fill="none" stroke="#22D3EE" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
          }
          trend={{ value: `${recentEvents?.data?.filter(e => e.decision === 'DENY').length ?? 0} denied`, up: false }}
        />
        <KpiCard
          label="Expiring (7 days)"
          value={Array.isArray(expiring) ? expiring.length.toString() : '—'}
          iconBg="bg-amber-500/12"
          icon={
            <svg width="16" height="16" fill="none" stroke="#FBBF24" strokeWidth="2" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
          }
        />
      </div>

      <div className="grid grid-cols-3 gap-4">
        {/* Live access feed */}
        <Card className="col-span-2 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-slate-200">Live Access Feed</h3>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-emerald-500 rounded-full blink" />
              <span className="text-xs text-muted">Live</span>
              <button
                onClick={() => navigate('/access')}
                className="text-xs text-purple-400 hover:text-purple-300 ml-2"
              >
                View all →
              </button>
            </div>
          </div>

          {eventsLoading ? (
            <PageSpinner />
          ) : (
            <div className="space-y-0">
              {recentEvents?.data?.slice(0, 8).map((ev, i) => (
                <div
                  key={ev._id}
                  className="flex items-center gap-3 py-2.5 border-b border-white/[0.04] last:border-0"
                  style={{ animationDelay: `${i * 40}ms` }}
                >
                  <Badge variant={ev.decision === 'ALLOW' ? 'allow' : 'deny'}>
                    {ev.decision}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-slate-300 truncate">
                      {ev.subjectName ?? ev.subjectId}
                    </p>
                    <p className="text-[11px] text-muted truncate">
                      {ev.zone.replace(/_/g, ' ')} · {ev.identifierUsed}
                      {ev.denyReason && ` · ${ev.denyReason}`}
                    </p>
                  </div>
                  <span className="text-[11px] text-slate-600 flex-shrink-0">
                    {fmtRelative(ev.eventTime)}
                  </span>
                </div>
              ))}
              {!recentEvents?.data?.length && (
                <p className="text-sm text-muted text-center py-8">No events yet</p>
              )}
            </div>
          )}
        </Card>

        {/* Expiring memberships */}
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-slate-200">Expiring Soon</h3>
            <button
              onClick={() => navigate('/reports')}
              className="text-xs text-purple-400 hover:text-purple-300"
            >
              Reports →
            </button>
          </div>
          <div className="space-y-3">
            {Array.isArray(expiring) && expiring.slice(0, 6).map((m: Record<string, unknown>) => (
              <button
                key={m._id as string}
                onClick={() => navigate(`/members/${(m.memberId as Record<string, unknown>)?._id ?? m.memberId}`)}
                className="w-full flex items-center gap-2.5 text-left hover:bg-white/[0.03] rounded-lg p-1 -mx-1 transition-colors"
              >
                <div className="w-7 h-7 rounded-lg grad-bg flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0">
                  {String((m.memberId as Record<string, unknown>)?.firstName ?? '?')[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-slate-300 truncate">
                    {String((m.memberId as Record<string, unknown>)?.firstName ?? '')} {String((m.memberId as Record<string, unknown>)?.lastName ?? '')}
                  </p>
                  <p className="text-[11px] text-amber-400">
                    Expires {fmtDate(m.endDate as string)}
                  </p>
                </div>
              </button>
            ))}
            {(!Array.isArray(expiring) || expiring.length === 0) && (
              <p className="text-xs text-muted text-center py-6">No memberships expiring soon</p>
            )}
          </div>
        </Card>
      </div>

      {/* Weekly revenue sparkline */}
      {weeklyRevenue && weeklyRevenue.length > 0 && (
        <Card className="mt-4 p-5">
          <h3 className="text-sm font-bold text-slate-200 mb-4">Last 7 Days Revenue</h3>
          <div className="flex items-end gap-1.5 h-16">
            {weeklyRevenue.map((d) => {
              const max = Math.max(...weeklyRevenue.map((x) => x.total), 1);
              const pct = (d.total / max) * 100;
              return (
                <div key={d._id} className="flex-1 flex flex-col items-center gap-1">
                  <div
                    className="w-full rounded-sm grad-bg opacity-70 hover:opacity-100 transition-opacity"
                    style={{ height: `${Math.max(pct, 4)}%` }}
                    title={fmtCurrency(d.total)}
                  />
                  <span className="text-[9px] text-slate-600">{format(new Date(d._id), 'dd')}</span>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </Layout>
  );
}
