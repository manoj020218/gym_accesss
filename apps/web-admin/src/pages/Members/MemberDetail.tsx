import React, { useState } from 'react';
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
  const [enrollResult, setEnrollResult]   = useState<{ memberCode: string } | null>(null);

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
    queryFn:  () => accessApi.events({ limit: 20 }),
    enabled:  !!id && tab === 'access',
  });

  const { data: devices = [], isLoading: devicesLoading } = useQuery({
    queryKey: ['access-devices', member?.branchId],
    queryFn:  () => accessApi.devices(member?.branchId),
    enabled:  showEnroll && !!member?.branchId,
    refetchInterval: showEnroll ? 8000 : false,
  });
  const deviceOnline = devices.some((d) => d.isOnline);

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
    mutationFn: () => memberApi.enrollFace(id!),
    onSuccess: (data) => {
      setEnrollResult({ memberCode: data.memberCode });
      setEnrollStep('success');
      void qc.invalidateQueries({ queryKey: ['member', id] });
    },
    onError: () => setEnrollStep('error'),
  });

  const handleStartEnroll = () => {
    setEnrollStep('scanning');
    enrollMut.mutate();
  };

  const handleCloseEnroll = () => {
    setShowEnroll(false);
    setEnrollStep('idle');
    setEnrollResult(null);
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
              { label: 'Face ID', value: member.faceEnrolled ? 'Enrolled ✓' : 'Not enrolled' },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between">
                <span className="text-muted text-xs">{label}</span>
                <span className="text-slate-300 text-xs font-medium">{value}</span>
              </div>
            ))}
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
              <div className="flex justify-end mb-3">
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
                    Device Offline
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-semibold text-slate-200 mb-1">Enroll Face for {name}</p>
                    <p className="text-xs text-red-400">The access machine is not reachable. Power it on and wait for it to check in — this modal refreshes automatically.</p>
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
                  <div className="text-center">
                    <p className="text-sm font-semibold text-slate-200 mb-1">Enroll Face for {name}</p>
                    <p className="text-xs text-muted">This will signal the edge device to open the camera and capture the member's face, linking it to their member ID.</p>
                  </div>
                  <div className="flex gap-3">
                    <Button variant="outline" onClick={handleCloseEnroll}>Cancel</Button>
                    <Button onClick={handleStartEnroll} disabled={devicesLoading || !deviceOnline}>
                      Start Enrollment
                    </Button>
                  </div>
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
                <p className="text-sm font-semibold text-emerald-300 mb-1">Face Enrolled Successfully</p>
                {enrollResult && (
                  <p className="text-xs text-muted">Linked to member ID: <span className="font-mono text-slate-300">{enrollResult.memberCode}</span></p>
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
                <p className="text-xs text-muted">Could not reach the edge device or enrollment was rejected. Please try again.</p>
              </div>
              <div className="flex gap-3">
                <Button variant="outline" onClick={handleCloseEnroll}>Close</Button>
                <Button onClick={handleStartEnroll}>Retry</Button>
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
