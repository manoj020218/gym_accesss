import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { accessApi } from '../../api/access';
import { toast } from '../../store/toast';

type WizardStep   = 'form' | 'credentials' | 'waiting' | 'done';
type ConfigSub    = 'device-id' | 'branch-id' | 'server-ip' | 'summary';
const CONFIG_SUBS: ConfigSub[] = ['device-id', 'branch-id', 'server-ip', 'summary'];

interface Creds { deviceCode: string; secret: string; sessionId: string }

interface Props {
  open: boolean;
  branchId: string;
  onClose: () => void;
  onDeviceOnline: () => void;
}

/* ── Shared step-bar ─────────────────────────────────────────────────────── */
function StepBar({ current }: { current: WizardStep }) {
  const steps: { id: WizardStep; label: string }[] = [
    { id: 'form',        label: 'Name'    },
    { id: 'credentials', label: 'Confirm' },
    { id: 'waiting',     label: 'Connect' },
    { id: 'done',        label: 'Done'    },
  ];
  const idx = steps.findIndex((s) => s.id === current);
  return (
    <div className="flex items-start gap-0 mb-6">
      {steps.map((s, i) => (
        <React.Fragment key={s.id}>
          <div className="flex flex-col items-center gap-1">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold transition-colors ${
              i < idx   ? 'bg-emerald-600 text-white' :
              i === idx ? 'bg-purple-600 text-white ring-2 ring-purple-400/40' :
                          'bg-white/10 text-muted'
            }`}>
              {i < idx ? (
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
                  <polyline points="13 4 6 11 3 8"/>
                </svg>
              ) : i + 1}
            </div>
            <span className={`text-[10px] font-medium ${i === idx ? 'text-purple-400' : i < idx ? 'text-emerald-400' : 'text-muted'}`}>
              {s.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div className={`flex-1 h-px mt-3.5 mx-1 transition-colors ${i < idx ? 'bg-emerald-600' : 'bg-white/10'}`} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

/* ── Sub-step progress bar inside credentials ────────────────────────────── */
function SubBar({ current }: { current: ConfigSub }) {
  const idx = CONFIG_SUBS.indexOf(current);
  return (
    <div className="flex items-center gap-1 mb-5">
      {CONFIG_SUBS.map((s, i) => (
        <div key={s} className={`flex-1 h-1 rounded-full transition-colors ${
          i < idx   ? 'bg-emerald-500' :
          i === idx ? 'bg-purple-500'  : 'bg-white/10'
        }`} />
      ))}
    </div>
  );
}

/* ── Generic confirm card ────────────────────────────────────────────────── */
function ConfirmCard({
  icon, title, subtitle, value, onConfirm, onBack, confirmLabel = 'Got it →', children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  value: string;
  onConfirm: () => void;
  onBack?: () => void;
  confirmLabel?: string;
  children?: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const didAutoRef = useRef(false);

  // Auto-copy silently once on mount
  useEffect(() => {
    if (didAutoRef.current || !value) return;
    didAutoRef.current = true;
    void navigator.clipboard.writeText(value)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 3000); })
      .catch(() => {/* clipboard denied — skip silently */});
  }, [value]);

  const copy = () => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-purple-600/20 border border-purple-500/20 flex items-center justify-center text-purple-400 shrink-0">
          {icon}
        </div>
        <div>
          <p className="text-sm font-bold text-slate-100">{title}</p>
          <p className="text-xs text-muted">{subtitle}</p>
        </div>
      </div>

      {/* Value box */}
      <div className="relative bg-[#0d1117] border border-purple-500/20 rounded-2xl p-5 text-center">
        <p className="font-mono text-lg font-bold text-purple-200 break-all leading-snug">{value}</p>
        <div className={`absolute top-3 right-3 flex items-center gap-1 text-[10px] font-semibold transition-opacity ${copied ? 'opacity-100 text-emerald-400' : 'opacity-0'}`}>
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3"><polyline points="10 3 5 9 2 6"/></svg>
          Saved
        </div>
      </div>

      {children}

      {/* Actions */}
      <div className="flex items-center justify-between pt-1">
        {onBack
          ? <button onClick={onBack} className="text-xs text-muted hover:text-slate-300 transition-colors">← Back</button>
          : <button onClick={copy} className="text-xs text-muted hover:text-slate-300 underline underline-offset-2 transition-colors">Copy again</button>
        }
        <Button onClick={onConfirm}>{confirmLabel}</Button>
      </div>
    </div>
  );
}

/* ── Main wizard ─────────────────────────────────────────────────────────── */
export default function AddDeviceWizard({ open, branchId, onClose, onDeviceOnline }: Props) {
  const qc = useQueryClient();
  const [step, setStep]       = useState<WizardStep>('form');
  const [subStep, setSubStep] = useState<ConfigSub>('device-id');
  const [devName, setDevName] = useState('Main Entry Scanner');
  const [creds, setCreds]     = useState<Creds | null>(null);
  const [customIp, setCustomIp] = useState('');

  // Machine connect form state (waiting step)
  const [machineIp, setMachineIp]     = useState('');
  const [machinePwd, setMachinePwd]   = useState('123456');
  const [machineErr, setMachineErr]   = useState('');
  const [machineOk, setMachineOk]     = useState(false);
  const [configuring, setConfiguring] = useState(false);

  // Server URL: use the admin panel's own origin (works for both cloud + LAN)
  const defaultServerUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const serverUrl = customIp.trim() || defaultServerUrl;

  // Poll for heartbeat when waiting
  const { data: devices = [] } = useQuery({
    queryKey: ['access-devices', branchId],
    queryFn:  () => accessApi.devices(branchId),
    enabled:  step === 'waiting',
    refetchInterval: step === 'waiting' ? 5000 : false,
  });

  useEffect(() => {
    if (step === 'waiting' && creds && devices.some((d) => d.isOnline)) {
      void accessApi.logSetup({
        sessionId: creds.sessionId, branchId, deviceCode: creds.deviceCode,
        step: 'DEVICE_ONLINE', confirmedValue: 'online',
        metadata: { deviceName: devName },
      });
      setStep('done');
    }
  }, [devices, step, creds, branchId, devName]);

  const log = useCallback((stepName: string, value?: string, meta?: Record<string, unknown>) => {
    if (!creds) return;
    void accessApi.logSetup({
      sessionId: creds.sessionId, branchId, deviceCode: creds.deviceCode,
      step: stepName, confirmedValue: value, metadata: meta,
    });
  }, [creds, branchId]);

  const registerMut = useMutation({
    mutationFn: () => accessApi.registerDevice(branchId, devName.trim()),
    onSuccess: (data) => {
      const sessionId = `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      setCreds({ deviceCode: data.deviceCode, secret: data.secret, sessionId });
      setSubStep('device-id');
      setStep('credentials');
      void qc.invalidateQueries({ queryKey: ['access-devices', branchId] });
      void accessApi.logSetup({
        sessionId, branchId, deviceCode: data.deviceCode,
        step: 'REGISTERED', confirmedValue: data.deviceCode,
        metadata: { deviceName: devName },
      });
    },
    onError: () => toast.error('Registration failed — try again or check server logs'),
  });

  // Directly configure machine from browser (browser must be on same LAN as machine)
  const handleConfigureMachine = useCallback(async () => {
    const ip = machineIp.trim();
    if (!ip || !creds) return;
    setMachineErr('');
    setMachineOk(false);
    setConfiguring(true);
    const vpsHost = window.location.hostname;
    const payload = {
      set: 1,
      password: machinePwd || '123456',
      cloudserver_address: `http://${vpsHost}`,
      third_ip: 0,
      third_ip_ddr: '3000',
      cloudserver_pollingtime: 10,
      protocol_type: 1,
    };
    try {
      const res = await fetch(`http://${ip}/serverSetting`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setMachineOk(true);
        log('MACHINE_CONFIGURED', ip, { vpsHost });
      } else {
        setMachineErr(`Machine returned HTTP ${res.status}. Check password and try again.`);
      }
    } catch {
      // Mixed content or CORS: browser blocked the request — show manual fallback
      setMachineErr('MANUAL_FALLBACK');
    } finally {
      setConfiguring(false);
    }
  }, [machineIp, machinePwd, creds, log]);

  const handleClose = () => {
    setStep('form'); setSubStep('device-id');
    setDevName('Main Entry Scanner');
    setCreds(null); setCustomIp('');
    setMachineIp(''); setMachinePwd('123456'); setMachineErr(''); setMachineOk(false);
    setConfiguring(false);
    onClose();
  };

  return (
    <Modal open={open} onClose={handleClose} title="Add Machine to Branch" width="max-w-lg">
      <StepBar current={step} />

      {/* ═══ Step 1 — Name ══════════════════════════════════════════════════ */}
      {step === 'form' && (
        <div className="space-y-5">
          <div>
            <p className="text-sm font-bold text-slate-100 mb-1">Name this machine</p>
            <p className="text-xs text-muted mb-4">Use the location so you can tell devices apart — e.g. "Main Entry", "Gym Floor Door".</p>
            <Input
              label="Device Name"
              value={devName}
              onChange={(e) => setDevName(e.target.value)}
              placeholder="Main Entry Scanner"
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={handleClose}>Cancel</Button>
            <Button loading={registerMut.isPending} onClick={() => registerMut.mutate()} disabled={!devName.trim()}>
              Register →
            </Button>
          </div>
        </div>
      )}

      {/* ═══ Step 2 — Confirm credentials one by one ════════════════════════ */}
      {step === 'credentials' && creds && (
        <>
          <SubBar current={subStep} />

          {/* ── 2a: Device ID ── */}
          {subStep === 'device-id' && (
            <ConfirmCard
              icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>}
              title="Device ID"
              subtitle="The machine's unique name on this system — step 1 of 3"
              value={creds.deviceCode}
              onConfirm={() => { log('CONFIRM_DEVICE_ID', creds.deviceCode); setSubStep('branch-id'); }}
            >
              <div className="flex items-start gap-2 p-3 bg-purple-900/20 border border-purple-500/20 rounded-xl">
                <span className="text-purple-400 shrink-0 mt-0.5">ℹ</span>
                <p className="text-xs text-purple-200/70">
                  Show this to the technician configuring the machine. We've already copied it to your clipboard.
                </p>
              </div>
            </ConfirmCard>
          )}

          {/* ── 2b: Branch ID ── */}
          {subStep === 'branch-id' && (
            <ConfirmCard
              icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>}
              title="Branch Code"
              subtitle="Which branch this machine belongs to — step 2 of 3"
              value={branchId}
              onBack={() => setSubStep('device-id')}
              onConfirm={() => { log('CONFIRM_BRANCH_ID', branchId); setSubStep('server-ip'); }}
            >
              <div className="flex items-start gap-2 p-3 bg-purple-900/20 border border-purple-500/20 rounded-xl">
                <span className="text-purple-400 shrink-0 mt-0.5">ℹ</span>
                <p className="text-xs text-purple-200/70">
                  This links the machine to your branch so access rules apply correctly. Copied to clipboard.
                </p>
              </div>
            </ConfirmCard>
          )}

          {/* ── 2c: Server Address ── */}
          {subStep === 'server-ip' && (
            <ConfirmCard
              icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>}
              title="Server Address"
              subtitle="Where the edge service will connect to — step 3 of 3"
              value={serverUrl}
              onBack={() => setSubStep('branch-id')}
              onConfirm={() => { log('CONFIRM_SERVER_IP', serverUrl); setSubStep('summary'); }}
            >
              <div className="flex items-start gap-2 p-3 bg-purple-900/20 border border-purple-500/20 rounded-xl">
                <span className="text-purple-400 shrink-0 mt-0.5">ℹ</span>
                <p className="text-xs text-purple-200/70">
                  The edge service PC must be able to reach this URL. For local-only setups, override below.
                </p>
              </div>
              <div>
                <p className="text-[10px] font-semibold text-slate-400 tracking-wider mb-2">OVERRIDE (local network only)</p>
                <Input
                  label=""
                  value={customIp}
                  onChange={(e) => setCustomIp(e.target.value)}
                  placeholder="http://192.168.1.100:3000"
                />
              </div>
            </ConfirmCard>
          )}

          {/* ── 2d: Summary ── */}
          {subStep === 'summary' && (
            <div className="space-y-5">
              <div>
                <p className="text-sm font-bold text-slate-100 mb-1">All confirmed</p>
                <p className="text-xs text-muted">
                  Show this screen to your technician — they'll enter each value into the device setup. Tap any row to copy it.
                </p>
              </div>

              <div className="bg-slate-900/60 border border-white/10 rounded-2xl overflow-hidden divide-y divide-white/[0.05]">
                {([
                  { label: 'Device ID',      value: creds.deviceCode, color: 'text-purple-300'  },
                  { label: 'Branch Code',    value: branchId,         color: 'text-cyan-300'    },
                  { label: 'Server Address', value: serverUrl,        color: 'text-emerald-300' },
                  { label: 'Secret Key',     value: creds.secret,     color: 'text-amber-300', mask: true },
                ] as { label: string; value: string; color: string; mask?: boolean }[]).map(({ label, value, color, mask }) => {
                  return (
                    <button
                      key={label}
                      onClick={() => void navigator.clipboard.writeText(value).then(() => toast.success(`${label} copied`))}
                      className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-white/[0.03] transition-colors group"
                    >
                      <div className="min-w-[110px]">
                        <p className="text-[10px] font-semibold text-slate-500 tracking-wider">{label}</p>
                      </div>
                      <p className={`font-mono text-xs break-all flex-1 ${color}`}>
                        {mask ? `${value.slice(0, 16)}…` : value}
                      </p>
                      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5 text-muted group-hover:text-slate-300 transition-colors shrink-0">
                        <rect x="5" y="5" width="9" height="9" rx="1.5"/><path d="M2 11V3a1 1 0 0 1 1-1h8"/>
                      </svg>
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center justify-between pt-1">
                <button onClick={() => setSubStep('server-ip')} className="text-xs text-muted hover:text-slate-300 transition-colors">← Back</button>
                <Button onClick={() => {
                  log('SETUP_COMPLETE', undefined, { serverUrl, deviceName: devName });
                  setStep('waiting');
                }}>
                  Device is configured, waiting →
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ═══ Step 3 — Configure machine ═════════════════════════════════════ */}
      {step === 'waiting' && creds && (
        <div className="space-y-5">
          <div>
            <p className="text-sm font-bold text-slate-100 mb-1">Connect your machine</p>
            <p className="text-xs text-muted">Enter the machine's local IP and password to point it at this server automatically.</p>
          </div>

          <div className="space-y-3">
            <Input
              label="Machine IP Address"
              value={machineIp}
              onChange={(e) => { setMachineIp(e.target.value); setMachineErr(''); setMachineOk(false); }}
              placeholder="192.168.1.92"
              autoFocus
            />
            <Input
              label="Machine Password"
              value={machinePwd}
              onChange={(e) => { setMachinePwd(e.target.value); setMachineErr(''); }}
              placeholder="123456"
            />
          </div>

          {!machineOk && (
            <Button
              className="w-full justify-center"
              loading={configuring}
              disabled={!machineIp.trim() || configuring}
              onClick={() => void handleConfigureMachine()}
            >
              Configure Machine →
            </Button>
          )}

          {machineOk && (
            <div className="flex items-center gap-2 p-3 bg-emerald-900/20 border border-emerald-500/20 rounded-xl">
              <span className="w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center shrink-0">
                <svg viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth="2.5" className="w-2.5 h-2.5"><polyline points="10 3 5 9 2 6"/></svg>
              </span>
              <p className="text-xs text-emerald-300 font-semibold">Machine configured — waiting for it to connect…</p>
            </div>
          )}

          {machineErr && machineErr !== 'MANUAL_FALLBACK' && !configuring && (
            <div className="flex items-start gap-2 p-3 bg-red-900/20 border border-red-500/20 rounded-xl">
              <span className="text-red-400 shrink-0 mt-0.5">✕</span>
              <p className="text-xs text-red-300">{machineErr}</p>
            </div>
          )}

          {/* Manual fallback — shown when browser blocks the request (HTTPS → HTTP) */}
          {machineErr === 'MANUAL_FALLBACK' && (
            <div className="space-y-2">
              <div className="flex items-start gap-2 p-3 bg-amber-900/20 border border-amber-500/20 rounded-xl">
                <span className="text-amber-400 shrink-0 mt-0.5">!</span>
                <p className="text-xs text-amber-300">
                  Browser blocked the request (HTTPS → HTTP). Open your machine's web interface and POST this JSON to <span className="font-mono">http://{machineIp}/serverSetting</span>
                </p>
              </div>
              <button
                onClick={() => {
                  const vpsHost = window.location.hostname;
                  const payload = JSON.stringify({
                    set: 1, password: machinePwd || '123456',
                    cloudserver_address: `http://${vpsHost}`,
                    third_ip: 0, third_ip_ddr: '3000',
                    cloudserver_pollingtime: 10, protocol_type: 1,
                  }, null, 2);
                  void navigator.clipboard.writeText(payload).then(() => toast.success('Payload copied'));
                }}
                className="w-full text-xs font-mono bg-[#0d1117] border border-purple-500/20 rounded-xl p-3 text-purple-200/70 text-left hover:border-purple-500/40 transition-colors"
              >
                {`{ "set": 1, "cloudserver_address": "http://${window.location.hostname}", "third_ip_ddr": "3000", ... }`}
                <span className="block mt-1 text-purple-400">Tap to copy full payload</span>
              </button>
            </div>
          )}

          {/* Auto-detection */}
          <div className="flex items-center gap-2 text-xs text-muted pt-1">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse shrink-0" />
            Waiting for machine to register with server…
          </div>

          <div className="flex justify-between pt-1 border-t border-white/[0.06]">
            <Button variant="outline" size="sm" onClick={() => setStep('credentials')}>← Back</Button>
            <Button variant="outline" size="sm" onClick={handleClose}>Cancel</Button>
          </div>
        </div>
      )}

      {/* ═══ Step 4 — Done ══════════════════════════════════════════════════ */}
      {step === 'done' && (
        <div className="flex flex-col items-center gap-5 py-2">
          <div className="w-16 h-16 rounded-full bg-emerald-600/20 border-2 border-emerald-500 flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-8 h-8 text-emerald-400">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </div>
          <div className="text-center">
            <p className="text-sm font-bold text-emerald-300 mb-1">Machine is Online!</p>
            <p className="text-xs text-muted">The device connected successfully. You can now enroll faces for members on this branch.</p>
          </div>
          <Button onClick={() => { handleClose(); onDeviceOnline(); }}>
            Continue to Face Enrollment →
          </Button>
        </div>
      )}
    </Modal>
  );
}
