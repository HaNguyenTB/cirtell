import { useEffect, useState, useCallback } from 'react';
import { apiRequest } from '../lib/api';
import { useAuthStore } from '../stores/authStore';
import { Plus, Warehouse as WarehouseIcon, ArrowRightLeft, X, MapPin, Package, AlertCircle } from 'lucide-react';

interface WarehouseItem {
  id: string;
  name: string;
  code: string;
  address: string | null;
  city: string | null;
  country: string | null;
  capacity_units: number | null;
  status: string;
  notes: string | null;
  zone_count: number;
  total_units: number;
}

interface InventoryItem {
  id: string;
  quantity: number;
  condition: string;
  warehouse_name: string;
  warehouse_code: string;
  zone_name: string | null;
  part_number: string;
  model_name: string | null;
  category: string | null;
}

interface Movement {
  id: string;
  movement_type: string;
  quantity: number;
  from_warehouse_name: string | null;
  to_warehouse_name: string | null;
  part_number: string;
  model_name: string | null;
  created_by_name: string | null;
  created_at: string;
  reference: string | null;
  notes: string | null;
}

type Tab = 'warehouses' | 'inventory' | 'movements';

const emptyWarehouseForm = {
  name: '',
  code: '',
  address: '',
  city: '',
  country: '',
  capacity_units: '',
  status: 'active',
  notes: '',
};

const emptyMoveForm = {
  part_id: '',
  quantity: '',
  movement_type: 'Receive',
  from_warehouse_id: '',
  to_warehouse_id: '',
  condition: 'Good',
  reference: '',
  notes: '',
};

const conditionBadge: Record<string, string> = {
  New: 'bg-blue-50 text-blue-700 border-blue-100',
  Good: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  Fair: 'bg-amber-50 text-amber-700 border-amber-100',
  Poor: 'bg-red-50 text-red-700 border-red-100',
  Scrap: 'bg-gray-100 text-gray-500 border-gray-200',
};

const moveBadge: Record<string, string> = {
  Receive: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  Ship: 'bg-orange-50 text-orange-700 border-orange-100',
  Transfer: 'bg-blue-50 text-blue-700 border-blue-100',
  Adjust: 'bg-gray-100 text-gray-600 border-gray-200',
};

