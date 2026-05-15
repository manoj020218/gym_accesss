import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Input, Select } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { staffApi } from '../../api/staff';
import { branchApi } from '../../api/branches';
import { useAuthStore } from '../../store/auth';
import { toast } from '../../store/toast';

function toBase64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = () => res(reader.result as string);
    reader.onerror = rej;
    reader.readAsDataURL(file);
  });
}

const STD_ROLES = [
  { value: 'manager',      label: 'Manager' },
  { value: 'trainer',      label: 'Trainer' },
  { value: 'receptionist', label: 'Receptionist' },
  { value: 'cleaner',      label: 'Cleaner' },
  { value: 'security',     label: 'Security' },
  { value: '__custom__',   label: '+ Custom Role…' },
];

const ALL_PERMISSIONS: { key: string; label: string; description: string }[] = [
  { key: 'manage_plans',   label: 'Manage Plans',   description: 'Create and deactivate membership plans' },
  { key: 'manage_billing', label: 'Manage Billing', description: 'Process payments and issue memberships' },
  { key: 'view_reports',   label: 'View Reports',   description: 'Access reports and analytics' },
];

type FormState = {
  firstName: string; lastName: string; phone: string; email: string;
  role: string; branchId: string; rfidCardId: string;
  shiftStart: string; shiftEnd: string;
};

const RULES: Partial<Record<keyof FormState, (v: string) => string | null>> = {
  firstName:  v => v.trim() ? null : 'First name is required',
  phone:      v => v.trim().length >= 10 ? null : 'Phone must be at least 10 digits',
  branchId:   v => v ? null : 'Branch is required',
  shiftStart: v => !v || /^\d{2}:\d{2}(:\d{2})?$/.test(v) ? null : 'Use HH:MM format (e.g. 08:00)',
  shiftEnd:   v => !v || /^\d{2}:\d{2}(:\d{2})?$/.test(v) ? null : 'Use HH:MM format (e.g. 20:00)',
};

function validate(form: FormState): Partial<Record<keyof FormState, string>> {
  const errs: Partial<Record<keyof FormState, string>> = {};
  for (const [k, fn] of Object.entries(RULES) as [keyof FormState, (v: string) => string | null][]) {
    const msg = fn(form[k]);
    if (msg) errs[k] = msg;
  }
  return errs;
}

interface StaffMemberWithUserId {
  _id: string; firstName: string; lastName: string; phone: string; email?: string;
  role: string; branchId: string; rfidCardId?: string; userId?: string;
  permissions?: string[]; shiftStart?: string; shiftEnd?: string; faceEnrolled?: boolean;
}

interface Props { staffId?: string; onSuccess: () => void; }

