import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { productApi } from '../../api/products';
import { branchApi } from '../../api/branches';
import { useAuthStore } from '../../store/auth';
import { toast } from '../../store/toast';

const MAX_PHOTOS = 3;

function toBase64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = () => res(reader.result as string);
    reader.onerror = rej;
    reader.readAsDataURL(file);
  });
}

interface Props { productId?: string; onSuccess: (id?: string) => void; }

export default function ProductForm({ productId, onSuccess }: Props) {
  const { selectedBranchId } = useAuthStore();
  const fileRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    name: '', sku: '', category: '',
    price: '', gstIncluded: false,
    stockQty: '0', minStockLevel: '5',
    branchId: selectedBranchId ?? '',
  });
  const [photos, setPhotos] = useState<string[]>([]);

  // Fetch branch for GST settings + existing products for category datalist
  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchApi.list(),
  });
  const { data: allProducts } = useQuery({
    queryKey: ['products', form.branchId],
    queryFn: () => productApi.list({ branchId: form.branchId }),
    enabled: !!form.branchId,
  });

  const branch = branches.find(b => b._id === form.branchId);
  const gstEnabled = branch?.gstEnabled ?? false;
  const categories = [...new Set((allProducts?.data ?? []).map(p => p.category).filter(Boolean))] as string[];

  const { data: existing } = useQuery({
    queryKey: ['product-item', productId],
    queryFn: () => productApi.get(productId!),
    enabled: !!productId,
  });

  useEffect(() => {
    if (!existing) return;
    setForm({
      name:          existing.name,
      sku:           existing.sku ?? '',
      category:      existing.category ?? '',
      price:         String(existing.price),
      gstIncluded:   existing.gstIncluded ?? false,
      stockQty:      String(existing.stockQty),
      minStockLevel: String(existing.minStockLevel),
      branchId:      existing.branchId,
    });
    setPhotos(existing.photos ?? []);
  }, [existing]);

  const mut = useMutation({
    mutationFn: () => {
      const body = {
        ...form,
        price:         Number(form.price),
        stockQty:      Number(form.stockQty),
        minStockLevel: Number(form.minStockLevel),
        photos,
      };
      return productId ? productApi.update(productId, body) : productApi.create(body);
    },
    onSuccess: (data) => {
      toast.success(productId ? 'Product updated' : 'Product added');
      onSuccess(data._id);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? 'Could not save product');
    },
  });

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const handlePhotoPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    const remaining = MAX_PHOTOS - photos.length;
    const toProcess = files.slice(0, remaining);
    const b64s = await Promise.all(toProcess.map(toBase64));
    setPhotos(prev => [...prev, ...b64s].slice(0, MAX_PHOTOS));
    if (fileRef.current) fileRef.current.value = '';
  };

  const removePhoto = (idx: number) =>
    setPhotos(prev => prev.filter((_, i) => i !== idx));

  return (
    <form onSubmit={(e) => { e.preventDefault(); mut.mutate(); }} className="flex flex-col gap-4">
      <Input label="Product Name" value={form.name} onChange={set('name')} autoFocus required />

      {/* Category with datalist for suggestions */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-semibold text-slate-400">Category <span className="font-normal text-muted">(optional)</span></label>
        <input
          list="category-suggestions"
          value={form.category}
          onChange={(e) => setForm(f => ({ ...f, category: e.target.value }))}
          placeholder="e.g. Supplements, Accessories…"
          className="w-full bg-white/[0.04] border border-white/[0.1] rounded-xl px-4 py-2.5 text-sm text-slate-200 placeholder:text-muted focus:outline-none focus:border-purple-500/50 transition-colors"
        />
        <datalist id="category-suggestions">
          {categories.map(c => <option key={c} value={c} />)}
        </datalist>
      </div>

      <Input label="SKU (optional)" value={form.sku} onChange={set('sku')} />

      {/* Price + GST */}
      <div className="flex flex-col gap-2">
        <Input label="Selling Price (₹)" type="number" value={form.price} onChange={set('price')} required />
        {gstEnabled && (
          <label className="flex items-center gap-3 px-3 py-2.5 bg-white/[0.03] border border-white/[0.06] rounded-xl cursor-pointer hover:border-purple-500/30 transition-colors">
            <input
              type="checkbox"
              checked={form.gstIncluded}
              onChange={(e) => setForm(f => ({ ...f, gstIncluded: e.target.checked }))}
              className="accent-purple-500"
            />
            <div>
              <p className="text-sm text-slate-200">Price includes GST ({branch?.gstPercent ?? 18}%)</p>
              <p className="text-xs text-muted">
                {form.price && form.gstIncluded
                  ? `Base: ₹${(Number(form.price) / (1 + (branch?.gstPercent ?? 18) / 100)).toFixed(2)} + GST`
                  : 'GST will be added on top of the entered price'}
              </p>
            </div>
          </label>
        )}
      </div>

      {!productId && (
        <div className="grid grid-cols-2 gap-4">
          <Input label="Opening Stock" type="number" value={form.stockQty} onChange={set('stockQty')} />
          <Input label="Min Stock Level" type="number" value={form.minStockLevel} onChange={set('minStockLevel')} />
        </div>
      )}

      {/* Photo upload — max 3 */}
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold text-slate-400">
          Product Photos <span className="font-normal text-muted">(optional, max {MAX_PHOTOS})</span>
        </p>
        <div className="flex gap-3 flex-wrap">
          {photos.map((src, i) => (
            <div key={i} className="relative w-20 h-20 rounded-xl overflow-hidden border border-white/[0.1]">
              <img src={src} alt="" className="w-full h-full object-cover" />
              <button
                type="button"
                onClick={() => removePhoto(i)}
                className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/70 text-white flex items-center justify-center text-xs leading-none hover:bg-red-600/80 transition-colors"
              >
                ×
              </button>
            </div>
          ))}
          {photos.length < MAX_PHOTOS && (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="w-20 h-20 rounded-xl border border-dashed border-white/[0.15] flex flex-col items-center justify-center gap-1 text-muted hover:border-purple-500/40 hover:text-slate-300 transition-colors"
            >
              <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              <span className="text-[10px]">Add photo</span>
            </button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handlePhotoPick}
        />
      </div>

      <div className="flex gap-3 justify-end pt-1">
        <Button type="submit" loading={mut.isPending}>
          {productId ? 'Save Changes' : 'Add Product'}
        </Button>
      </div>
    </form>
  );
}
