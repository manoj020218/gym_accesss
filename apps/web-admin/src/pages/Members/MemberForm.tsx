import React, { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { memberApi } from '../../api/members';
import { accessApi } from '../../api/access';
import { useAuthStore } from '../../store/auth';
import { toast } from '../../store/toast';

interface Props {
  onSuccess: () => void;
  initial?: Partial<{ firstName: string; lastName: string; phone: string; email: string; branchId: string }>;
  memberId?: string;
}

interface LinkedEmployee {
  deviceCode:    string;
  machineUserId: string;
  name:          string;
  id_number?:    string;
}

export default function MemberForm({ onSuccess, initial, memberId }: Props) {
  const { selectedBranchId } = useAuthStore();
  const [form, setForm] = useState({
    firstName:  initial?.firstName ?? '',
    lastName:   initial?.lastName  ?? '',
    phone:      initial?.phone     ?? '',
    email:      initial?.email     ?? '',
    branchId:   initial?.branchId  ?? selectedBranchId ?? '',
    memberCode: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Machine link state (create mode only)
  const [showLinkPanel, setShowLinkPanel]       = useState(false);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [fetchTriggered, setFetchTriggered]     = useState(false);
  const [linkedEmployee, setLinkedEmployee]     = useState<LinkedEmployee | null>(null);

  // Devices with a known IP (can reach the machine)
  const { data: devices = [] } = useQuery({
    queryKey: ['access-devices', form.branchId],
    queryFn:  () => accessApi.devices(form.branchId || undefined),
    enabled:  showLinkPanel && !!form.branchId,
    staleTime: 60_000,
  });
  const u5Devices = devices.filter(d => d.ipAddress);
  const activeDeviceId = selectedDeviceId || u5Devices[0]?.deviceId || '';

  // Employee list — fetched on demand
  const { data: empData, isFetching: empFetching, refetch: refetchEmps } = useQuery({
    queryKey: ['u5-employees', activeDeviceId],
    queryFn:  () => accessApi.u5Employees(activeDeviceId),
    enabled:  false, // manual trigger only
    staleTime: 0,
  });
  const employees = empData?.employees ?? [];

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        ...form,
        ...(linkedEmployee ? { machineUser: { deviceCode: linkedEmployee.deviceCode, machineUserId: linkedEmployee.machineUserId } } : {}),
      };
      return memberId
        ? memberApi.update(memberId, form)
        : memberApi.create(payload);
    },
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

  const handleFetch = () => {
    setFetchTriggered(true);
    void refetchEmps();
  };

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
        <>
          <Input label="Branch ID" value={form.branchId} onChange={set('branchId')} error={errors['branchId']} />
          <Input
            label="Member ID (optional)"
            value={form.memberCode}
            onChange={set('memberCode')}
            placeholder="Leave blank to auto-generate (0001, 0002…)"
            className="font-mono"
          />
          {!form.memberCode && (
            <p className="text-[11px] text-muted -mt-2 px-0.5">
              Auto ID is sequential per branch. Type your own ID if the gym uses a custom numbering system.
            </p>
          )}

          {/* ── Link existing machine employee ── */}
          <div className="border border-white/[0.08] rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => setShowLinkPanel(p => !p)}
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-white/[0.03] transition-colors"
            >
              <div className="flex items-center gap-2">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4 text-purple-400">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
                </svg>
                <span className="text-sm font-medium text-slate-300">Link existing machine employee</span>
                <span className="text-[11px] text-muted px-1.5 py-0.5 bg-white/[0.04] rounded">optional</span>
                {linkedEmployee && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/25 text-emerald-400 font-semibold">
                    {linkedEmployee.name}
                  </span>
                )}
              </div>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`w-4 h-4 text-slate-500 transition-transform ${showLinkPanel ? 'rotate-180' : ''}`}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
              </svg>
            </button>

            {showLinkPanel && (
              <div className="px-4 pb-4 border-t border-white/[0.06] pt-3 flex flex-col gap-3">
                <p className="text-[11px] text-muted">
                  If this person was already added directly on the machine, select them here to link their face data — no re-enrollment needed.
                </p>

                {/* Device + fetch row */}
                <div className="flex items-center gap-2">
                  {u5Devices.length > 1 ? (
                    <select
                      value={activeDeviceId}
                      onChange={e => { setSelectedDeviceId(e.target.value); setFetchTriggered(false); }}
                      className="flex-1 text-sm bg-white/[0.05] border border-white/[0.10] rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:ring-1 focus:ring-purple-500"
                    >
                      {u5Devices.map(d => (
                        <option key={d.deviceId} value={d.deviceId}>{d.name}</option>
                      ))}
                    </select>
                  ) : u5Devices.length === 1 ? (
                    <span className="flex-1 text-sm text-slate-400 px-1">{u5Devices[0]!.name}</span>
                  ) : (
                    <span className="flex-1 text-xs text-amber-400">No device with IP configured for this branch</span>
                  )}

                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!activeDeviceId || empFetching}
                    onClick={handleFetch}
                  >
                    {empFetching ? 'Fetching…' : 'Fetch from Machine'}
                  </Button>
                </div>

                {/* Employee list */}
                {fetchTriggered && employees.length === 0 && !empFetching && (
                  <p className="text-xs text-muted text-center py-2">No employees found on machine</p>
                )}

                {employees.length > 0 && (
                  <div className="flex flex-col gap-1 max-h-52 overflow-y-auto pr-1">
                    {employees.map(emp => {
                      const isSelected = linkedEmployee?.machineUserId === emp.u5UserId;
                      return (
                        <button
                          key={emp.u5UserId}
                          type="button"
                          onClick={() => setLinkedEmployee(
                            isSelected ? null : { deviceCode: activeDeviceId, machineUserId: emp.u5UserId, name: emp.name, id_number: emp.id_number }
                          )}
                          className={`flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors border ${
                            isSelected
                              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                              : 'bg-white/[0.02] border-white/[0.06] text-slate-300 hover:bg-white/[0.05]'
                          }`}
                        >
                          {/* Radio dot */}
                          <span className={`w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 ${isSelected ? 'border-emerald-400 bg-emerald-400' : 'border-slate-600'}`} />
                          <span className="flex-1 text-sm font-medium truncate">{emp.name}</span>
                          <span className="text-[11px] text-slate-500 font-mono shrink-0">
                            {emp.id_number ? `MID: ${emp.id_number}` : `UID: ${emp.u5UserId}`}
                          </span>
                          {emp.id_number && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-400 shrink-0">
                              linked
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Selected summary */}
                {linkedEmployee && (
                  <div className="flex items-center gap-2 p-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 text-emerald-400 shrink-0">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p className="text-xs text-emerald-300 flex-1">
                      Will link <strong>{linkedEmployee.name}</strong> (machine ID: {linkedEmployee.machineUserId}) — face already enrolled, no re-enrollment needed.
                    </p>
                    <button type="button" onClick={() => setLinkedEmployee(null)} className="text-emerald-600 hover:text-emerald-400 text-xs">×</button>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      <div className="flex gap-3 justify-end pt-2">
        <Button type="submit" loading={mutation.isPending}>
          {memberId ? 'Save Changes' : 'Create Member'}
        </Button>
      </div>
    </form>
  );
}
