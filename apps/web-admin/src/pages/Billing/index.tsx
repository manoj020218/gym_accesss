import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Layout } from '../../components/layout/Layout';
import { Card, KpiCard } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Input';
import { Input } from '../../components/ui/Input';
import { PageSpinner } from '../../components/ui/Spinner';
import { EmptyState } from '../../components/ui/EmptyState';
import { Modal } from '../../components/ui/Modal';
import { paymentApi } from '../../api/payments';
import { useAuthStore } from '../../store/auth';
import { toast } from '../../store/toast';
import { fmtCurrency, fmtDatetime } from '../../utils/format';

const MODE_OPTIONS = [
  { value: '', label: 'All Modes' },
  { value: 'cash',   label: 'Cash' },
  { value: 'upi',    label: 'UPI' },
  { value: 'card',   label: 'Card' },
  { value: 'online', label: 'Online' },
];

function StandalonePaymentForm({ onSuccess, branchId }: { onSuccess: () => void; branchId?: string }) {
  const [form, setForm] = useState({ memberId: '', amount: '', mode: 'cash', purpose: '' });

  const mut = useMutation({
    mutationFn: () =>
      paymentApi.create({
        memberId:  form.memberId || 'walk-in',
        branchId:  branchId ?? '',
        amount:    Number(form.amount),
        discount:  0,
        gstAmount: 0,
        mode:      form.mode,
        purpose:   form.purpose || undefined,
      }),
    onSuccess: () => { toast.success('Payment recorded'); onSuccess(); },
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <form onSubmit={(e) => { e.preventDefault(); mut.mutate(); }} className="flex flex-col gap-4">
      <Input label="Member ID (blank = walk-in)" value={form.memberId} onChange={set('memberId')} />
      <Input label="Amount (₹)" type="number" value={form.amount} onChange={set('amount')} />
      <Select
        label="Mode"
        options={[
          { value: 'cash', label: 'Cash' },
          { value: 'upi',  label: 'UPI' },
          { value: 'card', label: 'Card' },
        ]}
        value={form.mode}
        onChange={(e) => setForm((f) => ({ ...f, mode: e.target.value }))}
      />
      <Input label="Purpose (optional)" value={form.purpose} onChange={set('purpose')} />
      <div className="flex justify-end pt-1">
        <Button type="submit" loading={mut.isPending}>Record</Button>
      </div>
    </form>
  );
}

export default function Billing() {
  const { selectedBranchId } = useAuthStore();
  const branchId = selectedBranchId ?? undefined;
  const [page, setPage]   = useState(1);
  const [mode, setMode]   = useState('');
  const [showNew, setShowNew] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['payments', branchId, mode, page],
    queryFn:  () => paymentApi.list({ branchId, page, limit: 20 }),
  });

  const { data: summary } = useQuery({
    queryKey: ['payment-summary-full', branchId],
    queryFn:  () => paymentApi.summary({ branchId }),
  });

  const payments = data?.data ?? [];
  const total    = data?.total ?? 0;
  const pages    = Math.ceil(total / 20);
  const byMode   = summary?.byMode ?? [];

  return (
    <Layout
      title="Fees & Billing"
      actions={
        <Button size="sm" onClick={() => setShowNew(true)}>
          <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Record Payment
        </Button>
      }
    >
      {/* Summary KPIs */}
      <div className="grid grid-cols-4 gap-4 mb-5">
        <KpiCard
          label="Total Revenue"
          value={fmtCurrency(summary?.totalRevenue ?? 0)}
          iconBg="bg-emerald-500/12"
          icon={
            <svg width="16" height="16" fill="none" stroke="#10B981" strokeWidth="2" viewBox="0 0 24 24">
              <line x1="12" y1="1" x2="12" y2="23"/>
              <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>
            </svg>
          }
        />
        <KpiCard
          label="Total Transactions"
          value={(summary?.count ?? 0).toLocaleString()}
          iconBg="bg-purple-500/12"
          icon={
            <svg width="16" height="16" fill="none" stroke="#A78BFA" strokeWidth="2" viewBox="0 0 24 24">
              <rect x="1" y="4" width="22" height="16" rx="2"/><path d="M1 10h22"/>
            </svg>
          }
        />
        {byMode.slice(0, 2).map((m) => (
          <KpiCard
            key={m._id}
            label={m._id.toUpperCase()}
            value={fmtCurrency(m.total)}
            iconBg="bg-cyan-500/12"
            icon={
              <svg width="16" height="16" fill="none" stroke="#22D3EE" strokeWidth="2" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/>
              </svg>
            }
          />
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <div className="w-44">
          <Select options={MODE_OPTIONS} value={mode} onChange={(e) => setMode(e.target.value)} />
        </div>
        <span className="text-xs text-muted ml-auto">{total.toLocaleString()} transactions</span>
      </div>

      {/* Table */}
      <Card>
        {isLoading ? (
          <PageSpinner />
        ) : payments.length === 0 ? (
          <EmptyState title="No payments found" />
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/[0.06]">
                {['Receipt', 'Member', 'Amount', 'Mode', 'Purpose', 'Date'].map((h) => (
                  <th key={h} className="text-left text-[11px] font-semibold text-dimmed tracking-widest uppercase px-5 py-3.5">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p._id} className="border-b border-white/[0.04] hover:bg-purple-500/[0.03] last:border-0">
                  <td className="px-5 py-3.5 text-xs font-mono text-purple-400">{p.receiptNo}</td>
                  <td className="px-5 py-3.5 text-sm text-slate-300">{p.memberName ?? p.memberId ?? '—'}</td>
                  <td className="px-5 py-3.5 text-sm font-semibold text-emerald-400">{fmtCurrency(p.amount)}</td>
                  <td className="px-5 py-3.5 text-xs text-slate-400 uppercase">{p.mode}</td>
                  <td className="px-5 py-3.5 text-xs text-muted">{p.purpose ?? 'Membership'}</td>
                  <td className="px-5 py-3.5 text-xs text-muted">{fmtDatetime(p.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {pages > 1 && (
          <div className="flex items-center justify-between px-5 py-3.5 border-t border-white/[0.06]">
            <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>← Prev</Button>
            <span className="text-xs text-muted">Page {page} of {pages}</span>
            <Button variant="outline" size="sm" disabled={page === pages} onClick={() => setPage((p) => p + 1)}>Next →</Button>
          </div>
        )}
      </Card>

      <Modal open={showNew} onClose={() => setShowNew(false)} title="Record Payment" width="max-w-md">
        <StandalonePaymentForm onSuccess={() => setShowNew(false)} branchId={branchId} />
      </Modal>
    </Layout>
  );
}
