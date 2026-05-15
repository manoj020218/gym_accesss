import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Input, Select } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { membershipApi } from '../../api/memberships';
import { useAuthStore, hasPerm } from '../../store/auth';
import { toast } from '../../store/toast';
import { fmtCurrency } from '../../utils/format';
import { format } from 'date-fns';

const PAYMENT_MODES = [
  { value: 'cash',   label: 'Cash' },
  { value: 'upi',    label: 'UPI' },
  { value: 'card',   label: 'Card' },
  { value: 'online', label: 'Online Transfer' },
];

const PLAN_TYPE_OPTIONS = [
  { value: 'basic',       label: 'Basic' },
  { value: 'premium',     label: 'Premium' },
  { value: 'yearly',      label: 'Yearly' },
  { value: 'quarterly',   label: 'Quarterly' },
  { value: 'pt_package',  label: 'PT Package' },
  { value: 'corporate',   label: 'Corporate' },
  { value: 'family',      label: 'Family' },
  { value: 'trial',       label: 'Trial' },
];

const DURATION_UNIT_OPTIONS = [
  { value: 'day',   label: 'Day(s)' },
  { value: 'month', label: 'Month(s)' },
  { value: 'year',  label: 'Year(s)' },
];

interface Props {
  memberId: string;
  onSuccess: () => void;
}

function CreatePlanInline({ branchId, onCreated }: { branchId: string; onCreated: (plan: { _id: string; name: string }) => void }) {
  const [form, setForm] = useState({
    name: '', planType: 'basic', durationValue: 1,
    durationUnit: 'month', price: 0, gstPercent: 18,
  });
  const qc = useQueryClient();

  const mut = useMutation({
    mutationFn: () => {
      if (!branchId) throw new Error('No branch selected — choose a branch from the header first.');
      return membershipApi.createPlan({ ...form, branchId, allowedZones: ['main_entry'] });
    },
    onSuccess: (plan) => {
      toast.success('Plan created');
      void qc.invalidateQueries({ queryKey: ['plans', branchId] });
      onCreated(plan);
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'Failed to create plan');
    },
  });

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [k]: k === 'durationValue' || k === 'price' || k === 'gstPercent'
        ? Number(e.target.value) : e.target.value }));

  return (
    <div className="mt-2 p-4 bg-white/[0.04] border border-purple-500/20 rounded-xl space-y-3">
      <p className="text-xs font-semibold text-purple-400 tracking-wider">NEW PLAN</p>
      <Input label="Plan Name" value={form.name} onChange={set('name')} autoFocus placeholder="e.g. Monthly Basic" />
      <div className="grid grid-cols-2 gap-3">
        <Select
          label="Plan Type"
          options={PLAN_TYPE_OPTIONS}
          value={form.planType}
          onChange={(e) => setForm((f) => ({ ...f, planType: e.target.value }))}
        />
        <Select
          label="Duration Unit"
          options={DURATION_UNIT_OPTIONS}
          value={form.durationUnit}
          onChange={(e) => setForm((f) => ({ ...f, durationUnit: e.target.value }))}
        />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Input label="Duration" type="number" value={form.durationValue} onChange={set('durationValue')} />
        <Input label="Price (₹)" type="number" value={form.price} onChange={set('price')} />
        <Input label="GST %" type="number" value={form.gstPercent} onChange={set('gstPercent')} />
      </div>
      {!branchId && (
        <p className="text-xs text-amber-400/80">Select a specific branch from the sidebar to save a plan.</p>
      )}
      <div className="flex justify-end">
        <Button size="sm" type="button" loading={mut.isPending} disabled={!branchId} onClick={() => mut.mutate()}>
          Save Plan
        </Button>
      </div>
    </div>
  );
}

