import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Layout } from '../components/layout/Layout';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal, ConfirmModal } from '../components/ui/Modal';
import { Badge } from '../components/ui/Badge';
import { PageSpinner } from '../components/ui/Spinner';
import { branchApi, type Branch } from '../api/branches';
import { accessApi } from '../api/access';
import { useAuthStore } from '../store/auth';
import { useRole } from '../hooks/useRole';
import { toast } from '../store/toast';
import { api } from '../api/client';
import { fmtDate } from '../utils/format';

type Tab = 'branches' | 'profile' | 'system' | 'liveaccess' | 'accesshours';

function BranchForm({ branch, onSuccess }: { branch?: Branch; onSuccess: () => void }) {
  const [form, setForm] = useState({
    name:    branch?.name    ?? '',
    address: branch?.address ?? '',
    phone:   branch?.phone   ?? '',
  });

  const mut = useMutation({
    mutationFn: () =>
      branch ? branchApi.update(branch._id, form) : branchApi.create(form),
    onSuccess: () => {
      toast.success(branch ? 'Branch updated' : 'Branch created');
      onSuccess();
    },
  });

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <form onSubmit={(e) => { e.preventDefault(); mut.mutate(); }} className="flex flex-col gap-4">
      <Input label="Branch Name" value={form.name}    onChange={set('name')}    autoFocus />
      <Input label="Address"     value={form.address} onChange={set('address')} />
      <Input label="Phone"       value={form.phone}   onChange={set('phone')}   type="tel" />
      <div className="flex justify-end pt-1">
        <Button type="submit" loading={mut.isPending}>
          {branch ? 'Save Changes' : 'Create Branch'}
        </Button>
      </div>
    </form>
  );
}

// ── Live Access Wizard ─────────────────────────────────────────────────────────
const STEPS = ['Intro', 'Broker', 'Topic', 'Auth', 'Done'] as const;