export function WarehousePage() {
  const { user } = useAuthStore();
  const canEdit = user?.role === 'Admin' || user?.role === 'User';

  const [tab, setTab] = useState<Tab>('warehouses');
  const [warehouses, setWarehouses] = useState<WarehouseItem[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [showWhForm, setShowWhForm] = useState(false);
  const [whForm, setWhForm] = useState(emptyWarehouseForm);
  const [editWhId, setEditWhId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [showMoveForm, setShowMoveForm] = useState(false);
  const [moveForm, setMoveForm] = useState(emptyMoveForm);

  const fetchWarehouses = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{ success: boolean; warehouses: WarehouseItem[] }>('/api/warehouses');
      setWarehouses(res.warehouses);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchInventory = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{ success: boolean; inventory: InventoryItem[] }>('/api/warehouses/inventory/all');
      setInventory(res.inventory);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchMovements = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{ success: boolean; movements: Movement[] }>('/api/warehouses/movements/list');
      setMovements(res.movements);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'warehouses') fetchWarehouses();
    else if (tab === 'inventory') fetchInventory();
    else fetchMovements();
  }, [tab, fetchWarehouses, fetchInventory, fetchMovements]);

  const saveWarehouse = async () => {
    setSaving(true);
    setError('');
    try {
      const body: Record<string, unknown> = { ...whForm };
      if (body.capacity_units) body.capacity_units = parseInt(body.capacity_units as string);
      else delete body.capacity_units;

      if (editWhId) {
        await apiRequest(`/api/warehouses/${editWhId}`, { method: 'PUT', body });
      } else {
        await apiRequest('/api/warehouses', { method: 'POST', body });
      }
      setShowWhForm(false);
      setWhForm(emptyWarehouseForm);
      setEditWhId(null);
      fetchWarehouses();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const submitMove = async () => {
    setSaving(true);
    setError('');
    try {
      await apiRequest('/api/warehouses/inventory/move', {
        method: 'POST',
        body: {
          ...moveForm,
          quantity: parseInt(moveForm.quantity),
          from_warehouse_id: moveForm.from_warehouse_id || undefined,
          to_warehouse_id: moveForm.to_warehouse_id || undefined,
        },
      });
      setShowMoveForm(false);
      setMoveForm(emptyMoveForm);
      if (tab === 'inventory') fetchInventory();
      else { setTab('movements'); fetchMovements(); }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const openEditWh = (w: WarehouseItem) => {
    setWhForm({
      name: w.name,
      code: w.code,
      address: w.address || '',
      city: w.city || '',
      country: w.country || '',
      capacity_units: w.capacity_units?.toString() || '',
      status: w.status,
      notes: w.notes || '',
    });
    setEditWhId(w.id);
    setShowWhForm(true);
    setError('');
  };

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'warehouses', label: 'Warehouses', count: warehouses.length },
    { key: 'inventory', label: 'Inventory', count: inventory.length },
    { key: 'movements', label: 'Movements', count: movements.length },
  ];

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="page-title">Warehouse Management</h1>
          <p className="page-subtitle">Manage locations, inventory, and movements</p>
        </div>
        {canEdit && (
          <div className="flex gap-2.5">
            <button
              onClick={() => { setWhForm(emptyWarehouseForm); setEditWhId(null); setShowWhForm(true); setError(''); }}
              className="btn-primary"
            >
              <Plus size={16} /> New Warehouse
            </button>
            <button
              onClick={() => { setMoveForm(emptyMoveForm); setShowMoveForm(true); setError(''); }}
              className="btn-secondary"
            >
              <ArrowRightLeft size={16} /> Move Inventory
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 mb-5 bg-red-50 border border-red-100 text-red-700 rounded-xl text-sm animate-fade-in">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <div className="flex gap-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 pb-3 text-sm font-medium border-b-2 transition-colors ${
                tab === t.key
                  ? 'border-emerald-600 text-emerald-700'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          {tab === 'warehouses' ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="stat-card p-5 space-y-3">
                  <div className="skeleton h-5 w-32 rounded" />
                  <div className="skeleton h-3 w-20 rounded" />
                  <div className="skeleton h-4 w-40 rounded" />
                  <div className="flex gap-4"><div className="skeleton h-8 w-14 rounded" /><div className="skeleton h-8 w-14 rounded" /></div>
                </div>
              ))}
            </div>
          ) : (
            <div className="table-container">
              <table className="w-full text-sm">
                <thead className="table-head"><tr>{Array.from({ length: tab === 'inventory' ? 5 : 7 }).map((_, i) => <th key={i} className="px-4 py-3"><div className="skeleton h-3 w-16 rounded" /></th>)}</tr></thead>
                <tbody>{Array.from({ length: 5 }).map((_, i) => <tr key={i}>{Array.from({ length: tab === 'inventory' ? 5 : 7 }).map((_, j) => <td key={j} className="px-4 py-3.5"><div className="skeleton h-4 w-20 rounded" /></td>)}</tr>)}</tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="animate-fade-in">
          {/* Warehouses Tab */}
          {tab === 'warehouses' && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {warehouses.length === 0 ? (
                <div className="col-span-full text-center py-16">
                  <WarehouseIcon size={40} className="mx-auto text-gray-200 mb-3" />
                  <p className="text-sm text-gray-400">No warehouses yet</p>
                  <p className="text-xs text-gray-300 mt-1">Create one to get started</p>
                </div>
              ) : (
                warehouses.map((w, i) => (
                  <div
                    key={w.id}
                    className="glass-card p-5 hover:shadow-lg transition-all duration-200 cursor-pointer group animate-slide-up"
                    style={{ animationDelay: `${i * 0.05}s`, animationFillMode: 'both' }}
                    onClick={() => canEdit && openEditWh(w)}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-400 flex items-center justify-center shadow-sm">
                          <WarehouseIcon size={16} className="text-white" />
                        </div>
                        <h3 className="font-semibold text-gray-900 group-hover:text-emerald-700 transition-colors">{w.name}</h3>
                      </div>
                      <span className={`badge border ${
                        w.status === 'active' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-gray-100 text-gray-500 border-gray-200'
                      }`}>{w.status}</span>
                    </div>
                    <p className="text-xs text-gray-300 font-mono mb-2">{w.code}</p>
                    {(w.city || w.country) && (
                      <p className="text-sm text-gray-400 flex items-center gap-1.5 mb-3">
                        <MapPin size={13} /> {[w.city, w.country].filter(Boolean).join(', ')}
                      </p>
                    )}
                    <div className="flex gap-5 pt-3 border-t border-gray-100">
                      <div>
                        <span className="text-[10px] font-semibold text-gray-300 uppercase tracking-wider">Zones</span>
                        <p className="font-bold text-gray-900 tabular-nums">{w.zone_count}</p>
                      </div>
                      <div>
                        <span className="text-[10px] font-semibold text-gray-300 uppercase tracking-wider">Units</span>
                        <p className="font-bold text-gray-900 tabular-nums">{w.total_units.toLocaleString()}</p>
                      </div>
                      {w.capacity_units && (
                        <div>
                          <span className="text-[10px] font-semibold text-gray-300 uppercase tracking-wider">Capacity</span>
                          <p className="font-bold text-gray-900 tabular-nums">{w.capacity_units.toLocaleString()}</p>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Inventory Tab */}
          {tab === 'inventory' && (
            <div className="table-container">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="table-head">
                    <tr>
                      <th className="px-4 py-3 text-left">Part</th>
                      <th className="px-4 py-3 text-left">Warehouse</th>
                      <th className="px-4 py-3 text-left">Zone</th>
                      <th className="px-4 py-3 text-right">Qty</th>
                      <th className="px-4 py-3 text-left">Condition</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {inventory.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="text-center py-16">
                          <Package size={40} className="mx-auto text-gray-200 mb-3" />
                          <p className="text-sm text-gray-400">No inventory records</p>
                        </td>
                      </tr>
                    ) : (
                      inventory.map((item) => (
                        <tr key={item.id} className="hover:bg-gray-50/50 transition-colors">
                          <td className="px-4 py-3.5">
                            <p className="font-medium text-gray-900">{item.part_number}</p>
                            <p className="text-xs text-gray-300">{item.model_name}</p>
                          </td>
                          <td className="px-4 py-3.5 text-gray-600">{item.warehouse_name}</td>
                          <td className="px-4 py-3.5 text-gray-400">{item.zone_name || '—'}</td>
                          <td className="px-4 py-3.5 text-right font-semibold text-gray-900 tabular-nums">{item.quantity.toLocaleString()}</td>
                          <td className="px-4 py-3.5">
                            <span className={`badge border ${conditionBadge[item.condition] || conditionBadge.Poor}`}>{item.condition}</span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Movements Tab */}
          {tab === 'movements' && (
            <div className="table-container">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="table-head">
                    <tr>
                      <th className="px-4 py-3 text-left">Date</th>
                      <th className="px-4 py-3 text-left">Type</th>
                      <th className="px-4 py-3 text-left">Part</th>
                      <th className="px-4 py-3 text-right">Qty</th>
                      <th className="px-4 py-3 text-left">From</th>
                      <th className="px-4 py-3 text-left">To</th>
                      <th className="px-4 py-3 text-left">By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {movements.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="text-center py-16">
                          <ArrowRightLeft size={40} className="mx-auto text-gray-200 mb-3" />
                          <p className="text-sm text-gray-400">No movements recorded</p>
                        </td>
                      </tr>
                    ) : (
                      movements.map((m) => (
                        <tr key={m.id} className="hover:bg-gray-50/50 transition-colors">
                          <td className="px-4 py-3.5 text-gray-400 text-xs tabular-nums">{new Date(m.created_at).toLocaleDateString()}</td>
                          <td className="px-4 py-3.5">
                            <span className={`badge border ${moveBadge[m.movement_type] || moveBadge.Adjust}`}>{m.movement_type}</span>
                          </td>
                          <td className="px-4 py-3.5 font-medium text-gray-900">{m.part_number}</td>
                          <td className="px-4 py-3.5 text-right font-semibold tabular-nums">{m.quantity}</td>
                          <td className="px-4 py-3.5 text-gray-400">{m.from_warehouse_name || '—'}</td>
                          <td className="px-4 py-3.5 text-gray-400">{m.to_warehouse_name || '—'}</td>
                          <td className="px-4 py-3.5 text-gray-300 text-xs">{m.created_by_name || '—'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Warehouse Create/Edit Modal */}
      {showWhForm && (
        <div className="modal-overlay" onClick={() => setShowWhForm(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-900">{editWhId ? 'Edit Warehouse' : 'New Warehouse'}</h2>
              <button onClick={() => setShowWhForm(false)} className="btn-ghost p-1.5"><X size={18} /></button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Name <span className="text-red-400">*</span></label>
                  <input value={whForm.name} onChange={(e) => setWhForm({ ...whForm, name: e.target.value })} className="input-base" placeholder="Main Warehouse" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Code <span className="text-red-400">*</span></label>
                  <input value={whForm.code} onChange={(e) => setWhForm({ ...whForm, code: e.target.value })} className="input-base uppercase" placeholder="WH-01" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Address</label>
                <input value={whForm.address} onChange={(e) => setWhForm({ ...whForm, address: e.target.value })} className="input-base" placeholder="123 Industrial Blvd" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">City</label>
                  <input value={whForm.city} onChange={(e) => setWhForm({ ...whForm, city: e.target.value })} className="input-base" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Country</label>
                  <input value={whForm.country} onChange={(e) => setWhForm({ ...whForm, country: e.target.value })} className="input-base" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Capacity (units)</label>
                  <input type="number" value={whForm.capacity_units} onChange={(e) => setWhForm({ ...whForm, capacity_units: e.target.value })} className="input-base" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Status</label>
                  <select value={whForm.status} onChange={(e) => setWhForm({ ...whForm, status: e.target.value })} className="input-base">
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Notes</label>
                <textarea value={whForm.notes} onChange={(e) => setWhForm({ ...whForm, notes: e.target.value })} rows={2} className="input-base" />
              </div>
            </div>
            <div className="flex justify-end gap-2.5 px-6 py-4 border-t border-gray-100 bg-gray-50/50">
              <button onClick={() => setShowWhForm(false)} className="btn-secondary">Cancel</button>
              <button onClick={saveWarehouse} disabled={saving || !whForm.name || !whForm.code} className="btn-primary">
                {saving ? 'Saving…' : editWhId ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Move Inventory Modal */}
      {showMoveForm && (
        <div className="modal-overlay" onClick={() => setShowMoveForm(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-900">Move Inventory</h2>
              <button onClick={() => setShowMoveForm(false)} className="btn-ghost p-1.5"><X size={18} /></button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Movement Type</label>
                <select value={moveForm.movement_type} onChange={(e) => setMoveForm({ ...moveForm, movement_type: e.target.value })} className="input-base">
                  <option value="Receive">Receive</option>
                  <option value="Ship">Ship</option>
                  <option value="Transfer">Transfer</option>
                  <option value="Adjust">Adjust</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Part ID <span className="text-red-400">*</span></label>
                <input value={moveForm.part_id} onChange={(e) => setMoveForm({ ...moveForm, part_id: e.target.value })} className="input-base" placeholder="Enter part ID" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Quantity <span className="text-red-400">*</span></label>
                <input type="number" value={moveForm.quantity} onChange={(e) => setMoveForm({ ...moveForm, quantity: e.target.value })} className="input-base" />
              </div>
              {(moveForm.movement_type === 'Ship' || moveForm.movement_type === 'Transfer') && (
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Source Warehouse <span className="text-red-400">*</span></label>
                  <select value={moveForm.from_warehouse_id} onChange={(e) => setMoveForm({ ...moveForm, from_warehouse_id: e.target.value })} className="input-base">
                    <option value="">Select source…</option>
                    {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.code})</option>)}
                  </select>
                </div>
              )}
              {(moveForm.movement_type === 'Receive' || moveForm.movement_type === 'Transfer') && (
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Destination Warehouse <span className="text-red-400">*</span></label>
                  <select value={moveForm.to_warehouse_id} onChange={(e) => setMoveForm({ ...moveForm, to_warehouse_id: e.target.value })} className="input-base">
                    <option value="">Select destination…</option>
                    {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.code})</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Condition</label>
                <select value={moveForm.condition} onChange={(e) => setMoveForm({ ...moveForm, condition: e.target.value })} className="input-base">
                  <option value="New">New</option>
                  <option value="Good">Good</option>
                  <option value="Fair">Fair</option>
                  <option value="Poor">Poor</option>
                  <option value="Scrap">Scrap</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Reference</label>
                <input value={moveForm.reference} onChange={(e) => setMoveForm({ ...moveForm, reference: e.target.value })} className="input-base" placeholder="PO-12345" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Notes</label>
                <textarea value={moveForm.notes} onChange={(e) => setMoveForm({ ...moveForm, notes: e.target.value })} rows={2} className="input-base" />
              </div>
            </div>
            <div className="flex justify-end gap-2.5 px-6 py-4 border-t border-gray-100 bg-gray-50/50">
              <button onClick={() => setShowMoveForm(false)} className="btn-secondary">Cancel</button>
              <button onClick={submitMove} disabled={saving || !moveForm.part_id || !moveForm.quantity} className="btn-primary">
                {saving ? 'Processing…' : 'Submit'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