export default function MembershipForm({ memberId, onSuccess }: Props) {
  const { selectedBranchId, user } = useAuthStore();
  const branchId = selectedBranchId ?? '';
  const canCreate = hasPerm(user, 'manage_plans');
  const [showCreatePlan, setShowCreatePlan] = useState(false);

  const [form, setForm] = useState({
    planId:      '',
    startDate:   format(new Date(), "yyyy-MM-dd'T'HH:mm"),
    paymentMode: 'cash',
    amountPaid:  0,
    discount:    0,
  });

  const { data: plans = [] } = useQuery({
    queryKey: ['plans', branchId],
    queryFn:  () => membershipApi.plans(branchId),
    enabled:  !!branchId,
  });

  const selectedPlan = plans.find((p) => p._id === form.planId);

  const createMut = useMutation({
    mutationFn: () => {
      if (!branchId) throw new Error('No branch selected — pick a branch from the sidebar first.');
      if (!form.planId) throw new Error('Please select a plan.');
      return membershipApi.create({
        memberId,
        branchId,
        planId:      form.planId,
        startDate:   new Date(form.startDate).toISOString(),
        paymentMode: form.paymentMode,
        amountPaid:  Number(form.amountPaid),
        discount:    Number(form.discount),
      });
    },
    onSuccess: () => {
      toast.success('Membership created');
      onSuccess();
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Failed to create membership';
      toast.error(msg);
    },
  });

  const planOptions = [
    { value: '', label: 'Select a plan…' },
    ...plans.map((p) => ({
      value: p._id,
      label: `${p.name} — ${fmtCurrency(p.price)} / ${p.durationValue} ${p.durationUnit}`,
    })),
  ];

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); createMut.mutate(); }}
      className="flex flex-col gap-4"
    >
      <div>
        <Select
          label="Plan"
          options={planOptions}
          value={form.planId}
          onChange={(e) => {
            const plan = plans.find((p) => p._id === e.target.value);
            setForm((f) => ({ ...f, planId: e.target.value, amountPaid: plan?.price ?? 0 }));
          }}
        />

        {canCreate && (
          <button
            type="button"
            onClick={() => setShowCreatePlan((v) => !v)}
            className="mt-1.5 text-xs text-purple-400 hover:text-purple-300 transition-colors"
          >
            {showCreatePlan ? '− Cancel new plan' : '+ Create new plan'}
          </button>
        )}

        {showCreatePlan && canCreate && (
          <CreatePlanInline
            branchId={branchId}
            onCreated={(plan) => {
              setForm((f) => ({ ...f, planId: plan._id }));
              setShowCreatePlan(false);
            }}
          />
        )}
      </div>

      {selectedPlan && (
        <div className="bg-white/[0.04] border border-white/[0.08] rounded-xl p-3 text-xs text-slate-400 space-y-1">
          <p>Duration: {selectedPlan.durationValue} {selectedPlan.durationUnit}</p>
          <p>Zones: {selectedPlan.allowedZones.join(', ')}</p>
          <p>Price: {fmtCurrency(selectedPlan.price)} + {selectedPlan.gstPercent}% GST</p>
        </div>
      )}

      <Input
        label="Start Date"
        type="datetime-local"
        value={form.startDate}
        onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
      />

      <Select
        label="Payment Mode"
        options={PAYMENT_MODES}
        value={form.paymentMode}
        onChange={(e) => setForm((f) => ({ ...f, paymentMode: e.target.value }))}
      />

      <div className="grid grid-cols-2 gap-4">
        <Input
          label="Amount Paid (₹)"
          type="number"
          value={form.amountPaid}
          onChange={(e) => setForm((f) => ({ ...f, amountPaid: Number(e.target.value) }))}
        />
        <Input
          label="Discount (₹)"
          type="number"
          value={form.discount}
          onChange={(e) => setForm((f) => ({ ...f, discount: Number(e.target.value) }))}
        />
      </div>

      <div className="flex gap-3 justify-end pt-1">
        <Button type="submit" loading={createMut.isPending} disabled={!form.planId}>
          Create Membership
        </Button>
      </div>
    </form>
  );
}
