import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Layout } from '../../components/layout/Layout';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Input';
import { PageSpinner } from '../../components/ui/Spinner';
import { EmptyState } from '../../components/ui/EmptyState';
import { Modal } from '../../components/ui/Modal';
import { staffApi } from '../../api/staff';
import { useAuthStore } from '../../store/auth';
import { fmtDate, initials, avatarColor } from '../../utils/format';
import StaffForm from './StaffForm';
import { useRole } from '../../hooks/useRole';

const ROLE_OPTIONS = [
  { value: '', label: 'All Roles' },
  { value: 'manager',     label: 'Manager' },
  { value: 'trainer',     label: 'Trainer' },
  { value: 'receptionist', label: 'Receptionist' },
  { value: 'cleaner',     label: 'Cleaner' },
  { value: 'security',    label: 'Security' },
];

export default function StaffList() {
  const { selectedBranchId } = useAuthStore();
  const branchId = selectedBranchId ?? undefined;
  const qc = useQueryClient();
  const { isManager } = useRole();
  const [role, setRole]         = useState('');
  const [page, setPage]         = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId]     = useState<string | undefined>();

  const { data, isLoading } = useQuery({
    queryKey: ['staff', branchId, role, page],
    queryFn:  () => staffApi.list({ branchId, role: role || undefined, page, limit: 20 }),
  });

  const staff  = data?.data ?? [];
  const total  = data?.total ?? 0;
  const pages  = Math.ceil(total / 20);

  const openEdit = (id: string) => { setEditId(id); setShowForm(true); };
  const closeForm = () => { setShowForm(false); setEditId(undefined); };

  return (
    <Layout
      title="Staff"
      actions={
        isManager ? (
          <Button size="sm" onClick={() => setShowForm(true)}>
            <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Add Staff
          </Button>
        ) : undefined
      }
    >
      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <div className="w-48">
          <Select options={ROLE_OPTIONS} value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }} />
        </div>
        <span className="text-xs text-muted ml-auto">{total.toLocaleString()} staff members</span>
      </div>

      <Card>
        {isLoading ? (
          <PageSpinner />
        ) : staff.length === 0 ? (
          <EmptyState
            title="No staff found"
            action={isManager ? <Button size="sm" onClick={() => setShowForm(true)}>Add Staff</Button> : undefined}
          />
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/[0.06]">
                {['Name', 'Role', 'Phone', 'RFID', 'Status', 'Since', isManager ? '' : ''].filter(Boolean).map((h) => (
                  <th key={h} className="text-left text-[11px] font-semibold text-dimmed tracking-widest uppercase px-5 py-3.5">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {staff.map((s) => (
                <tr key={s._id} className="border-b border-white/[0.04] hover:bg-purple-500/[0.03] last:border-0">
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-8 h-8 rounded-[9px] flex items-center justify-center text-xs font-bold text-white flex-shrink-0 bg-gradient-to-br ${avatarColor(s.firstName)}`}
                      >
                        {initials(`${s.firstName} ${s.lastName}`)}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-200">{s.firstName} {s.lastName}</p>
                        {s.email && <p className="text-[11px] text-muted">{s.email}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    <Badge variant={s.role as Parameters<typeof Badge>[0]['variant']}>{s.role}</Badge>
                  </td>
                  <td className="px-5 py-3.5 text-sm text-slate-400">{s.phone}</td>
                  <td className="px-5 py-3.5 text-xs font-mono text-muted">{s.rfidCardId ?? '—'}</td>
                  <td className="px-5 py-3.5">
                    <Badge variant={s.isActive ? 'active' : 'blocked'}>{s.isActive ? 'Active' : 'Inactive'}</Badge>
                  </td>
                  <td className="px-5 py-3.5 text-xs text-muted">{fmtDate(s.createdAt)}</td>
                  {isManager && (
                    <td className="px-5 py-3.5">
                      <button onClick={() => openEdit(s._id)} className="text-xs text-purple-400 hover:text-purple-300">
                        Edit
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {pages > 1 && (
          <div className="flex items-center justify-between px-5 py-3.5 border-t border-white/[0.06]">
            <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>← Prev</Button>
            <span className="text-xs text-muted">Page {page} of {pages}</span>
            <Button variant="outline" size="sm" disabled={page === pages} onClick={() => setPage((p) => p + 1)}>Next →</Button>
          </div>
        )}
      </Card>

      <Modal open={showForm} onClose={closeForm} title={editId ? 'Edit Staff' : 'Add Staff Member'}>
        <StaffForm
          staffId={editId}
          onSuccess={() => {
            closeForm();
            void qc.invalidateQueries({ queryKey: ['staff'] });
          }}
        />
      </Modal>
    </Layout>
  );
}
