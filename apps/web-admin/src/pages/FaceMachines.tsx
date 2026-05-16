import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Layout } from '../components/layout/Layout';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { PageSpinner } from '../components/ui/Spinner';
import { EmptyState } from '../components/ui/EmptyState';
import { accessApi } from '../api/access';
import { zkbioApi, type ZkbioEmployee } from '../api/zkbio';
import { memberApi, type Member } from '../api/members';
import { useAuthStore } from '../store/auth';
import { toast } from '../store/toast';
import { fmtDate } from '../utils/format';

// ── Inline member search ───────────────────────────────────────────────────
function MemberSearch({
  branchId,
  onSelect,
  onCancel,
}: {
  branchId?: string;
  onSelect: (m: Member) => void;
  onCancel: () => void;
}) {
  const [q, setQ] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const { data, isFetching } = useQuery({
    queryKey: ['member-search', q, branchId],
    queryFn:  () => memberApi.list({ search: q, branchId, limit: 8 }),
    enabled:  q.length >= 2,
  });

  useEffect(() => { inputRef.current?.focus(); }, []);

  return (
    <div className="relative">
      <input
        ref={inputRef}
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder="Search member name or code…"
        className="w-full text-xs bg-white/[0.06] border border-white/[0.12] rounded-lg px-3 py-1.5 text-slate-200 outline-none focus:border-purple-500/50"
      />
      {q.length >= 2 && (
        <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-[#0e0e1c] border border-white/[0.1] rounded-xl shadow-xl max-h-52 overflow-y-auto">
          {isFetching ? (
            <p className="text-xs text-muted px-3 py-2">Searching…</p>
          ) : (data?.data ?? []).length === 0 ? (
            <p className="text-xs text-muted px-3 py-2">No members found</p>
          ) : (
            (data?.data ?? []).map(m => (
              <button
                key={m._id}
                onClick={() => onSelect(m)}
                className="w-full text-left px-3 py-2 hover:bg-purple-500/10 transition-colors border-b border-white/[0.04] last:border-0"
              >
                <p className="text-xs font-semibold text-slate-200">{m.firstName} {m.lastName}</p>
                <p className="text-[11px] text-muted">{m.memberCode} · {m.status}</p>
              </button>
            ))
          )}
        </div>
      )}
      <button
        onClick={onCancel}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs"
      >
        ✕
      </button>
    </div>
  );
}

// ── Import JSON panel ──────────────────────────────────────────────────────
function ImportPanel({
  device,
  onImported,
}: {
  device: { deviceId: string; deviceCode: string; machineSn?: string; localIp?: string };
  onImported: () => void;
}) {
  const qc = useQueryClient();
  const [localIp, setLocalIp] = useState(device.localIp ?? '');
  const [editingIp, setEditingIp] = useState(!device.localIp);
  const [password, setPassword] = useState('123456');
  const [json, setJson] = useState('');
  const [open, setOpen] = useState(false);

  const saveIpMut = useMutation({
    mutationFn: () => accessApi.patchDevice(device.deviceCode, { localIp }),
    onSuccess: () => {
      toast.success('Machine IP saved');
      setEditingIp(false);
      void qc.invalidateQueries({ queryKey: ['access-devices'] });
    },
  });

  function extractEmployees(parsed: unknown): unknown[] {
    if (Array.isArray(parsed)) return parsed;
    const p = parsed as Record<string, unknown>;
    // ZKBio actual response: { data: [...], code: 200, ... }
    if (Array.isArray(p?.data)) return p.data as unknown[];
    // ZKBio Cloud Server alternative shape
    if (Array.isArray((p?.data as Record<string, unknown>)?.dataList)) return (p.data as Record<string, unknown>).dataList as unknown[];
    if (Array.isArray(p?.dataList)) return p.dataList as unknown[];
    if (Array.isArray(p?.employees)) return p.employees as unknown[];
    throw new Error('Could not find employee array in JSON — paste the full response from the machine');
  }

const importMut = useMutation({
    mutationFn: () => {
      let employees: unknown[] = [];
      try {
        employees = extractEmployees(JSON.parse(json));
      } catch (e) {
        throw new Error((e as Error).message);
      }
      return zkbioApi.import(device.machineSn ?? device.deviceCode, employees);
    },
    onSuccess: (res) => {
      toast.success(`Imported ${res.inserted} new, updated ${res.updated} of ${res.total} employees`);
      setJson('');
      setOpen(false);
      onImported();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Machine requires Origin + Referer headers matching its own domain.
  // curl.exe (Windows 10+) works; PowerShell Invoke-RestMethod can't spoof Origin.
  const curlCmd = localIp
    ? `curl.exe "${`http://${localIp}/getEmployeeList`}" -H "Content-Type: application/json" -H "Origin: http://${localIp}" -H "Referer: http://${localIp}/html/employee.html" -H "X-Requested-With: XMLHttpRequest" -b "lang=en; pwd=${password}" --data-raw "{\\"password\\":\\"${password}\\"}" --insecure | clip`
    : null;

  // Browser console snippet — run from machine's own page (http://[IP]/html/employee.html)
  // Uses relative URL so Origin is correct automatically.
  const consoleSnippet = password
    ? `fetch('/getEmployeeList',{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'XMLHttpRequest'},body:JSON.stringify({password:'${password}'})}).then(r=>r.json()).then(d=>{navigator.clipboard.writeText(JSON.stringify(d)).then(()=>alert('✅ Copied! Go back and paste in the web admin.'))})`
    : null;

  const [copied, setCopied] = useState<'ps' | 'curl' | null>(null);
  function copyCmd(text: string, which: 'ps' | 'curl') {
    void navigator.clipboard.writeText(text);
    setCopied(which);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div className="mb-4 rounded-xl border border-white/[0.07] bg-white/[0.02] overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.03] transition-colors"
      >
        <span className="text-xs font-bold text-slate-300">Import from Machine</span>
        <svg
          className={`w-4 h-4 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
        >
          <path d="M6 9l6 6 6-6"/>
        </svg>
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-white/[0.06] pt-4 flex flex-col gap-4">
          {/* IP + Password row */}
          <div className="flex items-end gap-4 flex-wrap">
            <div className="flex-1 min-w-40">
              <p className="text-[11px] font-semibold text-dimmed mb-1.5">Machine LAN IP</p>
              {editingIp ? (
                <div className="flex items-center gap-2">
                  <input
                    value={localIp}
                    onChange={e => setLocalIp(e.target.value)}
                    placeholder="e.g. 192.168.1.92"
                    className="flex-1 text-xs bg-white/[0.06] border border-white/[0.12] rounded-lg px-3 py-1.5 text-slate-200 outline-none focus:border-purple-500/50 font-mono"
                  />
                  <Button size="sm" loading={saveIpMut.isPending} onClick={() => saveIpMut.mutate()}>Save</Button>
                  {device.localIp && (
                    <button onClick={() => { setLocalIp(device.localIp ?? ''); setEditingIp(false); }} className="text-xs text-slate-500 hover:text-slate-300">Cancel</button>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono text-slate-300">{localIp || '—'}</span>
                  <button onClick={() => setEditingIp(true)} className="text-[11px] text-purple-400 hover:text-purple-300">Edit</button>
                </div>
              )}
            </div>
            <div className="w-36">
              <p className="text-[11px] font-semibold text-dimmed mb-1.5">Machine Password</p>
              <input
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="123456"
                className="w-full text-xs bg-white/[0.06] border border-white/[0.12] rounded-lg px-3 py-1.5 text-slate-200 outline-none focus:border-purple-500/50 font-mono"
              />
            </div>
          </div>

          {localIp ? (
            <div className="space-y-3">
              {/* Option A — Browser console (easiest) */}
              <div className="rounded-lg bg-black/30 border border-white/[0.07] overflow-hidden">
                <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/[0.06]">
                  <div>
                    <span className="text-[10px] font-bold text-purple-400 tracking-wider">OPTION A · BROWSER CONSOLE</span>
                    <span className="ml-2 text-[10px] text-muted">Easiest — no terminal needed</span>
                  </div>
                  <button
                    onClick={() => consoleSnippet && copyCmd(consoleSnippet, 'ps')}
                    className="text-[10px] font-semibold text-purple-400 hover:text-purple-300 transition-colors"
                  >
                    {copied === 'ps' ? '✓ Copied!' : 'Copy'}
                  </button>
                </div>
                <div className="px-3 py-2 space-y-1.5">
                  <p className="text-[10px] text-muted">
                    1. Open{' '}
                    <a href={`http://${localIp}/html/employee.html`} target="_blank" rel="noreferrer"
                      className="text-purple-400 hover:text-purple-300 underline font-mono">
                      http://{localIp}/html/employee.html
                    </a>{' '}
                    in your LAN browser
                  </p>
                  <p className="text-[10px] text-muted">2. Press <kbd className="bg-white/10 px-1 rounded text-slate-300">F12</kbd> → Console tab → paste the script below → Enter</p>
                  <p className="text-[10px] text-muted">3. When alert says "Copied!" come back here and paste below</p>
                  <pre className="mt-1 text-[9px] text-slate-300 font-mono whitespace-pre-wrap break-all leading-relaxed bg-black/20 rounded px-2 py-1.5">
                    {consoleSnippet}
                  </pre>
                </div>
              </div>

              {/* Option B — curl.exe */}
              <div className="rounded-lg bg-black/30 border border-white/[0.07] overflow-hidden">
                <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/[0.06]">
                  <div>
                    <span className="text-[10px] font-bold text-green-400 tracking-wider">OPTION B · CMD / POWERSHELL</span>
                    <span className="ml-2 text-[10px] text-muted">Run on any LAN PC, result copies to clipboard</span>
                  </div>
                  <button
                    onClick={() => curlCmd && copyCmd(curlCmd, 'curl')}
                    className="text-[10px] font-semibold text-purple-400 hover:text-purple-300 transition-colors"
                  >
                    {copied === 'curl' ? '✓ Copied!' : 'Copy'}
                  </button>
                </div>
                <pre className="px-3 py-2 text-[9px] text-slate-300 font-mono whitespace-pre-wrap break-all leading-relaxed">
                  {curlCmd}
                </pre>
                <p className="px-3 pb-2 text-[10px] text-muted">After running, open Notepad → Ctrl+V, copy everything, paste below.</p>
              </div>
            </div>
          ) : (
            <p className="text-xs text-amber-400/80">Enter and save the Machine LAN IP above to generate fetch instructions.</p>
          )}

          {/* JSON paste area */}
          <div>
            <p className="text-[11px] font-semibold text-dimmed mb-1.5">Paste JSON response here</p>
            <textarea
              value={json}
              onChange={e => setJson(e.target.value)}
              rows={5}
              placeholder={'{\n  "code": 0,\n  "data": { "dataList": [...] }\n}'}
              className="w-full text-xs font-mono bg-white/[0.05] border border-white/[0.1] rounded-lg px-3 py-2 text-slate-300 outline-none focus:border-purple-500/40 resize-y"
            />
          </div>

          <div className="flex items-center gap-3">
            <Button
              size="sm"
              disabled={!json.trim()}
              loading={importMut.isPending}
              onClick={() => importMut.mutate()}
            >
              Parse & Import
            </Button>
            <span className="text-[11px] text-muted">Existing employees will be updated, not duplicated.</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Employee table row ─────────────────────────────────────────────────────
function EmployeeRow({
  emp,
  branchId,
  onLinked,
}: {
  emp: ZkbioEmployee;
  branchId?: string;
  onLinked: () => void;
}) {
  const [linking, setLinking] = useState(false);

  const linkMut = useMutation({
    mutationFn: (memberId: string | null) =>
      zkbioApi.link(emp.deviceSn, emp.machineUserId, memberId),
    onSuccess: () => {
      setLinking(false);
      onLinked();
    },
    onError: () => toast.error('Link failed'),
  });

  return (
    <tr className="border-b border-white/[0.04] last:border-0 hover:bg-purple-500/[0.03]">
      <td className="px-5 py-3 text-xs font-mono text-slate-400">{emp.machineUserId}</td>
      <td className="px-5 py-3">
        <p className="text-sm text-slate-200 font-medium">{emp.name}</p>
      </td>
      <td className="px-5 py-3 text-xs text-muted">{fmtDate(emp.importedAt)}</td>
      <td className="px-5 py-3" style={{ minWidth: 220 }}>
        {linking ? (
          <MemberSearch
            branchId={branchId}
            onSelect={m => linkMut.mutate(m._id)}
            onCancel={() => setLinking(false)}
          />
        ) : emp.memberId ? (
          <LinkedMemberLabel memberId={emp.memberId} onUnlink={() => linkMut.mutate(null)} />
        ) : (
          <button
            onClick={() => setLinking(true)}
            className="text-xs text-purple-400 hover:text-purple-300 font-semibold"
          >
            + Link member
          </button>
        )}
      </td>
    </tr>
  );
}

// Fetches and shows the linked member's name inline
function LinkedMemberLabel({ memberId, onUnlink }: { memberId: string; onUnlink: () => void }) {
  const { data: member, isLoading } = useQuery({
    queryKey: ['member', memberId],
    queryFn:  () => memberApi.get(memberId),
    staleTime: 5 * 60_000,
  });

  if (isLoading) return <span className="text-xs text-muted">Loading…</span>;

  return (
    <div className="flex items-center gap-2">
      <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
        {member ? `${member.firstName} ${member.lastName}` : memberId}
      </span>
      <button
        onClick={onUnlink}
        className="text-[10px] text-slate-600 hover:text-red-400 transition-colors"
        title="Unlink member"
      >
        ✕
      </button>
    </div>
  );
}

// ── U5 employee row ────────────────────────────────────────────────────────
function U5EmployeeRow({
  emp,
  deviceId,
  branchId,
  onLinked,
}: {
  emp: { u5UserId: string; name: string; id_number?: string; accessCardNumber?: string; hasFace?: boolean; linkedMemberId?: string };
  deviceId: string;
  branchId?: string;
  onLinked: () => void;
}) {
  const [linking, setLinking] = useState(false);

  const linkMut = useMutation({
    mutationFn: (memberId: string | null) =>
      accessApi.linkU5Employee(deviceId, emp.u5UserId, {
        memberId,
        accessCardNumber: memberId ? emp.accessCardNumber : undefined,
        hasFace: memberId ? emp.hasFace : undefined,
      }),
    onSuccess: () => { setLinking(false); onLinked(); },
    onError: () => toast.error('Link failed'),
  });

  const typeLabel = emp.hasFace && emp.accessCardNumber ? 'Face + Card'
    : emp.hasFace ? 'Face'
    : emp.accessCardNumber ? 'Card'
    : '—';

  return (
    <tr className="border-b border-white/[0.04] last:border-0 hover:bg-purple-500/[0.03]">
      <td className="px-5 py-3 text-xs font-mono text-slate-400">{emp.u5UserId}</td>
      <td className="px-5 py-3">
        <p className="text-sm text-slate-200 font-medium">{emp.name}</p>
        {emp.id_number && <p className="text-[11px] text-muted font-mono">{emp.id_number}</p>}
      </td>
      <td className="px-5 py-3">
        <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
          (emp.hasFace && emp.accessCardNumber) ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
          : emp.hasFace ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
          : emp.accessCardNumber ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
          : 'text-muted'
        }`}>{typeLabel}</span>
        {emp.accessCardNumber && (
          <p className="text-[11px] text-muted font-mono mt-0.5">{emp.accessCardNumber}</p>
        )}
      </td>
      <td className="px-5 py-3" style={{ minWidth: 220 }}>
        {linking ? (
          <MemberSearch
            branchId={branchId}
            onSelect={m => linkMut.mutate(m._id)}
            onCancel={() => setLinking(false)}
          />
        ) : emp.linkedMemberId ? (
          <LinkedMemberLabel memberId={emp.linkedMemberId} onUnlink={() => linkMut.mutate(null)} />
        ) : (
          <button onClick={() => setLinking(true)} className="text-xs text-purple-400 hover:text-purple-300 font-semibold">
            + Link member
          </button>
        )}
      </td>
    </tr>
  );
}

type U5Device = { deviceId: string; name: string; isOnline: boolean; ipAddress?: string };

// ── U5 machine section ─────────────────────────────────────────────────────
function U5Section({
  devices,
  branchId,
}: {
  devices: U5Device[];
  branchId?: string;
}) {
  const qc = useQueryClient();
  const [activeId, setActiveId] = useState('');
  const active: U5Device | undefined = devices.find(d => d.deviceId === activeId) ?? devices[0];

  const { data: u5Data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['u5-employees-full', active?.deviceId],
    queryFn:  () => accessApi.u5Employees(active!.deviceId),
    enabled:  !!active?.deviceId && !!active?.ipAddress,
    staleTime: 0,
  });

  const employees = u5Data?.employees ?? [];

  // Determine who's already linked using member lookup by machineUserId
  const { data: members = [] } = useQuery({
    queryKey: ['members-for-u5', active?.deviceId],
    queryFn:  async () => {
      const r = await import('../api/members').then(m => m.memberApi.list({ branchId, limit: 200 }));
      return r.data ?? [];
    },
    enabled: !!branchId,
    staleTime: 30_000,
  });

  const linkedMap = new Map(
    members.flatMap(m =>
      (m.machineUsers ?? [])
        .filter((u: { deviceCode: string; machineUserId: string }) => u.deviceCode === active?.deviceId)
        .map((u: { deviceCode: string; machineUserId: string }) => [u.machineUserId, m._id] as [string, string]),
    ),
  );

  if (!active) return null;

  return (
    <div className="mt-8">
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-sm font-bold text-slate-300">U5 Machine Employees</h2>
        <span className="text-[11px] text-muted">(RFID card + face users)</span>
      </div>

      {devices.length > 1 && (
        <div className="flex items-center gap-1 mb-4 p-1 bg-white/[0.04] border border-white/[0.07] rounded-xl w-fit">
          {devices.map(d => (
            <button
              key={d.deviceId}
              onClick={() => setActiveId(d.deviceId)}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                active.deviceId === d.deviceId ? 'bg-purple-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${d.isOnline ? 'bg-emerald-400' : 'bg-slate-600'}`} />
              {d.name}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-4 mb-4 px-4 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06]">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${active.isOnline ? 'bg-emerald-400' : 'bg-slate-600'}`} />
        <span className="text-sm font-semibold text-slate-200">{active.name}</span>
        {active.ipAddress && <span className="text-xs font-mono text-muted">{active.ipAddress}</span>}
        {!active.ipAddress && (
          <span className="text-xs text-amber-400/80">No LAN IP stored — cannot sync directly</span>
        )}
      </div>

      <Card>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.06]">
          <div className="flex items-center gap-3">
            <span className="text-sm font-bold text-slate-200">Employees on Machine</span>
            {employees.length > 0 && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-500/10 text-slate-400 border border-slate-600/20">
                {employees.length} total
              </span>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            loading={isFetching}
            disabled={!active.ipAddress}
            onClick={() => void refetch()}
            title={active.ipAddress ? 'Fetch live from machine' : 'No LAN IP configured'}
          >
            {isLoading ? 'Loading…' : 'Sync from Machine'}
          </Button>
        </div>

        {isLoading ? (
          <PageSpinner />
        ) : !active.ipAddress ? (
          <div className="px-5 py-8 text-center">
            <p className="text-sm text-muted">Machine LAN IP not configured.</p>
            <p className="text-xs text-muted mt-1">Set the IP in the device settings to enable direct sync.</p>
          </div>
        ) : employees.length === 0 ? (
          <EmptyState
            title="No employees found"
            description="Click 'Sync from Machine' to fetch the current employee list from the U5 device."
          />
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/[0.06]">
                {['User ID', 'Name', 'Type / Card No.', 'Linked Member'].map(h => (
                  <th key={h} className="text-left text-[11px] font-semibold text-dimmed tracking-widest uppercase px-5 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {employees.map(emp => (
                <U5EmployeeRow
                  key={emp.u5UserId}
                  emp={{ ...emp, linkedMemberId: linkedMap.get(emp.u5UserId) }}
                  deviceId={active.deviceId}
                  branchId={branchId}
                  onLinked={() => {
                    void qc.invalidateQueries({ queryKey: ['members-for-u5', active.deviceId] });
                    void qc.invalidateQueries({ queryKey: ['members'] });
                  }}
                />
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <div className="mt-3 text-xs text-muted leading-relaxed">
        Linking a card employee sets the member's RFID card ID. Linking a face employee marks them as face-enrolled.
        Attendance records match via Machine User ID → Member.
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function FaceMachines() {
  const { selectedBranchId } = useAuthStore();
  const qc = useQueryClient();

  const { data: devices = [], isLoading: devicesLoading } = useQuery({
    queryKey: ['access-devices', selectedBranchId],
    queryFn:  () => accessApi.devices(selectedBranchId ?? undefined),
    enabled:  !!selectedBranchId,
  });

  const zkbioDevices = devices.filter(d => d.machineSn && d.make !== 'u5');
  const u5Devices    = devices.filter(d => d.make === 'u5' || (!d.make && !!d.ipAddress));

  const [activeDeviceCode, setActiveDeviceCode] = useState<string>('');
  const activeDevice = zkbioDevices.find(d => d.deviceId === activeDeviceCode) ?? zkbioDevices[0];

  const { data: employees = [], isLoading: empLoading, refetch } = useQuery({
    queryKey: ['zkbio-employees', activeDevice?.machineSn],
    queryFn:  () => zkbioApi.list(activeDevice!.machineSn!),
    enabled:  !!activeDevice?.machineSn,
  });

  const linked   = employees.filter(e => e.memberId).length;
  const unlinked = employees.length - linked;

  if (devicesLoading) return <Layout title="Face Machines"><PageSpinner /></Layout>;

  if (zkbioDevices.length === 0 && u5Devices.length === 0) {
    return (
      <Layout title="Face Machines">
        <Card>
          <EmptyState
            title="No machines configured"
            description="Add a ZKBio or U5 machine via the Machine Installation wizard in the sidebar."
          />
        </Card>
      </Layout>
    );
  }

  return (
    <Layout title="Face Machines">
      {/* ── ZKBio face recognition section ── */}
      {zkbioDevices.length > 0 && (
        <>
          {zkbioDevices.length > 1 && (
            <div className="flex items-center gap-1 mb-5 p-1 bg-white/[0.04] border border-white/[0.07] rounded-xl w-fit">
              {zkbioDevices.map(d => (
                <button
                  key={d._id}
                  onClick={() => setActiveDeviceCode(d.deviceId)}
                  className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    (activeDevice?.deviceId === d.deviceId)
                      ? 'bg-purple-600 text-white shadow'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${d.isOnline ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                  {d.name}
                </button>
              ))}
            </div>
          )}

          {activeDevice && (
            <>
              <div className="flex items-center gap-4 mb-5 px-4 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${activeDevice.isOnline ? 'bg-emerald-400 blink' : 'bg-slate-600'}`} />
                <span className="text-sm font-semibold text-slate-200">{activeDevice.name}</span>
                {activeDevice.machineSn && (
                  <span className="text-xs font-mono text-muted">{activeDevice.machineSn}</span>
                )}
                <span className={`ml-auto text-xs font-semibold ${activeDevice.isOnline ? 'text-emerald-400' : 'text-slate-500'}`}>
                  {activeDevice.isOnline ? 'Live' : 'Offline'}
                </span>
              </div>

              <ImportPanel
                device={{
                  deviceId:   activeDevice.deviceId,
                  deviceCode: activeDevice.deviceId,
                  machineSn:  activeDevice.machineSn,
                  localIp:    activeDevice.localIp,
                }}
                onImported={() => void refetch()}
              />

              <Card>
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.06]">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-slate-200">Machine Employees</span>
                    {employees.length > 0 && (
                      <>
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          {linked} linked
                        </span>
                        {unlinked > 0 && (
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                            {unlinked} unlinked
                          </span>
                        )}
                      </>
                    )}
                  </div>
                  <Button variant="outline" size="sm" onClick={() => void refetch()}>Refresh</Button>
                </div>

                {empLoading ? (
                  <PageSpinner />
                ) : employees.length === 0 ? (
                  <EmptyState
                    title="No employees imported yet"
                    description="Use the Import panel above to load employees from the machine, then link each one to a member."
                  />
                ) : (
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-white/[0.06]">
                        {['User ID', 'Name on Machine', 'Imported', 'Linked Member'].map(h => (
                          <th key={h} className="text-left text-[11px] font-semibold text-dimmed tracking-widest uppercase px-5 py-3">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {employees.map(emp => (
                        <EmployeeRow
                          key={emp._id}
                          emp={emp}
                          branchId={selectedBranchId ?? undefined}
                          onLinked={() => {
                            void refetch();
                            void qc.invalidateQueries({ queryKey: ['members'] });
                          }}
                        />
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>

              <div className="mt-4 text-xs text-muted leading-relaxed">
                <p className="font-semibold text-slate-500 mb-1">How attendance linking works</p>
                <p>
                  When someone shows their face at the machine, it pushes an attendance record with the machine's
                  User ID. If that User ID is linked to a member here, the access event will show the member's name
                  in Access Monitor and Reports. Unlinked entries appear as "visitor" with just the machine ID.
                </p>
              </div>
            </>
          )}
        </>
      )}

      {/* ── U5 card + face section ── */}
      {u5Devices.length > 0 && (
        <U5Section devices={u5Devices} branchId={selectedBranchId ?? undefined} />
      )}
    </Layout>
  );
}
