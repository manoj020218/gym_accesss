import React, { useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Layout } from '../../components/layout/Layout';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Modal, ConfirmModal } from '../../components/ui/Modal';
import { PageSpinner } from '../../components/ui/Spinner';
import { Input } from '../../components/ui/Input';
import { memberApi } from '../../api/members';
import { membershipApi } from '../../api/memberships';
import { paymentApi } from '../../api/payments';
import { accessApi } from '../../api/access';
import { toast } from '../../store/toast';
import { fmtDate, fmtDatetime, fmtCurrency, initials, avatarColor } from '../../utils/format';
import MemberForm from './MemberForm';
import MembershipForm from '../Billing/MembershipForm';
import AddDeviceWizard from './AddDeviceWizard';

export default function MemberDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab]             = useState<'membership'|'payments'|'access'>('membership');
  const [showEdit, setShowEdit]     = useState(false);
  const [showPlan, setShowPlan]     = useState(false);
  const [showBlock, setShowBlock]   = useState(false);
  const [showEnroll, setShowEnroll]       = useState(false);
  const [showAddDevice, setShowAddDevice] = useState(false);
  const [blockReason, setBlockReason]     = useState('');
  const [enrollStep, setEnrollStep]       = useState<'idle'|'scanning'|'success'|'error'>('idle');
  const [enrollResult, setEnrollResult]   = useState<{ memberCode: string; mode?: string; message?: string } | null>(null);
  const [enrollMode, setEnrollMode]       = useState<'choose'|'upload'|'capture'>('choose');
  const [uploadImage, setUploadImage]     = useState<{ base64: string; previewUrl: string } | null>(null);
  const [enrollErrorMsg, setEnrollErrorMsg] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: member, isLoading } = useQuery({
    queryKey: ['member', id],
    queryFn:  () => memberApi.get(id!),
    enabled:  !!id,
  });

  const { data: memberships } = useQuery({
    queryKey: ['memberships', id],
    queryFn:  () => membershipApi.listForMember(id!),
    enabled:  !!id && tab === 'membership',
  });

  const { data: payments } = useQuery({
    queryKey: ['payments-member', id],
    queryFn:  () => paymentApi.list({ memberId: id, limit: 20 }),
    enabled:  !!id && tab === 'payments',
  });

  const { data: events } = useQuery({
    queryKey: ['events-member', id],
    queryFn:  () => accessApi.events({ memberId: id, limit: 30 }),
    enabled:  !!id && tab === 'access',
    refetchInterval: tab === 'access' ? 8000 : false,
  });

  const { data: devices = [], isLoading: devicesLoading, refetch: refetchDevices } = useQuery({
    queryKey: ['access-devices', member?.branchId],
    queryFn:  () => accessApi.devices(member?.branchId),
    enabled:  (showEnroll || tab === 'access') && !!member?.branchId,
    refetchInterval: showEnroll ? 8000 : false,
  });
  const deviceOnline  = devices.some((d) => d.isOnline);
  const offlineDevice = devices.find((d) => !d.isOnline);

  const firstDevice = devices[0];
  const { data: u5Sync } = useQuery({
    queryKey: ['u5-employees', firstDevice?.deviceId],
    queryFn:  () => accessApi.u5Employees(firstDevice!.deviceId),
    enabled:  tab === 'access' && !!firstDevice?.deviceId && !!member?.faceEnrolled,
    staleTime: 60_000,
  });
  const u5HasMember = u5Sync?.employees.some(
    (e) => e.id_number === member?.memberCode,
  );

  const [pingIp, setPingIp]       = useState('');
  const [pingError, setPingError] = useState('');

  const pingMut = useMutation({
    mutationFn: () => {
      const ip = pingIp.trim() || offlineDevice?.ipAddress || '';
      if (!ip) throw new Error('Enter the machine IP address');
      return accessApi.ping(offlineDevice!.deviceId, ip);
    },
    onSuccess: () => {
      setPingError('');
      void refetchDevices();
    },
    onError: (err: unknown) => {
      const hint = (err as { response?: { data?: { hint?: string; error?: string } } })
        ?.response?.data?.hint
        ?? (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        ?? 'Could not reach the device at that IP.';
      setPingError(hint);
    },
  });

  const blockMut = useMutation({
    mutationFn: () => memberApi.block(id!, blockReason),
    onSuccess: () => {
      toast.success('Member blocked');
      setShowBlock(false);
      void qc.invalidateQueries({ queryKey: ['member', id] });
    },
  });

  const unblockMut = useMutation({
    mutationFn: () => memberApi.unblock(id!),
    onSuccess: () => {
      toast.success('Member unblocked');
      void qc.invalidateQueries({ queryKey: ['member', id] });
    },
  });

  const qrMut = useMutation({
    mutationFn: () => memberApi.regenerateQr(id!),
    onSuccess: () => {
      toast.success('QR token regenerated');
      void qc.invalidateQueries({ queryKey: ['member', id] });
    },
  });

  const enrollMut = useMutation({
    mutationFn: () =>
      memberApi.enrollFace(id!, enrollMode === 'upload' && uploadImage
        ? { imageBase64: uploadImage.base64, mode: 'upload' }
        : { mode: 'capture' }),
    onSuccess: (data) => {
      setEnrollResult({ memberCode: data.memberCode, mode: data.mode, message: data.message });
      setEnrollStep('success');
      void qc.invalidateQueries({ queryKey: ['member', id] });
    },
    onError: (err: unknown) => {
      const hint = (err as { response?: { data?: { hint?: string } } })?.response?.data?.hint
        ?? (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        ?? 'Could not reach the edge device or enrollment was rejected.';
      setEnrollErrorMsg(hint);
      setEnrollStep('error');
    },
  });

  const handleStartEnroll = () => {
    setEnrollStep('scanning');
    enrollMut.mutate();
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const previewUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const MAX = 640;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width  = Math.round(img.width  * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
      setUploadImage({ base64: dataUrl.split(',')[1] ?? '', previewUrl });
    };
    img.src = previewUrl;
  };

  const handleCloseEnroll = () => {
    setShowEnroll(false);
    setEnrollStep('idle');
    setEnrollResult(null);
    setEnrollMode('choose');
    setUploadImage(null);
    setEnrollErrorMsg('');
  };

  if (isLoading) return <Layout title="Member"><PageSpinner /></Layout>;
  if (!member)  return <Layout title="Member"><p className="text-muted text-sm p-6">Member not found.</p></Layout>;

  const name = `${member.firstName} ${member.lastName}`;
  const tabs = [
    { id: 'membership', label: 'Memberships' },
    { id: 'payments',   label: 'Payments' },
    { id: 'access',     label: 'Access Log' },
  ] as const;

  return (
    <Layout
      title={name}
      actions={
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate(-1)}>← Back</Button>
          <Button variant="outline" size="sm" onClick={() => setShowEdit(true)}>Edit</Button>
          {member.status === 'blocked' ? (
            <Button variant="outline" size="sm" loading={unblockMut.isPending} onClick={() => unblockMut.mutate()}>
              Unblock
            </Button>
          ) : (
            <Button variant="danger" size="sm" onClick={() => setShowBlock(true)}>Block</Button>
          )}
        </div>
      }
    >
      <div className="grid grid-cols-3 gap-4 mb-5">
        {/* Profile card */}
        <Card className="col-span-1 p-5">
          <div className="flex flex-col items-center text-center mb-5">
            <div
              className={`w-16 h-16 rounded-2xl flex items-center justify-center text-xl font-bold text-white mb-3 bg-gradient-to-br ${avatarColor(member.firstName)}`}
            >
              {initials(name)}
            </div>
            <h2 className="text-base font-bold text-slate-100">{name}</h2>
            <p className="text-xs text-muted font-mono mt-0.5">{member.memberCode}</p>
            <div className="mt-2">
              <Badge variant={member.status as Parameters<typeof Badge>[0]['variant']}>{member.status}</Badge>
            </div>
          </div>
          <div className="space-y-2.5 text-sm">
            {[
              { label: 'Phone', value: member.phone },
              { label: 'Email', value: member.email ?? '—' },
              { label: 'Branch', value: member.branchId },
              { label: 'Member since', value: fmtDate(member.createdAt) },
              { label: 'RFID', value: member.rfidCardId ?? 'Not assigned' },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between">
                <span className="text-muted text-xs">{label}</span>
                <span className="text-slate-300 text-xs font-medium">{value}</span>
              </div>
            ))}
            {/* Face / Access status */}
            <div className="flex justify-between items-center pt-1">
              <span className="text-muted text-xs">Access</span>
              {member.faceEnrolled ? (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Access Active
                </span>
              ) : (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-500/10 text-slate-500 border border-slate-600/20">
                  Not Enrolled
                </span>
              )}
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-2">
            <Button size="sm" onClick={() => setShowPlan(true)} className="w-full justify-center">
              + New Membership
            </Button>
            <Button variant="outline" size="sm" loading={qrMut.isPending} onClick={() => qrMut.mutate()} className="w-full justify-center">
              Regenerate QR
            </Button>
          </div>
        </Card>

        {/* Tabs */}
        <Card className="col-span-2">
          <div className="flex border-b border-white/[0.06] px-5">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`py-3.5 px-3 text-sm font-semibold border-b-2 transition-colors mr-1 ${
                  tab === t.id
                    ? 'border-purple-500 text-purple-400'
                    : 'border-transparent text-muted hover:text-slate-300'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="p-5">
            {tab === 'access' && (
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-[11px] text-muted">Live · refreshes every 8s</span>
                  {/* U5 sync warning */}
                  {member.faceEnrolled && u5Sync && !u5HasMember && (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-900/30 text-amber-400 border border-amber-500/20">
                      ⚠ Not found on machine — re-enroll
                    </span>
                  )}
                  {member.faceEnrolled && u5HasMember && (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-900/20 text-emerald-400 border border-emerald-500/20">
                      ✓ Confirmed on machine
                    </span>
                  )}
                </div>
                <button
                  onClick={() => { setShowEnroll(true); setEnrollStep('idle'); }}
                  title="Enroll Face on Device"
                  className="w-10 h-10 rounded-full bg-purple-600 hover:bg-purple-500 flex items-center justify-center text-white shadow-lg transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                    <circle cx="12" cy="13" r="4"/>
                  </svg>
                </button>
              </div>
            )}
            {tab === 'membership' && (
              <div className="space-y-3">
                {memberships?.map((ms) => (
                  <div key={ms._id} className="flex items-center justify-between p-3 bg-white/[0.03] rounded-xl border border-white/[0.06]">
                    <div>
                      <p className="text-sm font-medium text-slate-200">{ms.planType}</p>
                      <p className="text-xs text-muted">{fmtDate(ms.startDate)} → {fmtDate(ms.endDate)}</p>
                      {ms.freezeDaysUsed > 0 && (
                        <p className="text-xs text-cyan-400">Frozen {ms.freezeDaysUsed} days used</p>
                      )}
                    </div>
                    <div className="text-right">
                      <Badge variant={ms.status as Parameters<typeof Badge>[0]['variant']}>{ms.status}</Badge>
                      <p className="text-[11px] text-muted mt-1">Renewals: {ms.renewalCount}</p>
                    </div>
                  </div>
                ))}
                {!memberships?.length && <p className="text-sm text-muted text-center py-6">No memberships yet</p>}
              </div>
            )}

            {tab === 'payments' && (
              <div className="space-y-2">
                {payments?.data?.map((p) => (
                  <div key={p._id} className="flex items-center justify-between py-2.5 border-b border-white/[0.04] last:border-0">
                    <div>
                      <p className="text-xs font-mono text-slate-400">{p.receiptNo}</p>
                      <p className="text-[11px] text-muted">{fmtDatetime(p.createdAt)} · {p.mode}</p>
                    </div>
                    <p className="text-sm font-semibold text-emerald-400">{fmtCurrency(p.amount)}</p>
                  </div>
                ))}
                {!payments?.data?.length && <p className="text-sm text-muted text-center py-6">No payments yet</p>}
              </div>
            )}

            {tab === 'access' && (
              <div className="space-y-1">
                {events?.data?.map((ev) => (
                  <div key={ev._id} className="flex items-center gap-3 py-2 border-b border-white/[0.04] last:border-0">
                    <Badge variant={ev.decision === 'ALLOW' ? 'allow' : 'deny'}>{ev.decision}</Badge>
                    <div className="flex-1">
                      <p className="text-xs text-slate-300">{ev.zone.replace(/_/g, ' ')} · {ev.identifierUsed}</p>
                      {ev.denyReason && <p className="text-[11px] text-red-400">{ev.denyReason}</p>}
                    </div>
                    <span className="text-[11px] text-slate-600">{fmtDatetime(ev.eventTime)}</span>
                  </div>
                ))}
                {!events?.data?.length && <p className="text-sm text-muted text-center py-6">No access events</p>}
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Modals */}
      <Modal open={showEdit} onClose={() => setShowEdit(false)} title="Edit Member">
        <MemberForm
          memberId={id}
          initial={member}
          onSuccess={() => {
            setShowEdit(false);
            void qc.invalidateQueries({ queryKey: ['member', id] });
          }}
        />
      </Modal>

      <Modal open={showPlan} onClose={() => setShowPlan(false)} title="New Membership" width="max-w-xl">
        <MembershipForm
          memberId={id!}
          onSuccess={() => {
            setShowPlan(false);
            void qc.invalidateQueries({ queryKey: ['memberships', id] });
          }}
        />
      </Modal>

      <Modal open={showBlock} onClose={() => setShowBlock(false)} title="Block Member">
        <Input
          label="Reason"
          value={blockReason}
          onChange={(e) => setBlockReason(e.target.value)}
          placeholder="Reason for blocking…"
          autoFocus
        />
        <div className="flex gap-3 justify-end mt-5">
          <Button variant="outline" onClick={() => setShowBlock(false)}>Cancel</Button>
          <Button variant="danger" loading={blockMut.isPending} onClick={() => blockMut.mutate()}>
            Block Member
          </Button>
        </div>
      </Modal>

      <Modal open={showEnroll} onClose={handleCloseEnroll} title="Face Enrollment">
        <div className="flex flex-col items-center gap-5 py-4">
          {enrollStep === 'idle' && (
            <>
              <div className="w-20 h-20 rounded-full bg-purple-600/20 border-2 border-purple-500/40 flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-9 h-9 text-purple-400">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                  <circle cx="12" cy="13" r="4"/>
                </svg>
              </div>

              {/* ── No device registered yet ── */}
              {!devicesLoading && devices.length === 0 && (
                <>
                  <div className="text-center">
                    <p className="text-sm font-semibold text-slate-200 mb-1">No device registered for this branch</p>
                    <p className="text-xs text-muted">Add an access machine first — it only takes a minute.</p>
                  </div>
                  <div className="flex gap-3">
                    <Button variant="outline" onClick={handleCloseEnroll}>Cancel</Button>
                    <Button onClick={() => { handleCloseEnroll(); setShowAddDevice(true); }}>
                      + Add Machine to Branch
                    </Button>
                  </div>
                </>
              )}

              {/* ── Device registered but offline ── */}
              {!devicesLoading && devices.length > 0 && !deviceOnline && (
                <>
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border border-red-500/40 text-red-300 bg-red-900/20">
                    <span className="w-2 h-2 rounded-full bg-red-500" />
                    Last heartbeat not received
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-semibold text-slate-200 mb-1">Enroll Face for {name}</p>
                    <p className="text-xs text-muted">No recent check-in from the machine. If it's powered on, verify it now:</p>
                  </div>

                  {/* Quick verify by IP */}
                  <div className="w-full space-y-2">
                    <div className="flex gap-2">
                      <input
                        className="flex-1 bg-white/[0.05] border border-white/10 rounded-xl px-3 py-2 text-sm text-slate-200 placeholder:text-muted outline-none focus:border-purple-500/50 font-mono"
                        placeholder={offlineDevice?.ipAddress ?? '192.168.1.201'}
                        value={pingIp}
                        onChange={(e) => { setPingIp(e.target.value); setPingError(''); }}
                      />
                      <Button
                        size="sm"
                        loading={pingMut.isPending}
                        onClick={() => pingMut.mutate()}
                      >
                        Verify
                      </Button>
                    </div>
                    {pingError && (
                      <p className="text-[11px] text-red-400 px-1">{pingError}</p>
                    )}
                    {offlineDevice?.ipAddress && !pingIp && (
                      <p className="text-[11px] text-muted px-1">
                        Last known IP: <span className="font-mono text-slate-400">{offlineDevice.ipAddress}</span> — leave blank to use it
                      </p>
                    )}
                  </div>

                  <div className="flex gap-3">
                    <Button variant="outline" onClick={handleCloseEnroll}>Cancel</Button>
                    <Button disabled>Start Enrollment</Button>
                  </div>
                </>
              )}

              {/* ── Device online, ready ── */}
              {(devicesLoading || deviceOnline) && (
                <>
                  <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border ${
                    devicesLoading
                      ? 'border-slate-600 text-slate-400 bg-slate-800/50'
                      : 'border-emerald-500/40 text-emerald-300 bg-emerald-900/20'
                  }`}>
                    <span className={`w-2 h-2 rounded-full ${devicesLoading ? 'bg-slate-500 animate-pulse' : 'bg-emerald-400 animate-pulse'}`} />
                    {devicesLoading ? 'Checking device…' : 'Device Online'}
                  </div>
                  <p className="text-sm font-semibold text-slate-200">Enroll Face for {name}</p>

                  {/* Choose enrollment method */}
                  {enrollMode === 'choose' && (
                    <>
                      <div className="w-full grid grid-cols-2 gap-3">
                        <button
                          onClick={() => setEnrollMode('upload')}
                          disabled={devicesLoading || !deviceOnline}
                          className="flex flex-col items-center gap-2.5 p-4 rounded-xl border border-white/10 bg-white/[0.03] hover:bg-purple-500/10 hover:border-purple-500/40 transition-all disabled:opacity-40"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-7 h-7 text-purple-400">
                            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/>
                            <line x1="12" y1="3" x2="12" y2="15"/>
                          </svg>
                          <div className="text-center">
                            <p className="text-xs font-semibold text-slate-200">Upload Photo</p>
                            <p className="text-[11px] text-muted mt-0.5">Use a desktop photo</p>
                          </div>
                        </button>
                        <button
                          onClick={() => setEnrollMode('capture')}
                          disabled={devicesLoading || !deviceOnline}
                          className="flex flex-col items-center gap-2.5 p-4 rounded-xl border border-white/10 bg-white/[0.03] hover:bg-emerald-500/10 hover:border-emerald-500/40 transition-all disabled:opacity-40"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-7 h-7 text-emerald-400">
                            <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
                            <circle cx="12" cy="13" r="4"/>
                          </svg>
                          <div className="text-center">
                            <p className="text-xs font-semibold text-slate-200">Capture at Machine</p>
                            <p className="text-[11px] text-muted mt-0.5">Member faces the camera</p>
                          </div>
                        </button>
                      </div>
                      <Button variant="outline" onClick={handleCloseEnroll}>Cancel</Button>
                    </>
                  )}

                  {/* Upload photo flow */}
                  {enrollMode === 'upload' && (
                    <div className="w-full space-y-3">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleFileSelect}
                      />
                      {uploadImage ? (
                        <div className="flex flex-col items-center gap-3">
                          <img
                            src={uploadImage.previewUrl}
                            alt="Face preview"
                            className="w-28 h-28 rounded-2xl object-cover border-2 border-purple-500/40"
                          />
                          <button
                            onClick={() => { setUploadImage(null); fileInputRef.current?.click(); }}
                            className="text-[11px] text-muted hover:text-slate-300 transition-colors"
                          >
                            Change photo
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          className="w-full flex flex-col items-center gap-2 py-6 rounded-xl border-2 border-dashed border-white/10 hover:border-purple-500/40 hover:bg-purple-500/5 transition-all"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-8 h-8 text-muted">
                            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/>
                            <line x1="12" y1="3" x2="12" y2="15"/>
                          </svg>
                          <p className="text-xs text-muted">Click to select a clear face photo</p>
                        </button>
                      )}
                      <div className="flex gap-3">
                        <Button variant="outline" onClick={() => { setEnrollMode('choose'); setUploadImage(null); }}>Back</Button>
                        <Button
                          onClick={handleStartEnroll}
                          disabled={!uploadImage}
                          className="flex-1 justify-center"
                        >
                          Enroll with Photo
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Capture at machine flow — U5 requires a pre-supplied photo */}
                  {enrollMode === 'capture' && (
                    <div className="w-full space-y-3">
                      <div className="p-3 bg-amber-900/20 border border-amber-500/20 rounded-xl text-xs text-amber-300 text-center leading-relaxed">
                        The U5 machine requires a photo to be uploaded — it does not support live capture via the web API.
                        Please go back and use <strong>Upload Photo</strong> instead.
                      </div>
                      <div className="flex gap-3">
                        <Button variant="outline" onClick={() => setEnrollMode('choose')}>Back</Button>
                        <Button variant="outline" onClick={() => setEnrollMode('upload')} className="flex-1 justify-center">
                          Switch to Upload Photo
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {enrollStep === 'scanning' && (
            <>
              <div className="w-20 h-20 rounded-full bg-purple-600/20 border-2 border-purple-500 flex items-center justify-center animate-pulse">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-9 h-9 text-purple-400">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                  <circle cx="12" cy="13" r="4"/>
                </svg>
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-slate-200 mb-1">Camera Active — Please Look at the Device</p>
                <p className="text-xs text-muted">Keep the member's face in frame. The device is capturing biometric data…</p>
              </div>
            </>
          )}

          {enrollStep === 'success' && (
            <>
              <div className="w-20 h-20 rounded-full bg-emerald-600/20 border-2 border-emerald-500/60 flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-9 h-9 text-emerald-400">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-emerald-300 mb-1">
                  {enrollResult?.mode === 'upload' ? 'Face Photo Registered' : 'Enrollment Signal Sent'}
                </p>
                {enrollResult && (
                  <>
                    <p className="text-xs text-muted">{enrollResult.message ?? `Linked to member ID: ${enrollResult.memberCode}`}</p>
                    {enrollResult.mode === 'capture' && (
                      <p className="text-[11px] text-amber-400 mt-2">Ask the member to face the device camera now.</p>
                    )}
                  </>
                )}
              </div>
              <Button onClick={handleCloseEnroll}>Done</Button>
            </>
          )}

          {enrollStep === 'error' && (
            <>
              <div className="w-20 h-20 rounded-full bg-red-600/20 border-2 border-red-500/60 flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-9 h-9 text-red-400">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-red-300 mb-1">Enrollment Failed</p>
                <p className="text-xs text-muted">{enrollErrorMsg || 'Could not reach the edge device or enrollment was rejected.'}</p>
              </div>
              <div className="flex gap-3">
                <Button variant="outline" onClick={handleCloseEnroll}>Close</Button>
                <Button onClick={() => { setEnrollStep('idle'); setEnrollErrorMsg(''); }}>Retry</Button>
              </div>
            </>
          )}
        </div>
      </Modal>
      <AddDeviceWizard
        open={showAddDevice}
        branchId={member.branchId}
        onClose={() => setShowAddDevice(false)}
        onDeviceOnline={() => {
          void qc.invalidateQueries({ queryKey: ['access-devices', member.branchId] });
          setShowEnroll(true);
        }}
      />
    </Layout>
  );
}
