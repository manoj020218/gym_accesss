import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Input, Select } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { membershipApi } from '../../api/memberships';
import { useAuthStore } from '../../store/auth';
import { toast } from '../../store/toast';
import { fmtCurrency } from '../../utils/format';
import { format } from 'date-fns';

const PAYMENT_MODES = [
  { value: 'cash',   label: 'Cash' },
  { value: 'upi',    label: 'UPI' },
  { value: 'card',   label: 'Card' },
  { value: 'online', label: 'Online Transfer' },
];

interface Props {
  memberId: string;
  onSuccess: () => void;
}

export default function MembershipForm({ memberId, onSuccess }: Props) {
  const { selectedBranchId } = useAuthStore();
  const branchId = selectedBranchId ?? '';

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
    mutationFn: () =>
      membershipApi.create({
        memberId,
        branchId,
        planId:      form.planId,
        startDate:   new Date(form.startDate).toISOString(),
        paymentMode: form.paymentMode,
        amountPaid:  form.amountPaid,
        discount:    form.discount,
      }),
    onSuccess: () => {
      toast.success('Membership created');
      onSuccess();
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
      <Select
        label="Plan"
        options={planOptions}
        value={form.planId}
        onChange={(e) => {
          const plan = plans.find((p) => p._id === e.target.value);
          setForm((f) => ({ ...f, planId: e.target.value, amountPaid: plan?.price ?? 0 }));
        }}
      />

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
