import { useCallback, useEffect, useMemo, useState, type FormEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  ArrowRightLeft,
  Box,
  ChevronRight,
  Layers,
  Loader2,
  MapPinned,
  MapPin,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Warehouse as WarehouseIcon,
  X,
} from 'lucide-react';
import { apiRequest } from '../lib/api';
import { useAuthStore } from '../stores/authStore';

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

interface WarehouseZone {
  id: string;
  warehouse_id: string;
  warehouse_name: string;
  warehouse_code: string;
  name: string;
  zone_type: string;
  capacity_units: number | null;
  total_units: number;
  created_at: string;
}

interface InventoryItem {
  id: string;
  warehouse_id: string;
  zone_id: string | null;
  part_id: string;
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
  from_zone_name: string | null;
  to_warehouse_name: string | null;
  to_zone_name: string | null;
  part_number: string;
  model_name: string | null;
  created_by_name: string | null;
  created_at: string;
  reference: string | null;
  notes: string | null;
}

interface PartOption {
  id: string;
  part_number: string;
  model_name?: string | null;
  vendor?: string | null;
}

interface WarehouseForm {
  name: string;
  code: string;
  address: string;
  city: string;
  country: string;
  capacity_units: string;
  status: string;
  notes: string;
  initial_zone_name: string;
  initial_zone_type: string;
  initial_zone_capacity: string;
}

interface ZoneForm {
  name: string;
  zone_type: string;
  capacity_units: string;
}

interface MoveForm {
  part_id: string;
  part_label: string;
  quantity: string;
  movement_type: string;
  from_warehouse_id: string;
  from_zone_id: string;
  to_warehouse_id: string;
  to_zone_id: string;
  condition: string;
  reference: string;
  notes: string;
}

interface WarehouseTotals {
  totalWarehouses: number;
  activeWarehouses: number;
  totalUnits: number;
  totalCapacity: number;
  utilization: number;
  totalPartTypes: number;
}

interface PartStockGroup {
  key: string;
  partNumber: string;
  modelName: string | null;
  category: string | null;
  totalUnits: number;
  rows: InventoryItem[];
  conditionCounts: Record<string, number>;
}

const CONDITIONS = ['New', 'Good', 'Fair', 'Poor', 'Scrap'] as const;
const ZONE_TYPES = ['storage', 'staging', 'inspection', 'shipping', 'receiving'] as const;

const emptyWarehouseForm: WarehouseForm = {
  name: '',
  code: '',
  address: '',
  city: '',
  country: '',
  capacity_units: '',
  status: 'active',
  notes: '',
  initial_zone_name: '',
  initial_zone_type: 'storage',
  initial_zone_capacity: '',
};

const emptyZoneForm: ZoneForm = {
  name: '',
  zone_type: 'storage',
  capacity_units: '',
};

const emptyMoveForm: MoveForm = {
  part_id: '',
  part_label: '',
  quantity: '',
  movement_type: 'Receive',
  from_warehouse_id: '',
  from_zone_id: '',
  to_warehouse_id: '',
  to_zone_id: '',
  condition: 'Good',
  reference: '',
  notes: '',
};

const conditionStyles: Record<string, string> = {
  New: 'bg-verified-green text-white',
  Good: 'bg-signal-teal text-white',
  Fair: 'bg-deep-teal text-white',
  Poor: 'bg-signal-teal/70 text-white',
  Scrap: 'bg-deep-teal/70 text-white',
};

