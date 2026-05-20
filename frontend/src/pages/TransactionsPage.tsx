import { useEffect, useState, useCallback } from 'react';
import { apiRequest } from '../lib/api';
import { useAuthStore } from '../stores/authStore';
import { Plus, Search, X, ArrowLeftRight, ChevronLeft, ChevronRight, AlertCircle } from 'lucide-react';

interface Transaction {
  id: string;
  date: string;
  movementType: string;
  quantity: number;
  unitPrice: number;
  totalValue: number;
  vendor: string | null;
  serialNumber: string | null;
  condition: string | null;
  poNumber: string | null;
  partNumber: string | null;
  partName: string | null;
  technology: string | null;
  category: string | null;
}

const MOVEMENT_TYPES = ['Purchase', 'Sale', 'Redeploy', 'Recycle'] as const;

const emptyForm = {
  date: new Date().toISOString().slice(0, 10),
  movement_type: 'Purchase',
  quantity: '',
  unit_price_usd: '',
  vendor: '',
  part_id: '',
  serial_number: '',
  condition: '',
  po_number: '',
};

const movementColor: Record<string, string> = {
  Purchase: 'bg-blue-50 text-blue-700 border-blue-100',
  Sale: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  Redeploy: 'bg-amber-50 text-amber-700 border-amber-100',
  Recycle: 'bg-violet-50 text-violet-700 border-violet-100',
};

export function TransactionsPage() {
  const { user } = useAuthStore();
  const canEdit = user?.role === 'Admin' || user?.role === 'User';

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('');
  const [offset, setOffset] = useState(0);
  const limit = 50;

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [partsList, setPartsList] = useState<{ id: string; part_number: string }[]>([]);

  const fetchTransactions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{ success: boolean; transactions: Transaction[]; total: number }>(
        '/api/transactions',
        {
          params: {
            search: search || undefined,
            movement_type: filterType || undefined,
            limit,
            offset,
          },
        },
      );
      setTransactions(res.transactions);
      setTotal(res.total);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [search, filterType, offset]);

  useEffect(() => { fetchTransactions(); }, [fetchTransactions]);

  const openCreate = async () => {
    setForm(emptyForm);
    setShowForm(true);
    setError('');
    try {
      const res = await apiRequest<{ success: boolean; parts: { id: string; part_number: string }[] }>(
        '/api/parts',
        { params: { limit: 1000 } },
      );
      setPartsList(res.parts);
    } catch { /* ignore */ }
  };

  const handleSave = async () => {
    if (!form.quantity || parseInt(form.quantity) <= 0) {
      setError('Quantity must be a positive number');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await apiRequest('/api/transactions', {
        method: 'POST',
        body: {
          date: form.date,
          movement_type: form.movement_type,
          quantity: parseInt(form.quantity),
          unit_price_usd: form.unit_price_usd ? parseFloat(form.unit_price_usd) : 0,
          vendor: form.vendor || null,
          part_id: form.part_id || null,
          serial_number: form.serial_number || null,
          condition: form.condition || null,
          po_number: form.po_number || null,
        },
      });
      setShowForm(false);
      fetchTransactions();
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
          <h1 className="page-title">Transactions</h1>
          <p className="page-subtitle">{total} records</p>
        </div>
        {canEdit && (
          <button onClick={openCreate} className="btn-primary">
            <Plus size={16} /> New Transaction
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-5">
        <div className="relative max-w-sm flex-1">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setOffset(0); }}
            className="input-base pl-10"
          />
        </div>
        <select
          value={filterType}
          onChange={(e) => { setFilterType(e.target.value); setOffset(0); }}
          className="input-base w-auto"
        >
          <option value="">All Types</option>
          {MOVEMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="table-container">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="table-head">
              <tr>
                <th className="text-left px-4 py-3">Date</th>
                <th className="text-left px-4 py-3">Type</th>
                <th className="text-left px-4 py-3">Part</th>
                <th className="text-left px-4 py-3">Vendor</th>
                <th className="text-right px-4 py-3">Qty</th>
                <th className="text-right px-4 py-3">Unit Price</th>
                <th className="text-right px-4 py-3">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 7 }).map((_, j) => (
                      <td key={j} className="px-4 py-3.5"><div className="skeleton h-4 w-20 rounded" /></td>
                    ))}
                  </tr>
                ))
              ) : transactions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-16">
                    <ArrowLeftRight size={40} className="mx-auto text-gray-200 mb-3" />
                    <p className="text-sm text-gray-400">No transactions found</p>
                  </td>
                </tr>
              ) : (
                transactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-3.5 font-medium text-gray-900 tabular-nums">{tx.date}</td>
                    <td className="px-4 py-3.5">
                      <span className={`badge border ${movementColor[tx.movementType] || 'bg-gray-100 text-gray-600'}`}>
                        {tx.movementType}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-gray-500">{tx.partNumber || '—'}</td>
                    <td className="px-4 py-3.5 text-gray-500">{tx.vendor || '—'}</td>
                    <td className="px-4 py-3.5 text-right text-gray-900 tabular-nums">{tx.quantity.toLocaleString()}</td>
                    <td className="px-4 py-3.5 text-right text-gray-500 tabular-nums">${tx.unitPrice.toFixed(2)}</td>
                    <td className="px-4 py-3.5 text-right font-semibold text-gray-900 tabular-nums">
                      ${tx.totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {total > limit && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <span className="text-xs text-gray-400 font-medium">
              {offset + 1}–{Math.min(offset + limit, total)} of {total}
            </span>
            <div className="flex gap-1.5">
              <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))} className="btn-ghost px-2.5 py-1.5 text-xs disabled:opacity-30">
                <ChevronLeft size={14} /> Prev
              </button>
              <button disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)} className="btn-ghost px-2.5 py-1.5 text-xs disabled:opacity-30">
                Next <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Create Modal */}
      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-900">New Transaction</h2>
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
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Date <span className="text-red-400">*</span></label>
                  <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="input-base" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Movement Type <span className="text-red-400">*</span></label>
                  <select value={form.movement_type} onChange={(e) => setForm({ ...form, movement_type: e.target.value })} className="input-base">
                    {MOVEMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Quantity <span className="text-red-400">*</span></label>
                  <input type="number" min="1" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} className="input-base" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Unit Price (USD)</label>
                  <input type="number" step="0.01" value={form.unit_price_usd} onChange={(e) => setForm({ ...form, unit_price_usd: e.target.value })} className="input-base" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Part</label>
                <select value={form.part_id} onChange={(e) => setForm({ ...form, part_id: e.target.value })} className="input-base">
                  <option value="">— None —</option>
                  {partsList.map((p) => <option key={p.id} value={p.id}>{p.part_number}</option>)}
                </select>
              </div>
              {[
                { key: 'vendor', label: 'Vendor' },
                { key: 'serial_number', label: 'Serial Number' },
                { key: 'condition', label: 'Condition' },
                { key: 'po_number', label: 'PO Number' },
              ].map(({ key, label }) => (
                <div key={key}>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">{label}</label>
                  <input type="text" value={(form as any)[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} className="input-base" />
                </div>
              ))}
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
