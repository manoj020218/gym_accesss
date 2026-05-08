import React, { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { productApi } from '../../api/products';
import { useAuthStore } from '../../store/auth';
import { toast } from '../../store/toast';

interface Props { productId?: string; onSuccess: () => void; }

export default function ProductForm({ productId, onSuccess }: Props) {
  const { selectedBranchId } = useAuthStore();
  const [form, setForm] = useState({
    name: '', sku: '', category: '', price: '', costPrice: '',
    stockQty: '0', minStockLevel: '5', branchId: selectedBranchId ?? '',
  });

  const { data: existing } = useQuery({
    queryKey: ['product-item', productId],
    queryFn:  () => productApi.get(productId!),
    enabled:  !!productId,
  });

  useEffect(() => {
    if (existing) {
      setForm({
        name:          existing.name,
        sku:           existing.sku ?? '',
        category:      existing.category ?? '',
        price:         String(existing.price),
        costPrice:     String(existing.costPrice ?? ''),
        stockQty:      String(existing.stockQty),
        minStockLevel: String(existing.minStockLevel),
        branchId:      existing.branchId,
      });
    }
  }, [existing]);

  const mut = useMutation({
    mutationFn: () => {
      const body = {
        ...form,
        price:         Number(form.price),
        costPrice:     form.costPrice ? Number(form.costPrice) : undefined,
        stockQty:      Number(form.stockQty),
        minStockLevel: Number(form.minStockLevel),
      };
      return productId ? productApi.update(productId, body) : productApi.create(body);
    },
    onSuccess: () => {
      toast.success(productId ? 'Product updated' : 'Product added');
      onSuccess();
    },
  });

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <form onSubmit={(e) => { e.preventDefault(); mut.mutate(); }} className="flex flex-col gap-4">
      <Input label="Product Name" value={form.name} onChange={set('name')} autoFocus />
      <div className="grid grid-cols-2 gap-4">
        <Input label="SKU (optional)" value={form.sku} onChange={set('sku')} />
        <Input label="Category (optional)" value={form.category} onChange={set('category')} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Input label="Selling Price (₹)" type="number" value={form.price} onChange={set('price')} />
        <Input label="Cost Price (₹)" type="number" value={form.costPrice} onChange={set('costPrice')} />
      </div>
      {!productId && (
        <div className="grid grid-cols-2 gap-4">
          <Input label="Opening Stock" type="number" value={form.stockQty} onChange={set('stockQty')} />
          <Input label="Min Stock Level" type="number" value={form.minStockLevel} onChange={set('minStockLevel')} />
        </div>
      )}
      <div className="flex gap-3 justify-end pt-1">
        <Button type="submit" loading={mut.isPending}>
          {productId ? 'Save Changes' : 'Add Product'}
        </Button>
      </div>
    </form>
  );
}