function StepDot({ label, idx, current }: { label: string; idx: number; current: number }) {
  const done = idx < current;
  const active = idx === current;
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all ${
          done    ? 'bg-emerald-500 border-emerald-500 text-white'
          : active ? 'bg-purple-600 border-purple-500 text-white'
                   : 'bg-white/[0.05] border-white/[0.12] text-slate-500'
        }`}
      >
        {done ? (
          <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/></svg>
        ) : idx + 1}
      </div>
      <span className={`text-[10px] font-medium ${active ? 'text-purple-400' : done ? 'text-emerald-400' : 'text-slate-600'}`}>
        {label}
      </span>
    </div>
  );
}

function LiveAccessWizard() {
  const { selectedBranchId } = useAuthStore();
  const [step, setStep]   = useState(0);
  const [saved, setSaved] = useState(false);

  const { data: devices = [], isLoading: devLoading } = useQuery({
    queryKey: ['devices', selectedBranchId],
    queryFn:  () => accessApi.devices(selectedBranchId ?? undefined),
  });

  const u5Devices = devices.filter(d => d.ipAddress);

  const [form, setForm] = useState({
    deviceId:    '',
    machineSn:   '',
    brokerUrl:   'mqtt://localhost:1883',
    fullTopic:   '',    // user sees and can edit the full topic directly
    username:    '',
    password:    '',
  });

  // Auto-select first U5 device and pre-fill defaults
  useEffect(() => {
    if (u5Devices.length > 0 && !form.deviceId) {
      const d = u5Devices[0];
      const sn = d.machineSn ?? '';
      setForm(f => ({
        ...f,
        deviceId:  d.deviceId,
        machineSn: sn,
        brokerUrl: d.mqttBrokerUrl ?? 'mqtt://localhost:1883',
        // Machine SN is used as both token and device-id in the topic (confirmed by user)
        fullTopic: d.mqttInfoTopic ?? (sn ? `info/${sn}/${sn}` : ''),
      }));
    }
  }, [u5Devices.length]);

  // When SN changes, auto-update topic if topic hasn't been manually edited
  const handleSnChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const sn = e.target.value;
    setForm(f => ({
      ...f,
      machineSn: sn,
      fullTopic: sn ? `info/${sn}/${sn}` : f.fullTopic,
    }));
  };

  const computedTopic = form.fullTopic;

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [k]: e.target.value }));

  const saveMut = useMutation({
    mutationFn: () =>
      accessApi.saveMqttConfig(form.deviceId, {
        machineSn:     form.machineSn,
        mqttBrokerUrl: form.brokerUrl,
        mqttInfoTopic: computedTopic,
        mqttUsername:  form.username || undefined,
        mqttPassword:  form.password || undefined,
      }),
    onSuccess: () => {
      setSaved(true);
      setStep(4);
      toast.success('Live access configured — edge service will connect within 30 seconds');
    },
    onError: () => toast.error('Failed to save config — check server connection'),
  });

  const existingDevice = u5Devices.find(d => d.deviceId === form.deviceId);

  return (
    <div className="max-w-2xl mx-auto">
      {/* Step progress */}
      <div className="flex items-start justify-between mb-8 px-2">
        {STEPS.map((label, idx) => (
          <React.Fragment key={label}>
            <StepDot label={label} idx={idx} current={step} />
            {idx < STEPS.length - 1 && (
              <div className={`flex-1 h-px mt-4 mx-1 transition-colors ${idx < step ? 'bg-emerald-500/60' : 'bg-white/[0.08]'}`} />
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Step 0 — Intro */}
      {step === 0 && (
        <Card className="p-7">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-xl bg-purple-600/20 flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5 text-purple-400">
                <path d="M13 10V3L4 14h7v7l9-11h-7z"/>
              </svg>
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-200">Enable Real-Time Live Access</h2>
              <p className="text-xs text-muted">Connect your U5 machine via MQTT for instant face-scan events</p>
            </div>
          </div>

          <div className="space-y-3 mb-6">
            {[
              { icon: '⚡', title: 'Instant events', desc: 'Face scans appear in the Access Monitor the moment they happen — no polling delay.' },
              { icon: '📡', title: 'Local network only', desc: 'All data stays on your LAN. No cloud relay, no third-party servers.' },
              { icon: '🖥️', title: 'Mosquitto broker needed', desc: 'Install Mosquitto on the edge PC and configure your U5 machine to connect to it.' },
            ].map(item => (
              <div key={item.title} className="flex gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                <span className="text-xl leading-none mt-0.5">{item.icon}</span>
                <div>
                  <p className="text-sm font-semibold text-slate-200">{item.title}</p>
                  <p className="text-xs text-muted">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="bg-amber-900/20 border border-amber-500/20 rounded-xl px-4 py-3 text-xs text-amber-300 mb-6">
            <strong>Before you start:</strong> Install Mosquitto on your edge PC, then go to your U5 machine's
            Network → MQTT settings and point it to this PC's IP on port 1883.
          </div>

          {u5Devices.length === 0 && !devLoading && (
            <p className="text-xs text-red-400 mb-4">No U5 device with an IP address found for this branch. Complete the device setup first.</p>
          )}

          <Button onClick={() => setStep(1)} disabled={u5Devices.length === 0 || devLoading} className="w-full">
            Get Started →
          </Button>
        </Card>
      )}

      {/* Step 1 — Broker */}
      {step === 1 && (
        <Card className="p-7">
          <h2 className="text-base font-bold text-slate-200 mb-1">MQTT Broker Address</h2>
          <p className="text-xs text-muted mb-6">
            Enter the address of your Mosquitto broker. If it's running on the same PC as the edge service, use the default.
          </p>

          <div className="space-y-4">
            {u5Devices.length > 1 && (
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">Device</label>
                <div className="flex flex-col gap-2">
                  {u5Devices.map(d => (
                    <label key={d.deviceId} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                      form.deviceId === d.deviceId
                        ? 'border-purple-500/50 bg-purple-500/10'
                        : 'border-white/[0.08] bg-white/[0.03] hover:border-white/[0.15]'
                    }`}>
                      <input
                        type="radio"
                        name="device"
                        value={d.deviceId}
                        checked={form.deviceId === d.deviceId}
                        onChange={() => setForm(f => ({ ...f, deviceId: d.deviceId, machineSn: d.machineSn ?? '' }))}
                        className="accent-purple-500"
                      />
                      <div>
                        <p className="text-sm font-medium text-slate-200">{d.name}</p>
                        <p className="text-xs text-muted">{d.ipAddress} · {d.zone.replace(/_/g,' ')}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <Input
              label="Broker URL"
              value={form.brokerUrl}
              onChange={set('brokerUrl')}
              placeholder="mqtt://localhost:1883"
              helpText="Use mqtt:// for plain (port 1883) or mqtts:// for TLS (port 8883). Default: mqtt://localhost:1883"
            />
          </div>

          <div className="flex gap-3 mt-6">
            <Button variant="outline" onClick={() => setStep(0)}>← Back</Button>
            <Button onClick={() => setStep(2)} disabled={!form.brokerUrl} className="flex-1">Next →</Button>
          </div>
        </Card>
      )}

      {/* Step 2 — Topic */}
      {step === 2 && (
        <Card className="p-7">
          <h2 className="text-base font-bold text-slate-200 mb-1">MQTT Topic</h2>
          <p className="text-xs text-muted mb-6">
            Enter your machine's serial number — the subscription topic is auto-generated.
            You can edit the full topic directly if your machine uses a different format.
          </p>

          <div className="space-y-4">
            <Input
              label="Machine Serial Number (SN)"
              value={form.machineSn}
              onChange={handleSnChange}
              placeholder="ZY20240703003"
              helpText="Printed on the device label or shown in machine About screen."
            />

            {/* Full topic — editable, auto-filled from SN */}
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">
                Subscription Topic
                <span className="ml-2 text-[10px] font-normal text-purple-400">auto-filled · edit if needed</span>
              </label>
              <input
                value={form.fullTopic}
                onChange={(e) => setForm(f => ({ ...f, fullTopic: e.target.value }))}
                placeholder="info/ZY20240703003/ZY20240703003"
                className="w-full px-3 py-2.5 rounded-xl bg-white/[0.05] border border-white/[0.1] text-sm text-emerald-400 font-mono focus:outline-none focus:border-purple-500/50"
              />
              <p className="text-[11px] text-muted mt-1.5">
                Format: <code className="text-purple-300">info/</code> + <code className="text-purple-300">SN</code> + <code className="text-purple-300">/SN</code>.
                The machine uses its own SN as both token and device-id in the MQTT topic.
              </p>
            </div>
          </div>

          <div className="flex gap-3 mt-6">
            <Button variant="outline" onClick={() => setStep(1)}>← Back</Button>
            <Button onClick={() => setStep(3)} disabled={!computedTopic || !form.machineSn} className="flex-1">
              Next →
            </Button>
          </div>
        </Card>
      )}

      {/* Step 3 — Auth */}
      {step === 3 && (
        <Card className="p-7">
          <h2 className="text-base font-bold text-slate-200 mb-1">Broker Credentials</h2>
          <p className="text-xs text-muted mb-6">
            If your Mosquitto broker requires a username and password, enter them here.
            Leave blank for a broker with no authentication.
          </p>

          <div className="space-y-4">
            <Input
              label="Username (optional)"
              value={form.username}
              onChange={set('username')}
              placeholder="Leave blank if broker has no auth"
              autoComplete="off"
            />
            <Input
              label="Password (optional)"
              value={form.password}
              onChange={set('password')}
              type="password"
              placeholder="Leave blank if broker has no auth"
              autoComplete="new-password"
            />
          </div>

          <div className="bg-white/[0.03] border border-white/[0.07] rounded-xl px-4 py-3 mt-4 text-xs text-slate-400 space-y-1">
            <p className="font-semibold text-slate-300">Summary</p>
            <p>Broker: <span className="text-slate-200 font-mono">{form.brokerUrl}</span></p>
            <p>Topic: <span className="text-emerald-400 font-mono">{computedTopic}</span></p>
            <p>Auth: <span className="text-slate-200">{form.username ? `${form.username} / ••••••` : 'none'}</span></p>
          </div>

          <div className="flex gap-3 mt-6">
            <Button variant="outline" onClick={() => setStep(2)}>← Back</Button>
            <Button
              onClick={() => saveMut.mutate()}
              loading={saveMut.isPending}
              className="flex-1"
            >
              Enable Live Access
            </Button>
          </div>
        </Card>
      )}

      {/* Step 4 — Done */}
      {step === 4 && (
        <Card className="p-7 text-center">
          <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto mb-4">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-8 h-8 text-emerald-400">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
            </svg>
          </div>
          <h2 className="text-lg font-bold text-slate-200 mb-2">Live Access Configured!</h2>
          <p className="text-sm text-muted mb-6">
            The edge service will connect to your Mosquitto broker within 30 seconds (on its next pull cycle).
            Once connected, face-scan events will appear in the Access Monitor instantly.
          </p>

          <div className="bg-white/[0.03] border border-white/[0.07] rounded-xl px-4 py-3 text-xs text-left space-y-1.5 mb-6">
            <p className="text-slate-400">Broker: <span className="text-slate-200 font-mono">{form.brokerUrl}</span></p>
            <p className="text-slate-400">Topic: <span className="text-emerald-400 font-mono">{computedTopic}</span></p>
            <p className="text-slate-400">Device: <span className="text-slate-200">{existingDevice?.name ?? form.deviceId}</span></p>
          </div>

          <div className="bg-blue-900/20 border border-blue-500/20 rounded-xl px-4 py-3 text-xs text-blue-300 text-left mb-6">
            <p className="font-semibold mb-1">Verify it's working:</p>
            <ol className="list-decimal list-inside space-y-1 text-blue-300/80">
              <li>Open the Access Monitor → Members segment</li>
              <li>Have someone scan their face on the U5 machine</li>
              <li>The event should appear within 1–2 seconds</li>
            </ol>
          </div>

          <Button variant="outline" onClick={() => { setStep(0); setSaved(false); }} className="w-full">
            Reconfigure
          </Button>
        </Card>
      )}

      {/* Already-configured status (shown when device already has MQTT set up) */}
      {step === 0 && existingDevice?.mqttLiveEnabled && (
        <div className="mt-4 flex items-center gap-3 px-4 py-3 rounded-xl bg-emerald-900/20 border border-emerald-500/20 text-emerald-300 text-xs">
          <span className="w-2 h-2 rounded-full bg-emerald-400 blink flex-shrink-0" />
          <span>
            Live access already configured for <strong>{existingDevice.name}</strong>.
            Topic: <code className="font-mono">{existingDevice.mqttInfoTopic}</code>.
            Click "Get Started" to reconfigure.
          </span>
        </div>
      )}
    </div>
  );
}

