import { useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';
import { useAuthStore } from '../stores/authStore';
import { Plus, Trash2, X, Leaf, AlertCircle } from 'lucide-react';

interface GhgEntry {
  id: string;
  scope: number;
  category_id: number | null;
  scope3_stream: string | null;
  source_description: string;
  activity_data: number;
  activity_unit: string;
  emission_factor: number;
  emission_factor_unit: string;
  co2e_kg: number;
  reporting_period_start: string;
  reporting_period_end: string;
  data_quality: string;
  created_by_name: string | null;
}

interface Scope3Cat {
  id: number;
  name: string;
  stream: string;
}

const emptyForm = {
  scope: '3',
  category_id: '',
  source_description: '',
  activity_data: '',
  activity_unit: '',
  emission_factor: '',
  emission_factor_unit: 'kgCO2e',
  emission_factor_source: '',
  reporting_period_start: '',
  reporting_period_end: '',
  data_quality: 'estimated',
  methodology_notes: '',
};

const scopeStyles: Record<number, { badge: string; gradient: string; border: string }> = {
  1: { badge: 'bg-red-50 text-red-700 border-red-100', gradient: 'from-red-500 to-rose-400', border: 'border-red-400' },
  2: { badge: 'bg-amber-50 text-amber-700 border-amber-100', gradient: 'from-amber-500 to-yellow-400', border: 'border-amber-400' },
  3: { badge: 'bg-blue-50 text-blue-700 border-blue-100', gradient: 'from-blue-500 to-sky-400', border: 'border-blue-400' },
};

export function CarbonPage() {
  const { user } = useAuthStore();
  const canEdit = user?.role === 'Admin' || user?.role === 'User';

  const [entries, setEntries] = useState<GhgEntry[]>([]);
  const [categories, setCategories] = useState<Scope3Cat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [scopeFilter, setScopeFilter] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const [report, setReport] = useState<any>(null);

  useEffect(() => {
    fetchEntries();
    fetchCategories();
    fetchReport();
  }, [scopeFilter]);

  async function fetchEntries() {
    setLoading(true);
    try {
      const res = await apiRequest<{ success: boolean; data: GhgEntry[] }>(
        '/api/ghg/entries',
        { params: { scope: scopeFilter || undefined } },
      );
      setEntries(res.data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function fetchCategories() {
    try {
      const res = await apiRequest<{ success: boolean; data: Scope3Cat[] }>('/api/ghg/categories');
      setCategories(res.data);
    } catch { /* ignore */ }
  }

  async function fetchReport() {
    try {
      const res = await apiRequest<{ success: boolean; totals: any }>('/api/ghg/report');
      setReport(res.totals);
    } catch { /* ignore */ }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this emission entry?')) return;
    try {
      await apiRequest(`/api/ghg/entries/${id}`, { method: 'DELETE' });
      fetchEntries();
      fetchReport();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleSave() {
    if (!form.source_description || !form.activity_data || !form.activity_unit ||
        !form.emission_factor || !form.reporting_period_start || !form.reporting_period_end) {
      setError('Please fill all required fields');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await apiRequest('/api/ghg/entries', {
        method: 'POST',
        body: {
          scope: parseInt(form.scope),
          category_id: form.scope === '3' ? parseInt(form.category_id) || null : null,
          source_description: form.source_description,
          activity_data: parseFloat(form.activity_data),
          activity_unit: form.activity_unit,
          emission_factor: parseFloat(form.emission_factor),
          emission_factor_unit: form.emission_factor_unit,
          emission_factor_source: form.emission_factor_source || null,
          reporting_period_start: form.reporting_period_start,
          reporting_period_end: form.reporting_period_end,
          data_quality: form.data_quality,
          methodology_notes: form.methodology_notes || null,
        },
      });
      setShowForm(false);
      setForm(emptyForm);
      fetchEntries();
      fetchReport();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const scopeLabel = (s: number) => s === 1 ? 'Scope 1' : s === 2 ? 'Scope 2' : 'Scope 3';

  const summaryCards = report ? [
    { label: 'Total Emissions', value: report.total_kg, gradient: 'from-gray-700 to-gray-500', isMain: true },
    { label: 'Scope 1 — Direct', value: report.scope1_kg, ...scopeStyles[1] },
    { label: 'Scope 2 — Energy', value: report.scope2_kg, ...scopeStyles[2] },
    { label: 'Scope 3 — Value Chain', value: report.scope3_kg, ...scopeStyles[3] },
  ] : [];

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="page-title">Carbon Accounting</h1>
          <p className="page-subtitle">GHG Protocol compliant emission tracking</p>
        </div>
        {canEdit && (
          <button
            onClick={() => { setForm(emptyForm); setShowForm(true); setError(''); }}
            className="btn-primary"
          >
            <Plus size={16} /> Add Entry
          </button>
        )}
      </div>

      {/* Summary cards */}
      {report && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {summaryCards.map((c, i) => (
            <div
              key={c.label}
              className="stat-card p-5 animate-slide-up"
              style={{ animationDelay: `${i * 0.05}s`, animationFillMode: 'both' }}
            >
              <div className="flex items-center gap-2 mb-2">
                <div className={`w-2.5 h-2.5 rounded-full bg-gradient-to-br ${c.gradient}`} />
                <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">{c.label}</span>
              </div>
              <p className="text-2xl font-bold text-gray-900 tabular-nums">
                {(c.value || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}
                <span className="text-xs font-normal text-gray-400 ml-1.5">kg CO₂e</span>
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Scope filter */}
      <div className="mb-5">
        <select
          value={scopeFilter}
          onChange={(e) => setScopeFilter(e.target.value)}
          className="input-base w-auto"
        >
          <option value="">All Scopes</option>
          <option value="1">Scope 1</option>
          <option value="2">Scope 2</option>
          <option value="3">Scope 3</option>
        </select>
      </div>

      {/* Entries table */}
      <div className="table-container">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="table-head">
              <tr>
                <th className="text-left px-4 py-3">Scope</th>
                <th className="text-left px-4 py-3">Source</th>
                <th className="text-right px-4 py-3">Activity</th>
                <th className="text-right px-4 py-3">EF</th>
                <th className="text-right px-4 py-3">CO₂e (kg)</th>
                <th className="text-left px-4 py-3">Period</th>
                <th className="text-left px-4 py-3">Quality</th>
                {canEdit && <th className="w-12 px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: canEdit ? 8 : 7 }).map((_, j) => (
                      <td key={j} className="px-4 py-3.5"><div className="skeleton h-4 w-20 rounded" /></td>
                    ))}
                  </tr>
                ))
              ) : entries.length === 0 ? (
                <tr>
                  <td colSpan={canEdit ? 8 : 7} className="text-center py-16">
                    <Leaf size={40} className="mx-auto text-gray-200 mb-3" />
                    <p className="text-sm text-gray-400">No emission entries</p>
                  </td>
                </tr>
              ) : (
                entries.map((e) => (
                  <tr key={e.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-3.5">
                      <span className={`badge border ${scopeStyles[e.scope]?.badge || ''}`}>
                        {scopeLabel(e.scope)}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-gray-900 max-w-xs truncate">{e.source_description}</td>
                    <td className="px-4 py-3.5 text-right text-gray-500 tabular-nums">{e.activity_data} {e.activity_unit}</td>
                    <td className="px-4 py-3.5 text-right text-gray-500 tabular-nums">{e.emission_factor}</td>
                    <td className="px-4 py-3.5 text-right font-semibold text-gray-900 tabular-nums">{e.co2e_kg.toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
                    <td className="px-4 py-3.5 text-gray-400 text-xs tabular-nums">{e.reporting_period_start} → {e.reporting_period_end}</td>
                    <td className="px-4 py-3.5">
                      <span className="badge bg-gray-100 text-gray-600 capitalize">{e.data_quality}</span>
                    </td>
                    {canEdit && (
                      <td className="px-4 py-3.5 text-right">
                        <button onClick={() => handleDelete(e.id)} className="btn-ghost p-1.5 text-gray-300 hover:text-red-500">
                          <Trash2 size={14} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Modal */}
      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-900">New Emission Entry</h2>
              <button onClick={() => setShowForm(false)} className="btn-ghost p-1.5"><X size={18} /></button>
            </div>
            <div className="px-6 py-5 space-y-4 overflow-y-auto flex-1">
              {error && (
                <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-100 text-red-700 rounded-xl text-sm">
                  <AlertCircle size={16} className="shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Scope <span className="text-red-400">*</span></label>
                  <select value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value, category_id: '' })} className="input-base">
                    <option value="1">Scope 1 — Direct</option>
                    <option value="2">Scope 2 — Energy</option>
                    <option value="3">Scope 3 — Value Chain</option>
                  </select>
                </div>
                {form.scope === '3' && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Category <span className="text-red-400">*</span></label>
                    <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })} className="input-base">
                      <option value="">Select...</option>
                      {categories.map((c) => <option key={c.id} value={c.id}>{c.id}. {c.name}</option>)}
                    </select>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Source Description <span className="text-red-400">*</span></label>
                <input type="text" value={form.source_description} onChange={(e) => setForm({ ...form, source_description: e.target.value })}
                  className="input-base" placeholder="e.g. Natural gas combustion - Boiler #1" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Activity Data <span className="text-red-400">*</span></label>
                  <input type="number" step="0.01" value={form.activity_data} onChange={(e) => setForm({ ...form, activity_data: e.target.value })} className="input-base" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Unit <span className="text-red-400">*</span></label>
                  <input type="text" value={form.activity_unit} onChange={(e) => setForm({ ...form, activity_unit: e.target.value })}
                    className="input-base" placeholder="e.g. m³, kWh, km, kg" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Emission Factor <span className="text-red-400">*</span></label>
                  <input type="number" step="0.0001" value={form.emission_factor} onChange={(e) => setForm({ ...form, emission_factor: e.target.value })} className="input-base" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">EF Unit</label>
                  <input type="text" value={form.emission_factor_unit} onChange={(e) => setForm({ ...form, emission_factor_unit: e.target.value })} className="input-base" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Period Start <span className="text-red-400">*</span></label>
                  <input type="date" value={form.reporting_period_start} onChange={(e) => setForm({ ...form, reporting_period_start: e.target.value })} className="input-base" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Period End <span className="text-red-400">*</span></label>
                  <input type="date" value={form.reporting_period_end} onChange={(e) => setForm({ ...form, reporting_period_end: e.target.value })} className="input-base" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Data Quality</label>
                <select value={form.data_quality} onChange={(e) => setForm({ ...form, data_quality: e.target.value })} className="input-base">
                  <option value="measured">Measured</option>
                  <option value="calculated">Calculated</option>
                  <option value="estimated">Estimated</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Methodology Notes</label>
                <textarea rows={2} value={form.methodology_notes} onChange={(e) => setForm({ ...form, methodology_notes: e.target.value })} className="input-base" />
              </div>
            </div>
            <div className="flex justify-end gap-2.5 px-6 py-4 border-t border-gray-100 bg-gray-50/50">
              <button onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="btn-primary">
                {saving ? 'Saving…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
