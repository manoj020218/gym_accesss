import React, { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Input, Select } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { staffApi } from '../../api/staff';
import { useAuthStore } from '../../store/auth';
import { toast } from '../../store/toast';

const ROLE_OPTIONS = [
  { value: 'manager',      label: 'Manager' },
  { value: 'trainer',      label: 'Trainer' },
  { value: 'receptionist', label: 'Receptionist' },
  { value: 'cleaner',      label: 'Cleaner' },
  { value: 'security',     label: 'Security' },
];

const ALL_PERMISSIONS: { key: string; label: string; description: string }[] = [
  { key: 'manage_plans',   label: 'Manage Plans',   description: 'Create and deactivate membership plans' },
  { key: 'manage_billing', label: 'Manage Billing', description: 'Process payments and issue memberships' },
  { key: 'view_reports',   label: 'View Reports',   description: 'Access reports and analytics' },
];

interface StaffMemberWithUserId {
  _id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email?: string;
  role: string;
  branchId: string;
  rfidCardId?: string;
  userId?: string;
  permissions?: string[];
}

interface Props { staffId?: string; onSuccess: () => void; }

export default function StaffForm({ staffId, onSuccess }: Props) {
  const { selectedBranchId, user: currentUser } = useAuthStore();
  const isOwner = currentUser?.role === 'owner';

  const [form, setForm] = useState({
    firstName: '', lastName: '', phone: '', email: '',
    role: 'trainer', branchId: selectedBranchId ?? '', rfidCardId: '',
  });
  const [permissions, setPermissions] = useState<string[]>([]);
  const [userId, setUserId] = useState<string | null>(null);

  const { data: existing } = useQuery({
    queryKey: ['staff-item', staffId],
    queryFn:  () => staffApi.get(staffId!) as Promise<StaffMemberWithUserId>,
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
      setUserId(existing.userId ?? null);
      setPermissions(existing.permissions ?? []);
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

  const permMut = useMutation({
    mutationFn: () => staffApi.updatePermissions(userId!, permissions),
    onSuccess: () => toast.success('Permissions updated'),
  });

  const togglePerm = (key: string) =>
    setPermissions((prev) =>
      prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key],
    );

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="flex flex-col gap-5">
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

      {/* Permissions section — owner only, editing existing staff with a login account */}
      {isOwner && staffId && userId && (
        <div className="border-t border-white/[0.06] pt-4">
          <p className="text-xs font-semibold tracking-widest text-dimmed mb-3">PORTAL PERMISSIONS</p>
          <div className="space-y-2">
            {ALL_PERMISSIONS.map(({ key, label, description }) => (
              <label
                key={key}
                className="flex items-start gap-3 p-3 bg-white/[0.03] border border-white/[0.06] rounded-xl cursor-pointer hover:border-purple-500/30 transition-colors"
              >
                <input
                  type="checkbox"
                  checked={permissions.includes(key)}
                  onChange={() => togglePerm(key)}
                  className="mt-0.5 accent-purple-500"
                />
                <div>
                  <p className="text-sm font-medium text-slate-200">{label}</p>
                  <p className="text-xs text-muted">{description}</p>
                </div>
              </label>
            ))}
          </div>
          <div className="flex justify-end mt-3">
            <Button size="sm" type="button" loading={permMut.isPending} onClick={() => permMut.mutate()}>
              Save Permissions
            </Button>
          </div>
        </div>
      )}

      {isOwner && staffId && !userId && (
        <p className="text-xs text-muted border-t border-white/[0.06] pt-4">
          This staff member has no portal login account — permissions cannot be assigned.
        </p>
      )}
    </div>
  );
}
