import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Input, Select } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { memberApi } from '../../api/members';
import { useAuthStore } from '../../store/auth';
import { toast } from '../../store/toast';

interface Props {
  onSuccess: () => void;
  initial?: Partial<{ firstName: string; lastName: string; phone: string; email: string; branchId: string }>;
  memberId?: string;
}

export default function MemberForm({ onSuccess, initial, memberId }: Props) {
  const { selectedBranchId } = useAuthStore();
  const [form, setForm] = useState({
    firstName: initial?.firstName ?? '',
    lastName:  initial?.lastName  ?? '',
    phone:     initial?.phone     ?? '',
    email:     initial?.email     ?? '',
    branchId:  initial?.branchId  ?? selectedBranchId ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const mutation = useMutation({
    mutationFn: () =>
      memberId
        ? memberApi.update(memberId, form)
        : memberApi.create(form),
    onSuccess: () => {
      toast.success(memberId ? 'Member updated' : 'Member created');
      onSuccess();
    },
  });

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.firstName.trim()) e['firstName'] = 'First name is required';
    if (!form.phone.trim()) e['phone'] = 'Phone is required';
    if (!form.branchId) e['branchId'] = 'Branch is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (validate()) mutation.mutate(); }}
      className="flex flex-col gap-4"
    >
      <div className="grid grid-cols-2 gap-4">
        <Input label="First Name" value={form.firstName} onChange={set('firstName')} error={errors['firstName']} autoFocus />
        <Input label="Last Name" value={form.lastName} onChange={set('lastName')} />
      </div>
      <Input label="Phone" value={form.phone} onChange={set('phone')} error={errors['phone']} type="tel" />
      <Input label="Email (optional)" value={form.email} onChange={set('email')} type="email" />
      {!memberId && (
        <Input label="Branch ID" value={form.branchId} onChange={set('branchId')} error={errors['branchId']} />
      )}

      <div className="flex gap-3 justify-end pt-2">
        <Button type="submit" loading={mutation.isPending}>
          {memberId ? 'Save Changes' : 'Create Member'}
        </Button>
      </div>
    </form>
  );
}
