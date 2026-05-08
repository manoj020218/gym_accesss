import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Layout } from '../../components/layout/Layout';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { PageSpinner } from '../../components/ui/Spinner';
import { EmptyState } from '../../components/ui/EmptyState';
import { Modal } from '../../components/ui/Modal';
import { productApi } from '../../api/products';
import { useAuthStore } from '../../store/auth';
import { toast } from '../../store/toast';
import { fmtCurrency } from '../../utils/format';
import { useRole } from '../../hooks/useRole';
import ProductForm from './ProductForm';

export default function ProductsList() {
  const { selectedBranchId } = useAuthStore();
  const branchId = selectedBranchId ?? undefined;
  const qc = useQueryClient();
  const { isManager } = useRole();

  const [showForm, setShowForm]       = useState(false);
  const [editId, setEditId]           = useState<string | undefined>();
  const [stockInId, setStockInId]     = useState<string | undefined>();
  const [stockQty, setStockQty]       = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['products', branchId, lowStockOnly],
    queryFn:  () => productApi.list({ branchId, lowStock: lowStockOnly || undefined }),
  });

  const stockInMut = useMutation({
    mutationFn: () => productApi.stockIn(stockInId!, Number(stockQty)),
    onSuccess: () => {
      toast.success('Stock updated');
      setStockInId(undefined);
      setStockQty('');
      void qc.invalidateQueries({ queryKey: ['products'] });
    },
  });

  const products = data?.data ?? [];
  const lowCount = products.filter((p) => p.stockQty <= p.minStockLevel).length;

  return (
    <Layout
      title="Products"
      actions={
        isManager ? (
          <Button size="sm" onClick={() => setShowForm(true)}>
            <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Add Product
          </Button>
        ) : undefined
      }
    >
      {/* Low stock banner */}
      {lowCount > 0 && (
        <div className="flex items-center gap-3 bg-amber-500/10 border border-amber-500/25 rounded-xl px-4 py-3 mb-4">
          <svg width="16" height="16" fill="none" stroke="#FBBF24" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
            <path d="M12 9v4M12 17h.01"/>
          </svg>
          <span className="text-sm text-amber-400 font-medium">
            {lowCount} product{lowCount > 1 ? 's' : ''} at or below minimum stock level
          </span>
          <button
            onClick={() => setLowStockOnly((v) => !v)}
            className={`ml-auto text-xs font-semibold px-3 py-1 rounded-lg border transition-all ${
              lowStockOnly
                ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                : 'border-amber-500/30 text-amber-400 hover:bg-amber-500/10'
            }`}
          >
            {lowStockOnly ? 'Show all' : 'Show low stock'}
          </button>
        </div>
      )}

      <Card>
        {isLoading ? (
          <PageSpinner />
        ) : products.length === 0 ? (
          <EmptyState
            title="No products found"
            action={isManager ? <Button size="sm" onClick={() => setShowForm(true)}>Add Product</Button> : undefined}
          />
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/[0.06]">
                {['Product', 'SKU', 'Price', 'Cost', 'Stock', 'Min Stock', isManager ? 'Actions' : ''].filter(Boolean).map((h) => (
                  <th key={h} className="text-left text-[11px] font-semibold text-dimmed tracking-widest uppercase px-5 py-3.5">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {products.map((p) => {
                const isLow = p.stockQty <= p.minStockLevel;
                return (
                  <tr key={p._id} className="border-b border-white/[0.04] hover:bg-purple-500/[0.03] last:border-0">
                    <td className="px-5 py-3.5">
                      <p className="text-sm font-medium text-slate-200">{p.name}</p>
                      {p.category && <p className="text-[11px] text-muted">{p.category}</p>}
                    </td>
                    <td className="px-5 py-3.5 text-xs font-mono text-muted">{p.sku ?? '—'}</td>
                    <td className="px-5 py-3.5 text-sm text-slate-300">{fmtCurrency(p.price)}</td>
                    <td className="px-5 py-3.5 text-sm text-muted">{p.costPrice ? fmtCurrency(p.costPrice) : '—'}</td>
                    <td className="px-5 py-3.5">
                      <span className={`text-sm font-semibold ${isLow ? 'text-amber-400' : 'text-emerald-400'}`}>
                        {p.stockQty}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-sm text-muted">{p.minStockLevel}</td>
                    {isManager && (
                      <td className="px-5 py-3.5">
                        <div className="flex gap-2">
                          <button
                            onClick={() => setStockInId(p._id)}
                            className="text-xs text-cyan-400 hover:text-cyan-300"
                          >
                            Restock
                          </button>
                          <button
                            onClick={() => { setEditId(p._id); setShowForm(true); }}
                            className="text-xs text-purple-400 hover:text-purple-300"
                          >
                            Edit
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {/* Add/Edit Product modal */}
      <Modal open={showForm} onClose={() => { setShowForm(false); setEditId(undefined); }} title={editId ? 'Edit Product' : 'Add Product'}>
        <ProductForm
          productId={editId}
          onSuccess={() => {
            setShowForm(false);
            setEditId(undefined);
            void qc.invalidateQueries({ queryKey: ['products'] });
          }}
        />
      </Modal>

      {/* Stock-in modal */}
      <Modal open={!!stockInId} onClose={() => setStockInId(undefined)} title="Restock Product" width="max-w-sm">
        <Input
          label="Quantity to add"
          type="number"
          value={stockQty}
          onChange={(e) => setStockQty(e.target.value)}
          autoFocus
        />
        <div className="flex gap-3 justify-end mt-5">
          <Button variant="outline" onClick={() => setStockInId(undefined)}>Cancel</Button>
          <Button loading={stockInMut.isPending} onClick={() => stockInMut.mutate()}>
            Add Stock
          </Button>
        </div>
      </Modal>
    </Layout>
  );
}
