import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Layout } from '../components/layout/Layout';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal, ConfirmModal } from '../components/ui/Modal';
import { Badge } from '../components/ui/Badge';
import { PageSpinner } from '../components/ui/Spinner';
import { branchApi, type Branch } from '../api/branches';
import { useAuthStore } from '../store/auth';
import { useRole } from '../hooks/useRole';
import { toast } from '../store/toast';
import { api } from '../api/client';
import { fmtDate } from '../utils/format';

type Tab = 'branches' | 'profile' | 'system';

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
    { id: 'profile' as Tab, label: 'My Profile' },
    { id: 'system'  as Tab, label: 'System Health' },
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