const movementStyles: Record<string, string> = {
  Receive: 'bg-verified-green/15 text-verified-green border-verified-green/25',
  Ship: 'bg-signal-teal/15 text-signal-teal border-signal-teal/25',
  Transfer: 'bg-deep-teal/15 text-deep-teal border-deep-teal/25',
  Adjust: 'bg-signal-teal/10 text-deep-teal border-signal-teal/20',
};

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function formatNumber(value: number | null | undefined) {
  return (value || 0).toLocaleString();
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatMovementLocation(warehouse: string | null, zone: string | null) {
  if (!warehouse) return '-';
  return zone ? `${warehouse} / ${zone}` : `${warehouse} / Warehouse level`;
}

function normalize(value: string | null | undefined) {
  return (value || '').trim().toLowerCase();
}

function getWarehouseInventory(warehouse: WarehouseItem | null, inventory: InventoryItem[]) {
  if (!warehouse) return [];
  const code = normalize(warehouse.code);
  const name = normalize(warehouse.name);
  return inventory.filter((item) => normalize(item.warehouse_code) === code || normalize(item.warehouse_name) === name);
}

function getWarehouseMovements(warehouse: WarehouseItem | null, movements: Movement[]) {
  if (!warehouse) return [];
  const name = normalize(warehouse.name);
  return movements.filter(
    (movement) => normalize(movement.from_warehouse_name) === name || normalize(movement.to_warehouse_name) === name,
  );
}

function buildPartGroups(items: InventoryItem[]) {
  const groups = new Map<string, PartStockGroup>();

  for (const item of items) {
    const key = item.part_number || item.id;
    const current = groups.get(key);
    if (!current) {
      groups.set(key, {
        key,
        partNumber: item.part_number,
        modelName: item.model_name,
        category: item.category,
        totalUnits: item.quantity || 0,
        rows: [item],
        conditionCounts: { [item.condition]: item.quantity || 0 },
      });
      continue;
    }

    current.totalUnits += item.quantity || 0;
    current.rows.push(item);
    current.conditionCounts[item.condition] = (current.conditionCounts[item.condition] || 0) + (item.quantity || 0);
    if (!current.modelName && item.model_name) current.modelName = item.model_name;
    if (!current.category && item.category) current.category = item.category;
  }

  return Array.from(groups.values()).sort((a, b) => a.partNumber.localeCompare(b.partNumber));
}

function computeConditionCounts(items: InventoryItem[]) {
  return items.reduce<Record<string, number>>((acc, item) => {
    acc[item.condition] = (acc[item.condition] || 0) + (item.quantity || 0);
    return acc;
  }, {});
}

function computeTotals(warehouses: WarehouseItem[], inventory: InventoryItem[]): WarehouseTotals {
  const totalCapacity = warehouses.reduce((sum, warehouse) => sum + (warehouse.capacity_units || 0), 0);
  const totalUnits = warehouses.reduce((sum, warehouse) => sum + (warehouse.total_units || 0), 0);
  return {
    totalWarehouses: warehouses.length,
    activeWarehouses: warehouses.filter((warehouse) => normalize(warehouse.status) === 'active').length,
    totalUnits,
    totalCapacity,
    utilization: totalCapacity > 0 ? Math.round((totalUnits / totalCapacity) * 100) : 0,
    totalPartTypes: new Set(inventory.map((item) => item.part_number)).size,
  };
}

async function fetchPartOptions(search = '') {
  const response = await apiRequest<{ parts: PartOption[] }>('/api/parts', {
    params: { search, limit: 25 },
  });
  return response.parts || [];
}

export function WarehousePage() {
  const { user } = useAuthStore();
  const canEdit = user?.role === 'Admin' || user?.role === 'User';

  const [warehouses, setWarehouses] = useState<WarehouseItem[]>([]);
  const [zones, setZones] = useState<WarehouseZone[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const [selectedWarehouse, setSelectedWarehouse] = useState<WarehouseItem | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCondition, setFilterCondition] = useState('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [expandedPart, setExpandedPart] = useState<string | null>(null);

  const [showWhForm, setShowWhForm] = useState(false);
  const [whForm, setWhForm] = useState<WarehouseForm>(emptyWarehouseForm);
  const [editWhId, setEditWhId] = useState<string | null>(null);

  const [showZoneForm, setShowZoneForm] = useState(false);
  const [zoneForm, setZoneForm] = useState<ZoneForm>(emptyZoneForm);
  const [editZoneId, setEditZoneId] = useState<string | null>(null);

  const [showMoveForm, setShowMoveForm] = useState(false);
  const [moveForm, setMoveForm] = useState<MoveForm>(emptyMoveForm);
  const [partOptions, setPartOptions] = useState<PartOption[]>([]);
  const [partSearching, setPartSearching] = useState(false);
  const [partSearchText, setPartSearchText] = useState('');
  const [showPartSuggestions, setShowPartSuggestions] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError('');

    try {
      const [warehousesResult, zonesResult, inventoryResult, movementsResult] = await Promise.allSettled([
        apiRequest<{ success: boolean; warehouses: WarehouseItem[] }>('/api/warehouses'),
        apiRequest<{ success: boolean; zones: WarehouseZone[] }>('/api/warehouses/zones/all'),
        apiRequest<{ success: boolean; inventory: InventoryItem[] }>('/api/warehouses/inventory/all'),
        apiRequest<{ success: boolean; movements: Movement[] }>('/api/warehouses/movements/list'),
      ]);

      if (warehousesResult.status === 'fulfilled') {
        setWarehouses(warehousesResult.value.warehouses || []);
        setSelectedWarehouse((current) => {
          if (!current) return null;
          return warehousesResult.value.warehouses.find((warehouse) => warehouse.id === current.id) || current;
        });
      } else {
        throw warehousesResult.reason;
      }

      if (zonesResult.status === 'fulfilled') {
        setZones(zonesResult.value.zones || []);
      }

      if (inventoryResult.status === 'fulfilled') {
        setInventory(inventoryResult.value.inventory || []);
      }

      if (movementsResult.status === 'fulfilled') {
        setMovements(movementsResult.value.movements || []);
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load warehouse data'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!showMoveForm) return;

    let cancelled = false;
    const handle = window.setTimeout(async () => {
      setPartSearching(true);
      try {
        const options = await fetchPartOptions(partSearchText.trim());
        if (!cancelled) setPartOptions(options);
      } catch {
        if (!cancelled) setPartOptions([]);
      } finally {
        if (!cancelled) setPartSearching(false);
      }
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [partSearchText, showMoveForm]);

  const totals = useMemo(() => computeTotals(warehouses, inventory), [warehouses, inventory]);
  const inventoryByWarehouseCode = useMemo(() => {
    const map = new Map<string, InventoryItem[]>();
    for (const item of inventory) {
      const key = item.warehouse_code || item.warehouse_name;
      const current = map.get(key) || [];
      current.push(item);
      map.set(key, current);
    }
    return map;
  }, [inventory]);

  const selectedZones = useMemo(
    () => zones.filter((zone) => zone.warehouse_id === selectedWarehouse?.id),
    [selectedWarehouse, zones],
  );

  const selectedInventory = useMemo(
    () => getWarehouseInventory(selectedWarehouse, inventory),
    [inventory, selectedWarehouse],
  );

  const selectedMovements = useMemo(
    () => getWarehouseMovements(selectedWarehouse, movements),
    [movements, selectedWarehouse],
  );

  const selectedConditionCounts = useMemo(() => computeConditionCounts(selectedInventory), [selectedInventory]);

  const categoryOptions = useMemo(() => {
    return Array.from(new Set(selectedInventory.map((item) => item.category).filter(Boolean) as string[])).sort();
  }, [selectedInventory]);

  const filteredGroups = useMemo(() => {
    const search = normalize(searchTerm);
    return buildPartGroups(selectedInventory).filter((group) => {
      const matchesSearch =
        !search ||
        normalize(group.partNumber).includes(search) ||
        normalize(group.modelName).includes(search) ||
        normalize(group.category).includes(search);
      const matchesCondition = filterCondition === 'all' || (group.conditionCounts[filterCondition] || 0) > 0;
      const matchesCategory = filterCategory === 'all' || group.category === filterCategory;
      return matchesSearch && matchesCondition && matchesCategory;
    });
  }, [filterCategory, filterCondition, searchTerm, selectedInventory]);

  const openWarehouseModal = (warehouse?: WarehouseItem, event?: MouseEvent) => {
    event?.stopPropagation();
    setError('');
    if (warehouse) {
      setWhForm({
        name: warehouse.name,
        code: warehouse.code,
        address: warehouse.address || '',
        city: warehouse.city || '',
        country: warehouse.country || '',
        capacity_units: warehouse.capacity_units?.toString() || '',
        status: warehouse.status,
        notes: warehouse.notes || '',
        initial_zone_name: '',
        initial_zone_type: 'storage',
        initial_zone_capacity: '',
      });
      setEditWhId(warehouse.id);
    } else {
      setWhForm(emptyWarehouseForm);
      setEditWhId(null);
    }
    setShowWhForm(true);
  };

  const openZoneModal = (zone?: WarehouseZone) => {
    setError('');
    setZoneForm(zone ? {
      name: zone.name,
      zone_type: zone.zone_type,
      capacity_units: zone.capacity_units?.toString() || '',
    } : emptyZoneForm);
    setEditZoneId(zone?.id || null);
    setShowZoneForm(true);
  };

  const saveZone = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedWarehouse) return;
    setSaving(true);
    setError('');
    try {
      const body = {
        name: zoneForm.name,
        zone_type: zoneForm.zone_type,
        capacity_units: zoneForm.capacity_units ? parseInt(zoneForm.capacity_units) : null,
      };
      await apiRequest(
        editZoneId
          ? `/api/warehouses/${selectedWarehouse.id}/zones/${editZoneId}`
          : `/api/warehouses/${selectedWarehouse.id}/zones`,
        { method: editZoneId ? 'PUT' : 'POST', body },
      );
      setShowZoneForm(false);
      setZoneForm(emptyZoneForm);
      setEditZoneId(null);
      await loadData(true);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to save warehouse zone'));
    } finally {
      setSaving(false);
    }
  };
  const openMoveModal = (warehouse?: WarehouseItem | null, movementType = 'Receive') => {
    setError('');
    setMoveForm({
      ...emptyMoveForm,
      movement_type: movementType,
      to_warehouse_id: movementType === 'Receive' || movementType === 'Transfer' ? warehouse?.id || '' : '',
      from_warehouse_id: movementType === 'Ship' || movementType === 'Transfer' ? warehouse?.id || '' : '',
    });
    setPartSearchText('');
    setPartOptions([]);
    setShowPartSuggestions(false);
    setShowMoveForm(true);
  };

  const saveWarehouse = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError('');

    try {
      const {
        initial_zone_name,
        initial_zone_type,
        initial_zone_capacity,
        ...warehouseFields
      } = whForm;
      const body: Record<string, unknown> = { ...warehouseFields };
      if (whForm.capacity_units) body.capacity_units = parseInt(whForm.capacity_units);
      else delete body.capacity_units;
      if (!editWhId && initial_zone_name.trim()) {
        body.initial_zone = {
          name: initial_zone_name.trim(),
          zone_type: initial_zone_type,
          capacity_units: initial_zone_capacity ? parseInt(initial_zone_capacity) : null,
        };
      }

      if (editWhId) {
        await apiRequest(`/api/warehouses/${editWhId}`, { method: 'PUT', body });
      } else {
        await apiRequest('/api/warehouses', { method: 'POST', body });
      }

      setShowWhForm(false);
      setWhForm(emptyWarehouseForm);
      setEditWhId(null);
      await loadData(true);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to save warehouse'));
    } finally {
      setSaving(false);
    }
  };

  const submitMove = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError('');

    try {
      await apiRequest('/api/warehouses/inventory/move', {
        method: 'POST',
        body: {
          ...moveForm,
          quantity: parseInt(moveForm.quantity),
          from_warehouse_id: moveForm.from_warehouse_id || undefined,
          from_zone_id: moveForm.from_zone_id || undefined,
          to_warehouse_id: moveForm.to_warehouse_id || undefined,
          to_zone_id: moveForm.to_zone_id || undefined,
        },
      });
      setShowMoveForm(false);
      setMoveForm(emptyMoveForm);
      await loadData(true);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to move inventory'));
    } finally {
      setSaving(false);
    }
  };

  const clearFilters = () => {
    setSearchTerm('');
    setFilterCondition('all');
    setFilterCategory('all');
  };

  if (loading) {
    return <WarehouseSkeleton />;
  }

  if (selectedWarehouse) {
    return (
      <div className="space-y-6 animate-fade-in">
        <button
          onClick={() => {
            setSelectedWarehouse(null);
            clearFilters();
            setExpandedPart(null);
          }}
          className="inline-flex items-center gap-2 text-signal-teal hover:text-deep-teal transition-colors"
        >
          <ChevronRight className="h-5 w-5 rotate-180" />
          <span className="font-medium">Back to Warehouses</span>
        </button>

        <WarehouseDetailHeader
          warehouse={selectedWarehouse}
          partTypeCount={buildPartGroups(selectedInventory).length}
          zoneCount={selectedZones.length}
          conditionCounts={selectedConditionCounts}
          activeCondition={filterCondition}
          onConditionChange={(condition) => setFilterCondition(filterCondition === condition ? 'all' : condition)}
          onOpenStock={() => openMoveModal(selectedWarehouse, 'Receive')}
          onOpenZone={() => openZoneModal()}
          canEdit={canEdit}
        />

        {error && <ErrorBanner message={error} />}

        <ZoneManagement zones={selectedZones} canEdit={canEdit} onAdd={() => openZoneModal()} onEdit={openZoneModal} />

        <div className="bg-white rounded-apple-lg shadow-none border border-gray-100 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search
                className={`absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 ${
                  searchTerm ? 'text-signal-teal' : 'text-gray-400'
                }`}
              />
              <input
                type="text"
                placeholder="Search by part number, model..."
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                className="w-full pl-11 pr-4 py-2.5 text-caption border rounded-pill shadow-none hover:shadow-apple-sm focus:outline-none focus:ring-2 transition-all duration-200 bg-white border-gray-200 text-gray-900 placeholder-gray-400 focus:ring-signal-teal/40"
              />
            </div>

            <select
              value={filterCondition}
              onChange={(event) => setFilterCondition(event.target.value)}
              className="px-4 py-2.5 rounded-pill border border-gray-200 bg-white text-caption text-gray-700 focus:outline-none focus:ring-2 focus:ring-signal-teal/40"
            >
              <option value="all">All Conditions</option>
              {CONDITIONS.map((condition) => (
                <option key={condition} value={condition}>{condition}</option>
              ))}
            </select>

            <select
              value={filterCategory}
              onChange={(event) => setFilterCategory(event.target.value)}
              className="px-4 py-2.5 rounded-pill border border-gray-200 bg-white text-caption text-gray-700 focus:outline-none focus:ring-2 focus:ring-signal-teal/40"
            >
              <option value="all">All Categories</option>
              {categoryOptions.map((category) => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>

            <span className="text-caption text-gray-500 ml-auto">
              {filteredGroups.length} part types - {filteredGroups.reduce((sum, group) => sum + group.totalUnits, 0).toLocaleString()} units
            </span>

            {(searchTerm || filterCondition !== 'all' || filterCategory !== 'all') && (
              <button
                onClick={clearFilters}
                className="text-caption text-gray-500 hover:text-gray-700 underline"
              >
                Clear all
              </button>
            )}
          </div>
        </div>

        <div className="bg-white rounded-apple-lg shadow-none border border-gray-100 overflow-hidden">
          {filteredGroups.length === 0 ? (
            <div className="text-center py-12">
              <Box className="h-12 w-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">
                {selectedInventory.length === 0 ? 'No parts in this warehouse' : 'No parts match your filters'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {filteredGroups.map((group) => (
                <PartStockRow
                  key={group.key}
                  group={group}
                  isExpanded={expandedPart === group.key}
                  onToggle={() => setExpandedPart(expandedPart === group.key ? null : group.key)}
                />
              ))}
            </div>
          )}
        </div>

        <RecentMovements movements={selectedMovements.slice(0, 8)} title="Recent Warehouse Movements" />

        {showWhForm && (
          <WarehouseFormModal
            form={whForm}
            editing={!!editWhId}
            saving={saving}
            onChange={(updates) => setWhForm((current) => ({ ...current, ...updates }))}
            onClose={() => setShowWhForm(false)}
            onSubmit={saveWarehouse}
          />
        )}

        {showZoneForm && (
          <ZoneFormModal
            form={zoneForm}
            editing={!!editZoneId}
            saving={saving}
            onChange={(updates) => setZoneForm((current) => ({ ...current, ...updates }))}
            onClose={() => setShowZoneForm(false)}
            onSubmit={saveZone}
          />
        )}

        {showMoveForm && (
          <MoveInventoryModal
            form={moveForm}
            warehouses={warehouses}
            zones={zones}
            partOptions={partOptions}
            partSearching={partSearching}
            partSearchText={partSearchText}
            showPartSuggestions={showPartSuggestions}
            saving={saving}
            onChange={(updates) => setMoveForm((current) => ({ ...current, ...updates }))}
            onPartSearchTextChange={(value) => {
              setPartSearchText(value);
              setMoveForm((current) => ({ ...current, part_id: '', part_label: value }));
              setShowPartSuggestions(true);
            }}
            onPartFocus={() => setShowPartSuggestions(true)}
            onSelectPart={(part) => {
              setMoveForm((current) => ({
                ...current,
                part_id: part.id,
                part_label: `${part.part_number}${part.model_name ? ` - ${part.model_name}` : ''}`,
              }));
              setPartSearchText(`${part.part_number}${part.model_name ? ` - ${part.model_name}` : ''}`);
              setShowPartSuggestions(false);
            }}
            onClose={() => setShowMoveForm(false)}
            onSubmit={submitMove}
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="font-display text-tile font-semibold text-gray-900">Stock & Warehouses</h1>
          <p className="text-gray-600 mt-1">
            {totals.totalWarehouses} warehouses - {formatNumber(totals.totalUnits)} total units - {totals.totalPartTypes} part types
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => loadData(true)}
            disabled={refreshing}
            className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-apple transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-5 w-5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          {canEdit && (
            <>
              <button
                onClick={() => openMoveModal(null, 'Transfer')}
                className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-apple transition-colors hover:bg-gray-50"
              >
                <ArrowRightLeft className="h-5 w-5" />
                Move Inventory
              </button>
              <button
                onClick={() => openWarehouseModal()}
                className="flex items-center gap-2 px-4 py-2 bg-signal-teal text-white rounded-apple transition-colors hover:bg-signal-teal/90"
              >
                <Plus className="h-5 w-5" />
                Add Warehouse
              </button>
            </>
          )}
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      <OverviewCards totals={totals} />

      {warehouses.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-apple-lg border border-gray-200">
          <WarehouseIcon className="h-16 w-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No Warehouses Yet</h3>
          <p className="text-gray-500 mb-6">Get started by creating your first warehouse location.</p>
          {canEdit && (
            <button
              onClick={() => openWarehouseModal()}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-signal-teal text-white rounded-apple-md transition-colors hover:bg-signal-teal/90"
            >
              <Plus className="h-5 w-5" />
              Add First Warehouse
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 stagger-tiles">
          {warehouses.map((warehouse) => (
            <WarehouseCard
              key={warehouse.id}
              warehouse={warehouse}
              items={inventoryByWarehouseCode.get(warehouse.code) || inventoryByWarehouseCode.get(warehouse.name) || []}
              canEdit={canEdit}
              onSelect={() => {
                setSelectedWarehouse(warehouse);
                clearFilters();
                setExpandedPart(null);
              }}
              onEdit={(event) => openWarehouseModal(warehouse, event)}
            />
          ))}
        </div>
      )}

      <RecentMovements movements={movements.slice(0, 8)} title="Recent Movements" />

      {showWhForm && (
        <WarehouseFormModal
          form={whForm}
          editing={!!editWhId}
          saving={saving}
          onChange={(updates) => setWhForm((current) => ({ ...current, ...updates }))}
          onClose={() => setShowWhForm(false)}
          onSubmit={saveWarehouse}
        />
      )}

      {showMoveForm && (
        <MoveInventoryModal
          form={moveForm}
          warehouses={warehouses}
          zones={zones}
          partOptions={partOptions}
          partSearching={partSearching}
          partSearchText={partSearchText}
          showPartSuggestions={showPartSuggestions}
          saving={saving}
          onChange={(updates) => setMoveForm((current) => ({ ...current, ...updates }))}
          onPartSearchTextChange={(value) => {
            setPartSearchText(value);
            setMoveForm((current) => ({ ...current, part_id: '', part_label: value }));
            setShowPartSuggestions(true);
          }}
          onPartFocus={() => setShowPartSuggestions(true)}
          onSelectPart={(part) => {
            setMoveForm((current) => ({
              ...current,
              part_id: part.id,
              part_label: `${part.part_number}${part.model_name ? ` - ${part.model_name}` : ''}`,
            }));
            setPartSearchText(`${part.part_number}${part.model_name ? ` - ${part.model_name}` : ''}`);
            setShowPartSuggestions(false);
          }}
          onClose={() => setShowMoveForm(false)}
          onSubmit={submitMove}
        />
      )}
    </div>
  );
}

function WarehouseSkeleton() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex justify-between items-start">
        <div>
          <div className="skeleton h-8 w-64 rounded mb-3" />
          <div className="skeleton h-4 w-80 rounded" />
        </div>
        <div className="skeleton h-10 w-36 rounded-apple" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="bg-white rounded-apple-lg border border-gray-100 p-5">
            <div className="skeleton h-4 w-24 rounded mb-4" />
            <div className="skeleton h-8 w-20 rounded" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="bg-white rounded-apple-lg border border-gray-100 p-5 space-y-4">
            <div className="flex gap-3">
              <div className="skeleton h-10 w-10 rounded-apple" />
              <div className="space-y-2 flex-1">
                <div className="skeleton h-5 w-36 rounded" />
                <div className="skeleton h-3 w-20 rounded" />
              </div>
            </div>
            <div className="skeleton h-20 w-full rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="bg-signal-teal/10 border border-signal-teal/20 rounded-apple-lg p-4 flex items-start gap-3">
      <AlertCircle className="h-5 w-5 text-deep-teal flex-shrink-0 mt-0.5" />
      <div className="flex-1">
        <h3 className="font-semibold text-deep-teal">Warehouse Data Notice</h3>
        <p className="text-caption text-deep-teal/80 mt-1">{message}</p>
      </div>
    </div>
  );
}

function OverviewCards({ totals }: { totals: WarehouseTotals }) {
  const cards = [
    {
      label: 'Warehouses',
      value: totals.totalWarehouses.toString(),
      icon: WarehouseIcon,
      accent: 'bg-signal-teal/15 text-signal-teal',
    },
    {
      label: 'Total Units',
      value: formatNumber(totals.totalUnits),
      icon: Package,
      accent: 'bg-verified-green/15 text-verified-green',
    },
    {
      label: 'Capacity',
      value: formatNumber(totals.totalCapacity),
      icon: Layers,
      accent: 'bg-deep-teal/15 text-deep-teal',
    },
    {
      label: 'Utilization',
      value: `${totals.utilization}%`,
      icon: Box,
      accent: 'bg-signal-teal/10 text-deep-teal',
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div key={card.label} className="bg-white rounded-apple-lg shadow-none border border-gray-100 p-5 hover:shadow-apple-sm transition-all">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-caption font-medium text-gray-500">{card.label}</p>
                <p className="text-tile font-semibold text-gray-900 mt-2">{card.value}</p>
              </div>
              <div className={`w-12 h-12 rounded-apple-xl flex items-center justify-center ${card.accent}`}>
                <Icon className="h-6 w-6" />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function WarehouseCard({
  warehouse,
  items,
  canEdit,
  onSelect,
  onEdit,
}: {
  warehouse: WarehouseItem;
  items: InventoryItem[];
  canEdit: boolean;
  onSelect: () => void;
  onEdit: (event: MouseEvent) => void;
}) {
  const counts = computeConditionCounts(items);
  const totalUnits = warehouse.total_units || items.reduce((sum, item) => sum + item.quantity, 0);
  const utilization = warehouse.capacity_units ? Math.min(100, Math.round((totalUnits / warehouse.capacity_units) * 100)) : 0;

  return (
    <div
      onClick={onSelect}
      className="bg-white rounded-apple-lg shadow-none hover:shadow-apple-sm transition-all cursor-pointer border border-gray-100 group"
    >
      <div className="p-5 border-b border-gray-100">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-apple bg-signal-teal/15">
              <WarehouseIcon className="h-5 w-5 text-signal-teal" />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-signal-teal group-hover:underline truncate">{warehouse.name}</h3>
              <p className="text-micro text-gray-500 font-mono">{warehouse.code}</p>
            </div>
          </div>

          {canEdit && (
            <button
              onClick={onEdit}
              className="p-1.5 text-gray-400 hover:text-signal-teal hover:bg-signal-teal/10 rounded-apple transition-colors opacity-0 group-hover:opacity-100"
              title="Edit"
            >
              <Pencil className="h-4 w-4" />
            </button>
          )}
        </div>

        {(warehouse.city || warehouse.country) && (
          <div className="mt-2 flex items-center gap-1 text-caption text-gray-500">
            <MapPin className="h-3.5 w-3.5" />
            {[warehouse.city, warehouse.country].filter(Boolean).join(', ')}
          </div>
        )}
      </div>

      <div className="p-5">
        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="text-center min-w-0">
            <p className="font-display text-tile font-semibold text-gray-900 truncate">{formatNumber(totalUnits)}</p>
            <p className="text-micro text-gray-500">Units</p>
          </div>
          <div className="text-center border-x border-gray-100 min-w-0 px-1">
            <p className="font-display text-sub-heading sm:text-tile font-semibold text-gray-900 truncate">{formatNumber(warehouse.zone_count)}</p>
            <p className="text-micro text-gray-500">Zones</p>
          </div>
          <div className="text-center min-w-0">
            <p className="font-display text-sub-heading sm:text-tile font-semibold text-gray-900 truncate">{utilization}%</p>
            <p className="text-micro text-gray-500">Used</p>
          </div>
        </div>

        {totalUnits > 0 ? (
          <div>
            <p className="text-micro text-gray-500 mb-2">Condition</p>
            <div className="flex h-2 rounded-full overflow-hidden bg-gray-100">
              {CONDITIONS.map((condition) => ({
                condition,
                count: counts[condition] || 0,
                color:
                  condition === 'New' ? 'bg-verified-green' :
                  condition === 'Good' ? 'bg-signal-teal' :
                  condition === 'Fair' ? 'bg-deep-teal' :
                  condition === 'Poor' ? 'bg-signal-teal/70' :
                  'bg-deep-teal/70',
              })).filter((segment) => segment.count > 0).map((segment) => (
                <div
                  key={segment.condition}
                  className={segment.color}
                  style={{ width: `${(segment.count / Math.max(totalUnits, 1)) * 100}%` }}
                  title={`${segment.condition}: ${segment.count} units`}
                />
              ))}
            </div>
            <div className="flex gap-2 mt-2 flex-wrap">
              {CONDITIONS.filter((condition) => (counts[condition] || 0) > 0).map((condition) => (
                <span key={condition} className="text-micro text-gray-500">
                  {condition}: {counts[condition]}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <div className="text-center py-2">
            <p className="text-caption text-gray-400 italic">No units in stock</p>
          </div>
        )}
      </div>

      <div className="px-5 py-3 bg-gray-50 rounded-b-apple-lg flex items-center justify-between border-t border-gray-100">
        <span className="text-caption text-gray-500">Click to view inventory</span>
        <ChevronRight className="h-4 w-4 text-verified-green" />
      </div>
    </div>
  );
}

function WarehouseDetailHeader({
  warehouse,
  partTypeCount,
  zoneCount,
  conditionCounts,
  activeCondition,
  canEdit,
  onConditionChange,
  onOpenStock,
  onOpenZone,
}: {
  warehouse: WarehouseItem;
  partTypeCount: number;
  zoneCount: number;
  conditionCounts: Record<string, number>;
  activeCondition: string;
  canEdit: boolean;
  onConditionChange: (condition: string) => void;
  onOpenStock: () => void;
  onOpenZone: () => void;
}) {
  return (
    <div className="rounded-apple-lg p-6 text-white shadow-apple bg-deep-teal">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <div className="p-3 bg-white/10 rounded-apple-md">
            <WarehouseIcon className="h-8 w-8" />
          </div>
          <div className="min-w-0">
            <h1 className="font-display text-tile font-semibold truncate">{warehouse.name}</h1>
            <div className="flex items-center gap-3 mt-1 text-white/70 flex-wrap">
              <span className="font-mono">{warehouse.code}</span>
              {(warehouse.city || warehouse.country) && (
                <>
                  <span>/</span>
                  <span className="flex items-center gap-1">
                    <MapPin className="h-4 w-4" />
                    {[warehouse.city, warehouse.country].filter(Boolean).join(', ')}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-8 flex-wrap">
          <div className="text-center">
            <p className="text-tile font-semibold">{partTypeCount}</p>
            <p className="text-caption text-white/70">Part Types</p>
          </div>
          <div className="text-center">
            <p className="text-tile font-semibold">{formatNumber(warehouse.total_units)}</p>
            <p className="text-caption text-white/70">Total Units</p>
          </div>
          <div className="text-center">
            <p className="text-tile font-semibold">{formatNumber(warehouse.capacity_units)}</p>
            <p className="text-caption text-white/70">Capacity</p>
          </div>
          <div className="text-center">
            <p className="text-tile font-semibold">{zoneCount}</p>
            <p className="text-caption text-white/70">Zones</p>
          </div>

          {canEdit && (
            <div className="ml-0 sm:ml-4 flex items-center gap-2">
              <button
                onClick={onOpenZone}
                className="flex items-center gap-2 px-4 py-2.5 bg-white/10 hover:bg-white/20 rounded-apple-md text-white font-medium transition-colors"
              >
                <MapPinned className="h-4 w-4" />
                Add Zone
              </button>
              <button
                onClick={onOpenStock}
                className="flex items-center gap-2 px-4 py-2.5 bg-white/20 hover:bg-white/30 rounded-apple-md text-white font-medium transition-colors"
              >
                <Plus className="h-4 w-4" />
                Add Stock
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 pt-4 border-t border-white/20">
        <p className="text-caption text-white/70 mb-2">Condition Breakdown</p>
        <div className="flex items-center gap-3 flex-wrap">
          {CONDITIONS.map((condition) => (
            <button
              key={condition}
              onClick={() => onConditionChange(condition)}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-pill border transition-colors ${
                activeCondition === condition
                  ? 'bg-white text-deep-teal border-white'
                  : 'bg-white/10 text-white border-white/15 hover:bg-white/20'
              }`}
            >
              <span>{condition}</span>
              <span className="font-semibold">{conditionCounts[condition] || 0}</span>
            </button>
          ))}
          {activeCondition !== 'all' && (
            <button
              onClick={() => onConditionChange(activeCondition)}
              className="text-caption text-white/70 hover:text-white underline ml-2"
            >
              Clear filter
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ZoneManagement({
  zones,
  canEdit,
  onAdd,
  onEdit,
}: {
  zones: WarehouseZone[];
  canEdit: boolean;
  onAdd: () => void;
  onEdit: (zone: WarehouseZone) => void;
}) {
  return (
    <section className="overflow-hidden rounded-apple-lg border border-gray-100 bg-white">
      <div className="flex items-center justify-between gap-4 border-b border-gray-100 px-5 py-4">
        <div>
          <h2 className="text-sub-heading font-semibold text-gray-900">Warehouse Zones</h2>
          <p className="mt-0.5 text-caption text-gray-500">Physical storage, staging, inspection, shipping, and receiving areas.</p>
        </div>
        {canEdit && (
          <button type="button" onClick={onAdd} className="btn-secondary">
            <Plus className="h-4 w-4" />
            Add Zone
          </button>
        )}
      </div>
      {zones.length === 0 ? (
        <div className="px-5 py-8 text-center">
          <MapPinned className="mx-auto mb-2 h-9 w-9 text-gray-300" />
          <p className="text-caption text-gray-500">No zones configured. Stock will use the warehouse-level bucket.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 divide-y divide-gray-100 md:grid-cols-2 md:divide-x md:divide-y-0 xl:grid-cols-3">
          {zones.map((zone) => (
            <div key={zone.id} className="flex items-center justify-between gap-3 px-5 py-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <MapPinned className="h-4 w-4 shrink-0 text-signal-teal" />
                  <p className="truncate font-medium text-gray-900">{zone.name}</p>
                </div>
                <p className="mt-1 text-micro capitalize text-gray-500">
                  {zone.zone_type} · {formatNumber(zone.total_units)} units
                  {zone.capacity_units !== null ? ` / ${formatNumber(zone.capacity_units)} capacity` : ''}
                </p>
              </div>
              {canEdit && (
                <button type="button" onClick={() => onEdit(zone)} className="rounded p-1.5 text-gray-400 hover:bg-signal-teal/10 hover:text-signal-teal" title={`Edit ${zone.name}`}>
                  <Pencil className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
function PartStockRow({ group, isExpanded, onToggle }: { group: PartStockGroup; isExpanded: boolean; onToggle: () => void }) {
  return (
    <div>
      <button onClick={onToggle} className="w-full p-4 hover:bg-gray-50 transition-colors text-left">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 flex-1 min-w-0">
            <ChevronRight className={`h-5 w-5 text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-gray-900">{group.modelName || group.partNumber}</span>
                {group.modelName && (
                  <span className="text-caption text-gray-500 font-mono">({group.partNumber})</span>
                )}
              </div>
              {group.category && <div className="text-caption text-gray-500 mt-0.5">{group.category}</div>}
            </div>
          </div>

          <div className="hidden md:flex items-center gap-2 mx-4 flex-wrap justify-end">
            {CONDITIONS.filter((condition) => (group.conditionCounts[condition] || 0) > 0).map((condition) => (
              <span key={condition} className={`px-2 py-0.5 rounded text-micro font-medium ${conditionStyles[condition]}`}>
                {condition}: {group.conditionCounts[condition]}
              </span>
            ))}
          </div>

          <div className="text-right min-w-[100px]">
            <div className="text-lg font-semibold text-gray-900">{formatNumber(group.totalUnits)} units</div>
            <div className="text-caption text-gray-500">{group.rows.length} stock rows</div>
          </div>
        </div>
      </button>

      {isExpanded && (
        <div className="bg-gray-50 border-t border-gray-100 animate-dropdown-in">
          <div className="divide-y divide-gray-100">
            {group.rows.map((row) => (
              <div key={row.id} className="pl-12 pr-4 py-3 hover:bg-white transition-colors">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-caption text-gray-700">{row.part_number}</span>
                    <span className="text-caption text-gray-500">Zone: {row.zone_name || 'Warehouse level'}</span>
                    <span className={`px-1.5 py-0.5 rounded text-micro font-medium ${conditionStyles[row.condition] || conditionStyles.Good}`}>
                      {row.condition}
                    </span>
                  </div>
                  <span className="font-medium text-gray-900">{formatNumber(row.quantity)} units</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function RecentMovements({ movements, title }: { movements: Movement[]; title: string }) {
  return (
    <div className="bg-white rounded-apple-lg shadow-none border border-gray-100 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <div>
          <h2 className="text-sub-heading font-semibold text-gray-900">{title}</h2>
          <p className="text-caption text-gray-500 mt-0.5">Latest inventory activity across warehouse locations</p>
        </div>
      </div>

      {movements.length === 0 ? (
        <div className="text-center py-10">
          <ArrowRightLeft className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <p className="text-caption text-gray-500">No movements recorded</p>
        </div>
      ) : (
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
              {movements.map((movement) => (
                <tr key={movement.id} className="hover:bg-gray-50/70 transition-colors">
                  <td className="px-4 py-3.5 text-gray-500 text-xs tabular-nums">{formatDate(movement.created_at)}</td>
                  <td className="px-4 py-3.5">
                    <span className={`badge border ${movementStyles[movement.movement_type] || movementStyles.Adjust}`}>
                      {movement.movement_type}
                    </span>
                  </td>
                  <td className="px-4 py-3.5">
                    <p className="font-medium text-gray-900">{movement.part_number}</p>
                    {movement.model_name && <p className="text-xs text-gray-400">{movement.model_name}</p>}
                  </td>
                  <td className="px-4 py-3.5 text-right font-semibold tabular-nums">{formatNumber(movement.quantity)}</td>
                  <td className="px-4 py-3.5 text-gray-500">{formatMovementLocation(movement.from_warehouse_name, movement.from_zone_name)}</td>
                  <td className="px-4 py-3.5 text-gray-500">{formatMovementLocation(movement.to_warehouse_name, movement.to_zone_name)}</td>
                  <td className="px-4 py-3.5 text-gray-400 text-xs">{movement.created_by_name || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function WarehouseFormModal({
  form,
  editing,
  saving,
  onChange,
  onClose,
  onSubmit,
}: {
  form: WarehouseForm;
  editing: boolean;
  saving: boolean;
  onChange: (updates: Partial<WarehouseForm>) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return createPortal(
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-apple-lg shadow-apple max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto" onClick={(event) => event.stopPropagation()}>
        <div className="p-6 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sub-heading font-bold text-gray-900">
            {editing ? 'Edit Warehouse' : 'Add New Warehouse'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-apple hover:bg-gray-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={onSubmit} className="p-6 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Warehouse Code *">
              <input
                type="text"
                value={form.code}
                onChange={(event) => onChange({ code: event.target.value })}
                placeholder="e.g., WH-DOHA-01"
                required
                className="input-base"
              />
            </Field>
            <Field label="Warehouse Name *">
              <input
                type="text"
                value={form.name}
                onChange={(event) => onChange({ name: event.target.value })}
                placeholder="e.g., Central Warehouse"
                required
                className="input-base"
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Country">
              <input
                type="text"
                value={form.country}
                onChange={(event) => onChange({ country: event.target.value })}
                placeholder="Select country..."
                className="input-base"
              />
            </Field>
            <Field label="City">
              <input
                type="text"
                value={form.city}
                onChange={(event) => onChange({ city: event.target.value })}
                placeholder="e.g., Doha"
                className="input-base"
              />
            </Field>
          </div>

          <Field label="Address">
            <textarea
              value={form.address}
              onChange={(event) => onChange({ address: event.target.value })}
              placeholder="e.g., Industrial Area, Street 42"
              rows={2}
              className="input-base"
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Capacity Units">
              <input
                type="number"
                min="0"
                value={form.capacity_units}
                onChange={(event) => onChange({ capacity_units: event.target.value })}
                placeholder="Total capacity"
                className="input-base"
              />
            </Field>
            <Field label="Status">
              <select
                value={form.status}
                onChange={(event) => onChange({ status: event.target.value })}
                className="input-base"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </Field>
          </div>

          {!editing && (
            <div className="space-y-4 border-t border-gray-100 pt-5">
              <div>
                <h3 className="text-caption font-semibold text-gray-900">Initial Zone</h3>
                <p className="text-micro text-gray-500">Optional. More zones can be added from the warehouse detail page.</p>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Field label="Zone Name">
                  <input
                    type="text"
                    value={form.initial_zone_name}
                    onChange={(event) => onChange({ initial_zone_name: event.target.value })}
                    placeholder="e.g., Receiving A"
                    className="input-base"
                  />
                </Field>
                <Field label="Zone Type">
                  <select
                    value={form.initial_zone_type}
                    onChange={(event) => onChange({ initial_zone_type: event.target.value })}
                    className="input-base capitalize"
                  >
                    {ZONE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                  </select>
                </Field>
                <Field label="Zone Capacity">
                  <input
                    type="number"
                    min="0"
                    value={form.initial_zone_capacity}
                    onChange={(event) => onChange({ initial_zone_capacity: event.target.value })}
                    placeholder="Optional"
                    className="input-base"
                  />
                </Field>
              </div>
            </div>
          )}
          <Field label="Notes">
            <textarea
              value={form.notes}
              onChange={(event) => onChange({ notes: event.target.value })}
              placeholder="Optional notes about this warehouse..."
              rows={2}
              className="input-base"
            />
          </Field>

          <div className="flex justify-end gap-3 pt-4">
            <button type="button" onClick={onClose} className="px-5 py-2.5 text-gray-700 hover:bg-gray-100 rounded-apple-md transition-colors" disabled={saving}>
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !form.name || !form.code}
              className="px-5 py-2.5 bg-signal-teal text-white rounded-apple-md transition-colors hover:bg-signal-teal/90 disabled:opacity-50 flex items-center gap-2"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {editing ? 'Update Warehouse' : 'Create Warehouse'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

function ZoneFormModal({
  form,
  editing,
  saving,
  onChange,
  onClose,
  onSubmit,
}: {
  form: ZoneForm;
  editing: boolean;
  saving: boolean;
  onChange: (updates: Partial<ZoneForm>) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="mx-4 w-full max-w-lg rounded-apple-lg bg-white shadow-apple" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-100 p-6">
          <div>
            <h2 className="text-sub-heading font-bold text-gray-900">{editing ? 'Edit Zone' : 'Add Zone'}</h2>
            <p className="mt-1 text-caption text-gray-500">Define a physical area within this warehouse.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-apple p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={onSubmit} className="space-y-5 p-6">
          <Field label="Zone Name *">
            <input value={form.name} onChange={(event) => onChange({ name: event.target.value })} placeholder="e.g., Storage A" required className="input-base" />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Zone Type *">
              <select value={form.zone_type} onChange={(event) => onChange({ zone_type: event.target.value })} className="input-base capitalize">
                {ZONE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
            </Field>
            <Field label="Capacity Units">
              <input type="number" min="0" value={form.capacity_units} onChange={(event) => onChange({ capacity_units: event.target.value })} placeholder="Optional" className="input-base" />
            </Field>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} disabled={saving} className="rounded-apple-md px-5 py-2.5 text-gray-700 hover:bg-gray-100">Cancel</button>
            <button type="submit" disabled={saving || !form.name.trim()} className="flex items-center gap-2 rounded-apple-md bg-signal-teal px-5 py-2.5 text-white hover:bg-signal-teal/90 disabled:opacity-50">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {editing ? 'Update Zone' : 'Create Zone'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
function MoveInventoryModal({
  form,
  warehouses,
  zones,
  partOptions,
  partSearching,
  partSearchText,
  showPartSuggestions,
  saving,
  onChange,
  onPartSearchTextChange,
  onPartFocus,
  onSelectPart,
  onClose,
  onSubmit,
}: {
  form: MoveForm;
  warehouses: WarehouseItem[];
  zones: WarehouseZone[];
  partOptions: PartOption[];
  partSearching: boolean;
  partSearchText: string;
  showPartSuggestions: boolean;
  saving: boolean;
  onChange: (updates: Partial<MoveForm>) => void;
  onPartSearchTextChange: (value: string) => void;
  onPartFocus: () => void;
  onSelectPart: (part: PartOption) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const needsSource = form.movement_type === 'Ship' || form.movement_type === 'Transfer';
  const needsDestination = form.movement_type === 'Receive' || form.movement_type === 'Transfer';

  return createPortal(
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-apple-lg shadow-apple max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto" onClick={(event) => event.stopPropagation()}>
        <div className="p-6 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-sub-heading font-bold text-gray-900">Move Inventory</h2>
            <p className="text-caption text-gray-500 mt-1">Receive, ship, transfer, or adjust stock by part and warehouse.</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-apple hover:bg-gray-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={onSubmit} className="p-6 space-y-5">
          <div>
            <label className="block text-caption font-medium text-gray-700 mb-2">Movement Type</label>
            <div className="grid grid-cols-4 gap-2">
              {['Receive', 'Ship', 'Transfer', 'Adjust'].map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => onChange({ movement_type: type, from_zone_id: '', to_zone_id: '' })}
                  className={`px-3 py-2.5 rounded-apple-md text-caption font-medium border transition-colors ${
                    form.movement_type === type
                      ? 'bg-signal-teal text-white border-signal-teal'
                      : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          <div className="relative">
            <label className="block text-caption font-medium text-gray-700 mb-2">Part Number *</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
              <input
                type="text"
                value={partSearchText || form.part_label}
                onChange={(event) => onPartSearchTextChange(event.target.value)}
                onFocus={onPartFocus}
                placeholder="Search by part number or model..."
                required
                className="w-full pl-10 pr-10 py-2.5 border border-gray-200 rounded-apple-md focus:ring-2 focus:ring-signal-teal/40 focus:border-transparent bg-white text-gray-900 placeholder-gray-400"
              />
              {partSearching && <RefreshCw className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 animate-spin" />}
            </div>

            {showPartSuggestions && (partSearchText.trim().length > 0 || partOptions.length > 0) && (
              <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-apple-md shadow-2xl overflow-hidden">
                <div className="max-h-60 overflow-y-auto">
                  {partOptions.length > 0 ? (
                    partOptions.map((part) => (
                      <button
                        key={part.id}
                        type="button"
                        onClick={() => onSelectPart(part)}
                        className="w-full text-left px-4 py-2.5 text-caption hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-mono font-medium text-gray-900">{part.part_number}</span>
                          {part.vendor && <span className="text-micro text-gray-400">{part.vendor}</span>}
                        </div>
                        {part.model_name && <p className="text-micro text-gray-500 mt-0.5 truncate">{part.model_name}</p>}
                      </button>
                    ))
                  ) : !partSearching ? (
                    <div className="px-4 py-3 text-caption text-gray-500">No matching parts found</div>
                  ) : null}
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Quantity *">
              <input
                type="number"
                min="1"
                value={form.quantity}
                onChange={(event) => onChange({ quantity: event.target.value })}
                required
                className="input-base"
              />
            </Field>
            <Field label="Condition">
              <select value={form.condition} onChange={(event) => onChange({ condition: event.target.value })} className="input-base">
                {CONDITIONS.map((condition) => (
                  <option key={condition} value={condition}>{condition}</option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label={needsSource ? 'Source Warehouse *' : 'Source Warehouse'}>
              <WarehouseSelect
                value={form.from_warehouse_id}
                warehouses={warehouses}
                onChange={(value) => onChange({ from_warehouse_id: value, from_zone_id: '' })}
                required={needsSource}
              />
            </Field>
            <Field label={needsDestination ? 'Destination Warehouse *' : 'Destination Warehouse'}>
              <WarehouseSelect
                value={form.to_warehouse_id}
                warehouses={warehouses}
                onChange={(value) => onChange({ to_warehouse_id: value, to_zone_id: '' })}
                required={needsDestination}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Source Zone">
              <ZoneSelect
                value={form.from_zone_id}
                warehouseId={form.from_warehouse_id}
                zones={zones}
                direction="source"
                onChange={(value) => onChange({ from_zone_id: value })}
              />
            </Field>
            <Field label="Destination Zone">
              <ZoneSelect
                value={form.to_zone_id}
                warehouseId={form.to_warehouse_id}
                zones={zones}
                direction="destination"
                onChange={(value) => onChange({ to_zone_id: value })}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Reference">
              <input
                value={form.reference}
                onChange={(event) => onChange({ reference: event.target.value })}
                placeholder="PO-12345"
                className="input-base"
              />
            </Field>
            <Field label="Notes">
              <input
                value={form.notes}
                onChange={(event) => onChange({ notes: event.target.value })}
                placeholder="Optional notes"
                className="input-base"
              />
            </Field>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button type="button" onClick={onClose} className="px-5 py-2.5 text-gray-700 hover:bg-gray-100 rounded-apple-md transition-colors" disabled={saving}>
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !form.part_id || !form.quantity || (needsSource && !form.from_warehouse_id) || (needsDestination && !form.to_warehouse_id)}
              className="px-5 py-2.5 bg-signal-teal text-white rounded-apple-md transition-colors flex items-center gap-2 disabled:opacity-50 hover:bg-signal-teal/90"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRightLeft className="h-4 w-4" />}
              Submit Movement
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

function WarehouseSelect({
  value,
  warehouses,
  required,
  onChange,
}: {
  value: string;
  warehouses: WarehouseItem[];
  required?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)} required={required} className="input-base">
      <option value="">Select warehouse...</option>
      {warehouses.map((warehouse) => (
        <option key={warehouse.id} value={warehouse.id}>
          {warehouse.name} ({warehouse.code})
        </option>
      ))}
    </select>
  );
}

function ZoneSelect({
  value,
  warehouseId,
  zones,
  direction,
  onChange,
}: {
  value: string;
  warehouseId: string;
  zones: WarehouseZone[];
  direction: 'source' | 'destination';
  onChange: (value: string) => void;
}) {
  const availableZones = zones.filter((zone) => zone.warehouse_id === warehouseId);
  const emptyLabel = direction === 'source'
    ? 'Automatic allocation across zones'
    : 'Warehouse level (no zone)';
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={!warehouseId}
      className="input-base disabled:bg-gray-50 disabled:text-gray-400"
    >
      <option value="">{warehouseId ? emptyLabel : 'Select warehouse first'}</option>
      {availableZones.map((zone) => (
        <option key={zone.id} value={zone.id}>{zone.name} ({zone.zone_type})</option>
      ))}
    </select>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-caption font-medium text-gray-700 mb-2">{label}</label>
      {children}
    </div>
  );
}
