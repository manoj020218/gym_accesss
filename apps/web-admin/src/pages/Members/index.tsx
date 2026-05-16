import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Layout } from '../../components/layout/Layout';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Card } from '../../components/ui/Card';
import { Input, Select } from '../../components/ui/Input';
import { PageSpinner } from '../../components/ui/Spinner';
import { EmptyState } from '../../components/ui/EmptyState';
import { Modal } from '../../components/ui/Modal';
import { memberApi } from '../../api/members';
import { accessApi } from '../../api/access';
import { useAuthStore } from '../../store/auth';
import { toast } from '../../store/toast';
import { fmtDate, initials, avatarColor } from '../../utils/format';
import MemberForm from './MemberForm';

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'active', label: 'Active' },
  { value: 'pending', label: 'Pending' },
  { value: 'expired', label: 'Expired' },
  { value: 'frozen', label: 'Frozen' },
  { value: 'blocked', label: 'Blocked' },
];

export default function MembersList() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const qc = useQueryClient();
  const { selectedBranchId } = useAuthStore();

  const [page, setPage]     = useState(1);
  const [search, setSearch] = useState(searchParams.get('search') ?? '');
  const [status, setStatus] = useState('');
  const [showForm, setShowForm] = useState(searchParams.get('new') === '1');

  const { data, isLoading } = useQuery({
    queryKey: ['members', selectedBranchId, status, search, page],
    queryFn:  () =>
      memberApi.list({
        branchId: selectedBranchId ?? undefined,
        status:   status || undefined,
        search:   search || undefined,
        page,
        limit:    20,
      }),
  });

  // Load devices for branch — needed to check machine sync
  const { data: devices = [] } = useQuery({
    queryKey: ['access-devices', selectedBranchId],
    queryFn:  () => accessApi.devices(selectedBranchId ?? undefined),
    enabled:  !!selectedBranchId,
    staleTime: 60_000,
  });
  // sync-status uses the machine's local HTTP API — only valid for U5/LAN devices, not ZKBio cloud
  const firstDevice = devices.find(d => d.ipAddress && d.make !== 'zkteco');

  // Machine sync: compare enrolled members against machine employee list (cached 3 min)
  const { data: syncStatus } = useQuery({
    queryKey: ['sync-status', firstDevice?.deviceId],
    queryFn:  () => accessApi.syncStatus(firstDevice!.deviceId),
    enabled:  !!firstDevice?.deviceId,
    staleTime: 3 * 60 * 1000,
  });
  const missingSet = new Set(syncStatus?.missingFromMachine.map(m => m.memberId) ?? []);

  const blockMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      memberApi.block(id, reason),
    onSuccess: () => {
      toast.success('Member blocked');
      void qc.invalidateQueries({ queryKey: ['members'] });
    },
  });

  const members = data?.data ?? [];
  const total   = data?.total ?? 0;
  const pages   = Math.ceil(total / 20);

  return (
    <Layout
      title="Members"
      actions={
        <Button size="sm" onClick={() => setShowForm(true)}>
          <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Add Member
        </Button>
      }
    >
      {/* Filters */}
      <div className="flex items-center gap-3 mb-5">
        <div className="flex-1 max-w-xs">
          <Input
            placeholder="Search name, phone, member code…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <div className="w-44">
          <Select
            options={STATUS_OPTIONS}
            value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          />
        </div>
        <span className="text-xs text-muted ml-auto">{total.toLocaleString()} members</span>
      </div>

      {/* Orphan banner — machine has entries not linked to any member */}
      {syncStatus && syncStatus.orphans.length > 0 && (
        <div className="mb-3 flex items-center gap-3 px-4 py-2.5 rounded-xl bg-amber-900/20 border border-amber-500/20 text-amber-300 text-xs">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 flex-shrink-0">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <span>
            <strong>{syncStatus.orphans.length}</strong> machine {syncStatus.orphans.length === 1 ? 'entry' : 'entries'} found that are not linked to any member in this software.
            These may be old enrollments or manual additions directly on the device — open each member's profile to review.
          </span>
        </div>
      )}

      {/* Table */}
      <Card>
        {isLoading ? (
          <PageSpinner />
        ) : members.length === 0 ? (
          <EmptyState
            title="No members found"
            description="Try adjusting your filters or add a new member."
            action={<Button size="sm" onClick={() => setShowForm(true)}>Add Member</Button>}
          />
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/[0.06]">
                {['Member', 'Code', 'Phone', 'Status', 'Access', 'Branch', 'Since', ''].map((h) => (
                  <th key={h} className="text-left text-[11px] font-semibold text-dimmed tracking-widest uppercase px-5 py-3.5">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr
                  key={m._id}
                  onClick={() => navigate(`/members/${m._id}`)}
                  className="border-b border-white/[0.04] hover:bg-purple-500/[0.04] cursor-pointer transition-colors last:border-0"
                >
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-8 h-8 rounded-[9px] flex items-center justify-center text-xs font-bold text-white flex-shrink-0 bg-gradient-to-br ${avatarColor(m.firstName)}`}
                      >
                        {initials(`${m.firstName} ${m.lastName}`)}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-200">
                          {m.firstName} {m.lastName}
                        </p>
                        {m.email && <p className="text-[11px] text-muted">{m.email}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-xs font-mono text-slate-400">{m.memberCode}</td>
                  <td className="px-5 py-3.5 text-sm text-slate-400">{m.phone}</td>
                  <td className="px-5 py-3.5">
                    <Badge variant={m.status as Parameters<typeof Badge>[0]['variant']}>{m.status}</Badge>
                  </td>
                  <td className="px-5 py-3.5">
                    {m.faceEnrolled ? (
                      missingSet.has(m._id) ? (
                        <span className="flex items-center gap-1 text-[11px] font-medium text-amber-400" title="Enrolled in software but not found on machine">
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                          Missing
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-400">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                          Active
                        </span>
                      )
                    ) : (
                      <span className="text-[11px] text-slate-600">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-xs text-muted">{m.branchId}</td>
                  <td className="px-5 py-3.5 text-xs text-muted">{fmtDate(m.createdAt)}</td>
                  <td className="px-5 py-3.5">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/members/${m._id}`);
                      }}
                      className="text-xs text-purple-400 hover:text-purple-300"
                    >
                      View →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Pagination */}
        {pages > 1 && (
          <div className="flex items-center justify-between px-5 py-3.5 border-t border-white/[0.06]">
            <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
              ← Prev
            </Button>
            <span className="text-xs text-muted">Page {page} of {pages}</span>
            <Button variant="outline" size="sm" disabled={page === pages} onClick={() => setPage((p) => p + 1)}>
              Next →
            </Button>
          </div>
        )}
      </Card>

      {/* Add Member modal */}
      <Modal open={showForm} onClose={() => { setShowForm(false); setSearchParams({}); }} title="Add New Member">
        <MemberForm
          onSuccess={() => {
            setShowForm(false);
            setSearchParams({});
            void qc.invalidateQueries({ queryKey: ['members'] });
          }}
        />
      </Modal>

      {/* Suppress unused */}
      {blockMut.isPending && null}
    </Layout>
  );
}