export default function StaffForm({ staffId, onSuccess }: Props) {
  const qc = useQueryClient();
  const { selectedBranchId, user: currentUser } = useAuthStore();
  const isOwner = currentUser?.role === 'owner';
  const faceFileRef = useRef<HTMLInputElement>(null);
  const [facePreview, setFacePreview] = useState<string | null>(null);
  const [faceEnrolled, setFaceEnrolled] = useState(false);
  const [enrolling, setEnrolling] = useState(false);

  const [form, setForm] = useState<FormState>({
    firstName: '', lastName: '', phone: '', email: '',
    role: 'trainer', branchId: selectedBranchId ?? '',
    rfidCardId: '', shiftStart: '', shiftEnd: '',
  });
  const [customRoleName, setCustomRoleName] = useState('');
  const [touched, setTouched]     = useState<Partial<Record<keyof FormState, boolean>>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [userId, setUserId]           = useState<string | null>(null);

  const isCustomRole = form.role === '__custom__';
  const effectiveRole = isCustomRole ? customRoleName.trim() : form.role;

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn:  () => branchApi.list(),
    enabled:  !!form.branchId,
  });
  const activeBranch = branches.find(b => b._id === form.branchId);
  const existingCustomRoles = activeBranch?.customStaffRoles ?? [];

  const { data: existing } = useQuery({
    queryKey: ['staff-item', staffId],
    queryFn:  () => staffApi.get(staffId!) as Promise<StaffMemberWithUserId>,
    enabled:  !!staffId,
  });

  useEffect(() => {
    if (!existing) return;
    const isStdRole = STD_ROLES.some(r => r.value === existing.role && r.value !== '__custom__');
    setForm({
      firstName:  existing.firstName,
      lastName:   existing.lastName,
      phone:      existing.phone,
      email:      existing.email ?? '',
      role:       isStdRole ? existing.role : '__custom__',
      branchId:   existing.branchId,
      rfidCardId: existing.rfidCardId ?? '',
      shiftStart: existing.shiftStart ?? '',
      shiftEnd:   existing.shiftEnd   ?? '',
    });
    if (!isStdRole) setCustomRoleName(existing.role);
    setUserId(existing.userId ?? null);
    setPermissions(existing.permissions ?? []);
    setFaceEnrolled(existing.faceEnrolled ?? false);
  }, [existing]);

  const allErrors = validate(form);
  const shownErrors = Object.fromEntries(
    Object.entries(allErrors).filter(([k]) => submitAttempted || touched[k as keyof FormState]),
  ) as Partial<Record<keyof FormState, string>>;

  const customRoleError = isCustomRole && submitAttempted && !customRoleName.trim()
    ? 'Role name is required'
    : undefined;

  const hasErrors = Object.keys(allErrors).length > 0 || (isCustomRole && !customRoleName.trim());

  const mut = useMutation({
    mutationFn: () =>
      staffId
        ? staffApi.update(staffId, { ...form, role: effectiveRole })
        : staffApi.create({ ...form, role: effectiveRole }),
    onSuccess: async (data) => {
      if (isCustomRole && customRoleName.trim() && activeBranch) {
        const existing = activeBranch.customStaffRoles ?? [];
        if (!existing.includes(customRoleName.trim())) {
          await branchApi.update(activeBranch._id, {
            customStaffRoles: [...existing, customRoleName.trim()],
          });
          void qc.invalidateQueries({ queryKey: ['branches'] });
        }
      }

      // Auto-enroll face when creating a new staff member with a photo
      const resolvedId = staffId ?? (data as { _id: string })._id;
      if (!staffId && facePreview && resolvedId) {
        setEnrolling(true);
        try {
          await staffApi.enrollFace(resolvedId, facePreview);
          toast.success('Staff member added with face enrolled on machine');
          setFaceEnrolled(true);
        } catch (err: unknown) {
          const hint = (err as { response?: { data?: { hint?: string } } })?.response?.data?.hint;
          toast.success('Staff member added');
          toast.error(hint ?? 'Face enrollment failed — re-enroll from Edit');
        } finally {
          setEnrolling(false);
        }
      } else {
        toast.success(staffId ? 'Staff updated' : 'Staff member added');
      }
      onSuccess();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? 'Could not save staff member');
    },
  });

  const permMut = useMutation({
    mutationFn: () => staffApi.updatePermissions(userId!, permissions),
    onSuccess: () => toast.success('Permissions updated'),
  });

  const enrollFaceMut = useMutation({
    mutationFn: () => staffApi.enrollFace(staffId!, facePreview!),
    onSuccess: () => {
      toast.success('Face enrolled on machine');
      setFaceEnrolled(true);
      void qc.invalidateQueries({ queryKey: ['staff-item', staffId] });
    },
    onError: (err: unknown) => {
      const hint = (err as { response?: { data?: { hint?: string } } })?.response?.data?.hint;
      toast.error(hint ?? 'Face enrollment failed');
    },
  });

  const handleFacePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const b64 = await toBase64(file);
    setFacePreview(b64);
    if (faceFileRef.current) faceFileRef.current.value = '';
  };

  const touch = (k: keyof FormState) => () =>
    setTouched(t => ({ ...t, [k]: true }));

  const set = (k: keyof FormState) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setForm(f => ({ ...f, [k]: e.target.value }));
      setTouched(t => ({ ...t, [k]: true }));
    };

  const clearField = (k: keyof FormState) => () =>
    setForm(f => ({ ...f, [k]: '' }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitAttempted(true);
    // Mark all required fields as touched so errors show immediately
    setTouched({ firstName: true, phone: true, branchId: true, shiftStart: true, shiftEnd: true });
    if (hasErrors) return;
    mut.mutate();
  };

  const togglePerm = (key: string) =>
    setPermissions(prev => prev.includes(key) ? prev.filter(p => p !== key) : [...prev, key]);

  const roleOptions = [
    ...STD_ROLES.filter(r => r.value !== '__custom__'),
    ...existingCustomRoles.map(r => ({ value: r, label: r })),
    { value: '__custom__', label: '+ Custom Role…' },
  ];

  return (
    <div className="flex flex-col gap-5">
      {/* Error alert banner — shown after first submit attempt */}
      {submitAttempted && hasErrors && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 flex gap-3 items-start">
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-red-400 mt-0.5 shrink-0">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd"/>
          </svg>
          <div>
            <p className="text-sm font-semibold text-red-400 mb-1">Please fix the following before saving:</p>
            <ul className="text-xs text-red-300 list-disc list-inside space-y-0.5">
              {Object.values(allErrors).map((msg, i) => <li key={i}>{msg}</li>)}
              {customRoleError && <li>{customRoleError}</li>}
            </ul>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="First Name *"
            value={form.firstName}
            onChange={set('firstName')}
            onBlur={touch('firstName')}
            error={shownErrors.firstName}
            success={!allErrors.firstName && !!touched.firstName && !!form.firstName}
            autoFocus
          />
          <Input
            label="Last Name"
            value={form.lastName}
            onChange={set('lastName')}
            onBlur={touch('lastName')}
            success={!!touched.lastName && !!form.lastName}
          />
        </div>

        <Input
          label="Phone *"
          value={form.phone}
          onChange={set('phone')}
          onBlur={touch('phone')}
          error={shownErrors.phone}
          success={!allErrors.phone && !!touched.phone && !!form.phone}
          type="tel"
          placeholder="10-digit mobile number"
        />

        <Input
          label="Email (optional)"
          value={form.email}
          onChange={set('email')}
          onBlur={touch('email')}
          success={!!touched.email && !!form.email}
          type="email"
        />

        {/* Role */}
        <Select
          label="Role *"
          options={roleOptions}
          value={form.role}
          error={submitAttempted && !form.role ? 'Role is required' : undefined}
          success={!!form.role && form.role !== '__custom__'}
          onChange={(e) => {
            setForm(f => ({ ...f, role: e.target.value }));
            setTouched(t => ({ ...t }));
          }}
        />

        {isCustomRole && (
          <div className="flex flex-col gap-2 pl-3 border-l-2 border-purple-500/30">
            <Input
              label="Custom Role Name"
              value={customRoleName}
              onChange={(e) => setCustomRoleName(e.target.value)}
              error={customRoleError}
              success={!customRoleError && !!customRoleName.trim()}
              placeholder="e.g. Yoga Instructor, Zumba Coach…"
              autoFocus
            />
            {existingCustomRoles.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                <span className="text-[10px] text-muted self-center">Quick pick:</span>
                {existingCustomRoles.map(r => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setCustomRoleName(r)}
                    className={`text-[11px] px-2.5 py-0.5 rounded-full border transition-colors ${
                      customRoleName === r
                        ? 'bg-purple-600 border-purple-500 text-white'
                        : 'border-white/[0.1] text-slate-400 hover:text-slate-200 hover:border-white/[0.2]'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            )}
            <p className="text-[11px] text-muted">
              This role will be saved to the branch for future reuse.
            </p>
          </div>
        )}

        {/* Shift hours — text inputs so they can be left blank */}
        <div>
          <p className="text-xs font-semibold text-slate-400 mb-1.5">
            Shift Hours
            <span className="font-normal text-muted ml-1.5">(optional — leave blank if not fixed)</span>
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <Input
                label="Start"
                type="time"
                value={form.shiftStart}
                onChange={set('shiftStart')}
                onBlur={touch('shiftStart')}
                error={shownErrors.shiftStart}
                success={!allErrors.shiftStart && !!touched.shiftStart && !!form.shiftStart}
                style={{ colorScheme: 'dark' }}
              />
              {form.shiftStart && (
                <button type="button" onClick={clearField('shiftStart')} className="text-[10px] text-muted hover:text-slate-300 text-left pl-1">
                  Clear
                </button>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <Input
                label="End"
                type="time"
                value={form.shiftEnd}
                onChange={set('shiftEnd')}
                onBlur={touch('shiftEnd')}
                error={shownErrors.shiftEnd}
                success={!allErrors.shiftEnd && !!touched.shiftEnd && !!form.shiftEnd}
                style={{ colorScheme: 'dark' }}
              />
              {form.shiftEnd && (
                <button type="button" onClick={clearField('shiftEnd')} className="text-[10px] text-muted hover:text-slate-300 text-left pl-1">
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>

        <Input
          label="RFID Card ID (optional)"
          value={form.rfidCardId}
          onChange={set('rfidCardId')}
          onBlur={touch('rfidCardId')}
          success={!!touched.rfidCardId && !!form.rfidCardId}
        />

        {/* Face photo — inside form, above Save button */}
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3.5">
          <div className="flex items-center justify-between mb-2.5">
            <p className="text-xs font-semibold text-slate-400">
              Face Photo
              <span className="font-normal text-muted ml-1.5">(optional — for U5 attendance)</span>
            </p>
            {faceEnrolled && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/25 text-emerald-400 font-semibold">
                Enrolled
              </span>
            )}
          </div>

          {facePreview ? (
            <div className="flex items-start gap-4">
              <img src={facePreview} alt="Face preview" className="w-20 h-20 object-cover rounded-xl border border-white/[0.1] flex-shrink-0" />
              <div className="flex flex-col gap-2 pt-1">
                {staffId ? (
                  <Button
                    size="sm"
                    loading={enrollFaceMut.isPending}
                    onClick={() => enrollFaceMut.mutate()}
                    type="button"
                  >
                    Enroll on Machine
                  </Button>
                ) : (
                  <p className="text-[11px] text-emerald-400 leading-relaxed">
                    Photo will be enrolled on U5 automatically when you save.
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => setFacePreview(null)}
                  className="text-xs text-muted hover:text-slate-300"
                >
                  Remove photo
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => faceFileRef.current?.click()}
              className="w-full flex items-center gap-3 px-4 py-2.5 bg-white/[0.02] border border-dashed border-white/[0.1] rounded-xl text-muted hover:border-purple-500/40 hover:text-slate-300 transition-colors"
            >
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
              <span className="text-sm">
                {faceEnrolled ? 'Upload new photo to re-enroll' : 'Upload face photo'}
              </span>
            </button>
          )}

          <input
            ref={faceFileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFacePick}
          />
        </div>

        <div className="flex gap-3 justify-end pt-1">
          <Button type="submit" loading={mut.isPending || enrolling}>
            {staffId ? 'Save Changes' : (facePreview ? 'Add Staff & Enroll Face' : 'Add Staff Member')}
          </Button>
        </div>
      </form>

      {/* Portal permissions — owner only, existing staff with a login account */}
      {isOwner && staffId && userId && (
        <div className="border-t border-white/[0.06] pt-4">
          <p className="text-xs font-semibold tracking-widest text-dimmed mb-3">PORTAL PERMISSIONS</p>
          <div className="space-y-2">
            {ALL_PERMISSIONS.map(({ key, label, description }) => (
              <label
                key={key}
                className="flex items-start gap-3 p-3 bg-white/[0.03] border border-white/[0.06] rounded-xl cursor-pointer hover:border-purple-500/30 transition-colors"
              >
                <input type="checkbox" checked={permissions.includes(key)} onChange={() => togglePerm(key)} className="mt-0.5 accent-purple-500" />
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
          This staff member has no portal login — permissions cannot be assigned.
        </p>
      )}
    </div>
  );
}
