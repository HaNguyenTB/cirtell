import { useEffect, useState, useCallback } from 'react';
import { apiRequest } from '../lib/api';
import { useAuthStore } from '../stores/authStore';
import { Plus, Search, X, Package, ChevronLeft, ChevronRight, Pencil, AlertCircle } from 'lucide-react';

interface Part {
  id: string;
  part_number: string;
  manufacturer_part_number: string | null;
  model_name: string | null;
  vendor: string | null;
  technology_type: string | null;
  weight_kg: number | null;
  emission_factor_kg: number | null;
  category: string | null;
  subcategory: string | null;
  description: string | null;
}

const emptyForm = {
  part_number: '',
  manufacturer_part_number: '',
  model_name: '',
  vendor: '',
  technology_type: '',
  weight_kg: '',
  emission_factor_kg: '',
  category: '',
  subcategory: '',
  description: '',
};

export function PartsPage() {
  const { user } = useAuthStore();
  const canEdit = user?.role === 'Admin' || user?.role === 'User';

  const [parts, setParts] = useState<Part[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const limit = 50;

  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const fetchParts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{ success: boolean; parts: Part[]; total: number }>(
        '/api/parts',
        { params: { search: search || undefined, limit, offset } },
      );
      setParts(res.parts);
      setTotal(res.total);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [search, offset]);

  useEffect(() => { fetchParts(); }, [fetchParts]);

  const openCreate = () => {
    setForm(emptyForm);
    setEditId(null);
    setShowForm(true);
    setError('');
  };

  const openEdit = (p: Part) => {
    setForm({
      part_number: p.part_number,
      manufacturer_part_number: p.manufacturer_part_number || '',
      model_name: p.model_name || '',
      vendor: p.vendor || '',
      technology_type: p.technology_type || '',
      weight_kg: p.weight_kg?.toString() || '',
      emission_factor_kg: p.emission_factor_kg?.toString() || '',
      category: p.category || '',
      subcategory: p.subcategory || '',
      description: p.description || '',
    });
    setEditId(p.id);
    setShowForm(true);
    setError('');
  };

  const handleSave = async () => {
    if (!form.part_number.trim()) {
      setError('Part number is required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const body: any = {
        part_number: form.part_number,
        manufacturer_part_number: form.manufacturer_part_number || null,
        model_name: form.model_name || null,
        vendor: form.vendor || null,
        technology_type: form.technology_type || null,
        weight_kg: form.weight_kg ? parseFloat(form.weight_kg) : null,
        emission_factor_kg: form.emission_factor_kg ? parseFloat(form.emission_factor_kg) : null,
        category: form.category || null,
        subcategory: form.subcategory || null,
        description: form.description || null,
      };
      if (editId) {
        await apiRequest(`/api/parts/${editId}`, { method: 'PUT', body });
      } else {
        await apiRequest('/api/parts', { method: 'POST', body });
      }
      setShowForm(false);
      fetchParts();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="page-title">Parts Catalog</h1>
          <p className="page-subtitle">{total} parts registered</p>
        </div>
        {canEdit && (
          <button onClick={openCreate} className="btn-primary">
            <Plus size={16} /> Add Part
          </button>
        )}
      </div>

      {/* Search */}
      <div className="relative mb-5 max-w-sm">
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          placeholder="Search parts..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setOffset(0); }}
          className="input-base pl-10"
        />
      </div>

      {/* Table */}
      <div className="table-container">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="table-head">
              <tr>
                <th className="text-left px-4 py-3">Part Number</th>
                <th className="text-left px-4 py-3">Model</th>
                <th className="text-left px-4 py-3">Vendor</th>
                <th className="text-left px-4 py-3">Category</th>
                <th className="text-left px-4 py-3">Technology</th>
                <th className="text-right px-4 py-3">Weight (kg)</th>
                {canEdit && <th className="w-16 px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: canEdit ? 7 : 6 }).map((_, j) => (
                      <td key={j} className="px-4 py-3.5"><div className="skeleton h-4 w-24 rounded" /></td>
                    ))}
                  </tr>
                ))
              ) : parts.length === 0 ? (
                <tr>
                  <td colSpan={canEdit ? 7 : 6} className="text-center py-16">
                    <Package size={40} className="mx-auto text-gray-200 mb-3" />
                    <p className="text-sm text-gray-400">No parts found</p>
                  </td>
                </tr>
              ) : (
                parts.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-3.5 font-semibold text-gray-900">{p.part_number}</td>
                    <td className="px-4 py-3.5 text-gray-500">{p.model_name || '—'}</td>
                    <td className="px-4 py-3.5 text-gray-500">{p.vendor || '—'}</td>
                    <td className="px-4 py-3.5">
                      {p.category ? (
                        <span className="badge bg-emerald-50 text-emerald-800">{p.category}</span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3.5 text-gray-500">{p.technology_type || '—'}</td>
                    <td className="px-4 py-3.5 text-right text-gray-500 tabular-nums">{p.weight_kg ?? '—'}</td>
                    {canEdit && (
                      <td className="px-4 py-3.5 text-right">
                        <button onClick={() => openEdit(p)} className="btn-ghost p-1.5">
                          <Pencil size={14} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {total > limit && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <span className="text-xs text-gray-400 font-medium">
              {offset + 1}–{Math.min(offset + limit, total)} of {total}
            </span>
            <div className="flex gap-1.5">
              <button
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - limit))}
                className="btn-ghost px-2.5 py-1.5 text-xs disabled:opacity-30"
              >
                <ChevronLeft size={14} /> Prev
              </button>
              <button
                disabled={offset + limit >= total}
                onClick={() => setOffset(offset + limit)}
                className="btn-ghost px-2.5 py-1.5 text-xs disabled:opacity-30"
              >
                Next <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-900">{editId ? 'Edit Part' : 'New Part'}</h2>
              <button onClick={() => setShowForm(false)} className="btn-ghost p-1.5">
                <X size={18} />
              </button>
            </div>
            <div className="px-6 py-5 space-y-4 overflow-y-auto flex-1">
              {error && (
                <div className="flex items-start gap-2 p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-sm">
                  <AlertCircle size={16} className="shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}
              {[
                { key: 'part_number', label: 'Part Number', required: true },
                { key: 'manufacturer_part_number', label: 'Manufacturer Part Number' },
                { key: 'model_name', label: 'Model Name' },
                { key: 'vendor', label: 'Vendor' },
                { key: 'technology_type', label: 'Technology Type' },
                { key: 'category', label: 'Category' },
                { key: 'subcategory', label: 'Subcategory' },
              ].map(({ key, label, required }) => (
                <div key={key}>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                    {label}{required && <span className="text-emerald-500 ml-0.5">*</span>}
                  </label>
                  <input
                    type="text"
                    value={(form as any)[key]}
                    onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                    className="input-base"
                  />
                </div>
              ))}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Weight (kg)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.weight_kg}
                    onChange={(e) => setForm({ ...form, weight_kg: e.target.value })}
                    className="input-base"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Emission Factor (kg)</label>
                  <input
                    type="number"
                    step="0.001"
                    value={form.emission_factor_kg}
                    onChange={(e) => setForm({ ...form, emission_factor_kg: e.target.value })}
                    className="input-base"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Description</label>
                <textarea
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="input-base"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2.5 px-6 py-4 border-t border-gray-100 bg-gray-50/50">
              <button onClick={() => setShowForm(false)} className="btn-secondary">
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving} className="btn-primary">
                {saving ? 'Saving…' : editId ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
