import React, { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Input, Select } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { staffApi } from '../../api/staff';
import { useAuthStore } from '../../store/auth';
import { toast } from '../../store/toast';

const ROLE_OPTIONS = [
  { value: 'manager',     label: 'Manager' },
  { value: 'trainer',     label: 'Trainer' },
  { value: 'receptionist', label: 'Receptionist' },
  { value: 'cleaner',     label: 'Cleaner' },
  { value: 'security',    label: 'Security' },
];

interface Props { staffId?: string; onSuccess: () => void; }

export default function StaffForm({ staffId, onSuccess }: Props) {
  const { selectedBranchId } = useAuthStore();
  const [form, setForm] = useState({
    firstName: '', lastName: '', phone: '', email: '',
    role: 'trainer', branchId: selectedBranchId ?? '', rfidCardId: '',
  });

  const { data: existing } = useQuery({
    queryKey: ['staff-item', staffId],
    queryFn:  () => staffApi.get(staffId!),
    enabled:  !!staffId,
  });

  useEffect(() => {
    if (existing) {
      setForm({
        firstName:  existing.firstName,
        lastName:   existing.lastName,
        phone:      existing.phone,
        email:      existing.email ?? '',
        role:       existing.role,
        branchId:   existing.branchId,
        rfidCardId: existing.rfidCardId ?? '',
      });
    }
  }, [existing]);

  const mut = useMutation({
    mutationFn: () =>
      staffId
        ? staffApi.update(staffId, form)
        : staffApi.create(form),
    onSuccess: () => {
      toast.success(staffId ? 'Staff updated' : 'Staff member added');
      onSuccess();
    },
  });

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <form onSubmit={(e) => { e.preventDefault(); mut.mutate(); }} className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4">
        <Input label="First Name" value={form.firstName} onChange={set('firstName')} autoFocus />
        <Input label="Last Name"  value={form.lastName}  onChange={set('lastName')} />
      </div>
      <Input label="Phone" value={form.phone} onChange={set('phone')} type="tel" />
      <Input label="Email" value={form.email} onChange={set('email')} type="email" />
      <Select
        label="Role"
        options={ROLE_OPTIONS}
        value={form.role}
        onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
      />
      <Input label="RFID Card ID (optional)" value={form.rfidCardId} onChange={set('rfidCardId')} />

      <div className="flex gap-3 justify-end pt-1">
        <Button type="submit" loading={mut.isPending}>
          {staffId ? 'Save Changes' : 'Add Staff Member'}
        </Button>
      </div>
    </form>
  );
}