// ── Access Hours Settings ──────────────────────────────────────────────────────
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function AccessHoursSettings() {
  const { selectedBranchId } = useAuthStore();
  const qc = useQueryClient();

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn:  () => branchApi.list(),
  });

  const [selectedId, setSelectedId] = useState<string>(selectedBranchId ?? '');
  const activeBranch = branches.find(b => b._id === selectedId) ?? branches[0];

  const [form, setForm] = useState({
    enabled:     false,
    start:       '06:00',
    end:         '22:00',
    allowedDays: [0, 1, 2, 3, 4, 5, 6] as number[],
  });

  // Sync form with selected branch
  useEffect(() => {
    if (!activeBranch) return;
    setForm({
      enabled:     activeBranch.accessHoursEnabled  ?? false,
      start:       activeBranch.accessHoursStart     ?? '06:00',
      end:         activeBranch.accessHoursEnd       ?? '22:00',
      allowedDays: activeBranch.accessAllowedDays    ?? [0, 1, 2, 3, 4, 5, 6],
    });
    setSelectedId(activeBranch._id);
  }, [activeBranch?._id]);

  const saveMut = useMutation({
    mutationFn: () =>
      branchApi.update(activeBranch!._id, {
        accessHoursEnabled: form.enabled,
        accessHoursStart:   form.start,
        accessHoursEnd:     form.end,
        accessAllowedDays:  form.allowedDays,
      }),
    onSuccess: () => {
      toast.success('Access hours saved — edge service will pick up on next sync');
      void qc.invalidateQueries({ queryKey: ['branches'] });
    },
    onError: () => toast.error('Failed to save access hours'),
  });

  const toggleDay = (d: number) =>
    setForm(f => ({
      ...f,
      allowedDays: f.allowedDays.includes(d)
        ? f.allowedDays.filter(x => x !== d)
        : [...f.allowedDays, d].sort(),
    }));

  return (
    <div className="max-w-xl">
      {branches.length > 1 && (
        <div className="mb-5">
          <label className="block text-xs font-semibold text-slate-400 mb-1.5">Branch</label>
          <div className="flex flex-wrap gap-2">
            {branches.map(b => (
              <button
                key={b._id}
                onClick={() => setSelectedId(b._id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  selectedId === b._id
                    ? 'bg-purple-600 border-purple-500 text-white'
                    : 'bg-white/[0.04] border-white/[0.08] text-slate-400 hover:text-slate-200'
                }`}
              >
                {b.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {!activeBranch ? null : (
        <Card className="p-6 space-y-6">
          {/* Enable toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-200">Enable Access Hours</p>
              <p className="text-xs text-muted mt-0.5">
                When on, members can only enter during the allowed time window.
                Expired or outside-hours scans will be denied — door will not open.
              </p>
            </div>
            <button
              onClick={() => setForm(f => ({ ...f, enabled: !f.enabled }))}
              className={`relative w-12 h-6 rounded-full transition-colors ${
                form.enabled ? 'bg-purple-600' : 'bg-white/[0.1]'
              }`}
            >
              <span
                className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                  form.enabled ? 'translate-x-7' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {form.enabled && (
            <>
              {/* Time range */}
              <div>
                <p className="text-xs font-semibold text-slate-400 mb-3">Daily Access Window</p>
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <label className="block text-[11px] text-muted mb-1">Opens</label>
                    <input
                      type="time"
                      value={form.start}
                      onChange={e => setForm(f => ({ ...f, start: e.target.value }))}
                      className="w-full px-3 py-2 rounded-xl bg-white/[0.05] border border-white/[0.1] text-sm text-slate-200 focus:outline-none focus:border-purple-500/50"
                    />
                  </div>
                  <span className="text-muted text-sm mt-4">to</span>
                  <div className="flex-1">
                    <label className="block text-[11px] text-muted mb-1">Closes</label>
                    <input
                      type="time"
                      value={form.end}
                      onChange={e => setForm(f => ({ ...f, end: e.target.value }))}
                      className="w-full px-3 py-2 rounded-xl bg-white/[0.05] border border-white/[0.1] text-sm text-slate-200 focus:outline-none focus:border-purple-500/50"
                    />
                  </div>
                </div>
              </div>

              {/* Days of week */}
              <div>
                <p className="text-xs font-semibold text-slate-400 mb-3">Allowed Days</p>
                <div className="flex gap-2">
                  {DAYS.map((day, i) => (
                    <button
                      key={day}
                      onClick={() => toggleDay(i)}
                      className={`w-9 h-9 rounded-lg text-xs font-semibold transition-colors ${
                        form.allowedDays.includes(i)
                          ? 'bg-purple-600 text-white'
                          : 'bg-white/[0.05] text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      {day}
                    </button>
                  ))}
                </div>
                {form.allowedDays.length === 0 && (
                  <p className="text-[11px] text-red-400 mt-1.5">At least one day must be selected.</p>
                )}
              </div>

              {/* Summary */}
              <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl px-4 py-3 text-xs text-slate-400">
                Members can access from <span className="text-slate-200 font-semibold">{form.start}</span> to{' '}
                <span className="text-slate-200 font-semibold">{form.end}</span> on{' '}
                <span className="text-slate-200 font-semibold">
                  {form.allowedDays.length === 7
                    ? 'all days'
                    : form.allowedDays.map(d => DAYS[d]).join(', ')}
                </span>. Scans outside this window will be denied and the door will not open.
              </div>
            </>
          )}

          <div className="flex justify-end">
            <Button
              onClick={() => saveMut.mutate()}
              loading={saveMut.isPending}
              disabled={form.enabled && form.allowedDays.length === 0}
            >
              Save Access Hours
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

export default function Settings() {
  const { user } = useAuthStore();
  const { isOwner } = useRole();
  const qc = useQueryClient();
  const [tab, setTab]             = useState<Tab>(isOwner ? 'branches' : 'profile');
  const [showBranch, setShowBranch]       = useState(false);
  const [editBranch, setEditBranch]       = useState<Branch | undefined>();
  const [deleteBranch, setDeleteBranch]   = useState<Branch | undefined>();

  const { data: branches = [], isLoading: branchLoading } = useQuery({
    queryKey: ['branches'],
    queryFn:  () => branchApi.list(),
    enabled:  tab === 'branches',
  });

  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn:  () => api.get('/health').then((r) => r.data as Record<string, unknown>),
    enabled:  tab === 'system',
    refetchInterval: 30_000,
  });

  const { data: metrics } = useQuery({
    queryKey: ['metrics'],
    queryFn:  () => api.get('/metrics').then((r) => r.data as Record<string, unknown>),
    enabled:  tab === 'system',
    refetchInterval: 30_000,
  });

  const deleteMut = useMutation({
    mutationFn: () => branchApi.remove(deleteBranch!._id),
    onSuccess: () => {
      toast.success('Branch deactivated');
      setDeleteBranch(undefined);
      void qc.invalidateQueries({ queryKey: ['branches'] });
    },
  });

  const tabs = [
    ...(isOwner ? [{ id: 'branches' as Tab, label: 'Branches' }] : []),
    { id: 'profile'     as Tab, label: 'My Profile' },
    { id: 'accesshours' as Tab, label: 'Access Hours' },
    { id: 'liveaccess'  as Tab, label: 'Live Access' },
    { id: 'system'      as Tab, label: 'System Health' },
  ];

  return (
    <Layout title="Settings">
      {/* Tabs */}
      <div className="flex border-b border-white/[0.06] mb-5 -mx-6 px-6">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`py-3 px-4 text-sm font-semibold border-b-2 transition-colors mr-1 ${
              tab === t.id
                ? 'border-purple-500 text-purple-400'
                : 'border-transparent text-muted hover:text-slate-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* BRANCHES */}
      {tab === 'branches' && (
        <>
          <div className="flex justify-end mb-4">
            <Button size="sm" onClick={() => { setEditBranch(undefined); setShowBranch(true); }}>
              + New Branch
            </Button>
          </div>
          <Card>
            {branchLoading ? (
              <PageSpinner />
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/[0.06]">
                    {['Branch', 'Phone', 'Status', 'Created', ''].map((h) => (
                      <th key={h} className="text-left text-[11px] font-semibold text-dimmed tracking-widest uppercase px-5 py-3.5">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {branches.map((b) => (
                    <tr key={b._id} className="border-b border-white/[0.04] last:border-0 hover:bg-purple-500/[0.03]">
                      <td className="px-5 py-3.5">
                        <p className="text-sm font-medium text-slate-200">{b.name}</p>
                        {b.address && <p className="text-xs text-muted">{b.address}</p>}
                      </td>
                      <td className="px-5 py-3.5 text-sm text-slate-400">{b.phone ?? '—'}</td>
                      <td className="px-5 py-3.5">
                        <Badge variant={b.isActive ? 'active' : 'blocked'}>{b.isActive ? 'Active' : 'Inactive'}</Badge>
                      </td>
                      <td className="px-5 py-3.5 text-xs text-muted">{fmtDate(b.createdAt)}</td>
                      <td className="px-5 py-3.5">
                        <div className="flex gap-3">
                          <button onClick={() => { setEditBranch(b); setShowBranch(true); }} className="text-xs text-purple-400 hover:text-purple-300">Edit</button>
                          <button onClick={() => setDeleteBranch(b)} className="text-xs text-red-400 hover:text-red-300">Deactivate</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}

      {/* PROFILE */}
      {tab === 'profile' && (
        <Card className="p-6 max-w-lg">
          <div className="space-y-4 text-sm">
            {[
              { label: 'Name',  value: user?.displayName ?? '—' },
              { label: 'Email', value: user?.email ?? '—' },
              { label: 'Role',  value: user?.role ?? '—' },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between border-b border-white/[0.05] pb-3 last:border-0 last:pb-0">
                <span className="text-muted">{label}</span>
                <span className="text-slate-200 font-medium">{value}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* SYSTEM HEALTH */}
      {tab === 'system' && (
        <div className="grid grid-cols-2 gap-4">
          <Card className="p-5">
            <h3 className="text-sm font-bold text-slate-200 mb-4">API Health</h3>
            {health ? (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted">Status</span>
                  <Badge variant={health['status'] === 'ok' ? 'active' : 'expired'}>{String(health['status'] ?? '—')}</Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">MongoDB Ping</span>
                  <span className="text-slate-300">{String(health['mongoLatencyMs'] ?? '—')} ms</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Uptime</span>
                  <span className="text-slate-300">{String(health['uptime'] ?? '—')} s</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Node Version</span>
                  <span className="text-slate-300 font-mono text-xs">{String(health['nodeVersion'] ?? '—')}</span>
                </div>
              </div>
            ) : (
              <PageSpinner />
            )}
          </Card>

          <Card className="p-5">
            <h3 className="text-sm font-bold text-slate-200 mb-4">Memory / MongoDB</h3>
            {metrics ? (
              <div className="space-y-2 text-sm">
                {Object.entries(metrics).map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <span className="text-muted text-xs">{k}</span>
                    <span className="text-slate-300 font-mono text-xs">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <PageSpinner />
            )}
          </Card>
        </div>
      )}

      {/* ACCESS HOURS */}
      {tab === 'accesshours' && <AccessHoursSettings />}

      {/* LIVE ACCESS */}
      {tab === 'liveaccess' && <LiveAccessWizard />}

      {/* Modals */}
      <Modal open={showBranch} onClose={() => setShowBranch(false)} title={editBranch ? 'Edit Branch' : 'New Branch'} width="max-w-md">
        <BranchForm
          branch={editBranch}
          onSuccess={() => {
            setShowBranch(false);
            void qc.invalidateQueries({ queryKey: ['branches'] });
          }}
        />
      </Modal>

      <ConfirmModal
        open={!!deleteBranch}
        onClose={() => setDeleteBranch(undefined)}
        onConfirm={() => deleteMut.mutate()}
        loading={deleteMut.isPending}
        title="Deactivate Branch"
        message={`Are you sure you want to deactivate "${deleteBranch?.name}"? Existing data will be preserved.`}
        confirmLabel="Deactivate"
        danger
      />
    </Layout>
  );
}
