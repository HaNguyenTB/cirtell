import { Fragment, useCallback, useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import {
  AlertCircle,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsLeft,
  ChevronsRight,
  Cpu,
  DollarSign,
  Download,
  FileText,
  Loader2,
  Pencil,
  Plus,
  Receipt,
  Search,
  ShoppingCart,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { apiRequest } from '../lib/api';
import { getToken } from '../lib/authToken';
import { useAuthStore } from '../stores/authStore';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8787';
const MOVEMENT_TYPES = ['Purchase', 'Sale', 'Redeploy', 'Recycle'] as const;
const CONDITIONS = [
  { value: 'NIB', label: 'New in Box (NIB)' },
  { value: 'NOB', label: 'New Open Box (NOB)' },
  { value: 'Used', label: 'Used' },
  { value: 'Refurbished', label: 'Refurbished' },
  { value: 'As-Is', label: 'As-Is' },
] as const;

type MovementType = (typeof MOVEMENT_TYPES)[number];
type NoticeType = 'success' | 'error';

interface Notice {
  type: NoticeType;
  text: string;
}

interface TransactionFilters {
  searchTerm: string;
  type: string;
  startDate: string;
  endDate: string;
}

interface TransactionSummary {
  total: number;
  purchases: number;
  sales: number;
  redeploys: number;
  recycles: number;
  totalValue: number;
}

interface EnrichedTxn {
  id: string;
  date: string;
  marketId?: string | null;
  marketName?: string | null;
  region?: string | null;
  movementType: MovementType;
  quantity: number;
  unitPrice: number;
  totalValue: number;
  vendor?: string | null;
  companyName?: string | null;
  partId?: string | null;
  partNumber?: string | null;
  partName?: string | null;
  technology?: string | null;
  category?: string | null;
  serialNumber?: string | null;
  condition?: string | null;
  poNumber?: string | null;
  poFileKey?: string | null;
  poFileName?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  contactId?: string | null;
  contactCompanyName?: string | null;
  contactPersonName?: string | null;
  sourceWarehouseId?: string | null;
  sourceWarehouseName?: string | null;
  sourceWarehouseCode?: string | null;
  destinationWarehouseId?: string | null;
  destinationWarehouseName?: string | null;
  destinationWarehouseCode?: string | null;
  itemCount?: number | null;
}

interface TransactionItemDetail {
  id: string;
  transactionId: string;
  partId?: string | null;
  partNumber?: string | null;
  partName?: string | null;
  technology?: string | null;
  category?: string | null;
  serialNumber?: string | null;
  condition?: string | null;
  quantity: number;
  unitPrice: number;
  totalValue: number;
  sourceWarehouseId?: string | null;
  sourceWarehouseName?: string | null;
  sourceWarehouseCode?: string | null;
  destinationWarehouseId?: string | null;
  destinationWarehouseName?: string | null;
  destinationWarehouseCode?: string | null;
  notes?: string | null;
}

interface TransactionPartOption {
  id: string;
  partNumber: string;
  partName?: string | null;
  vendor?: string | null;
  technology?: string | null;
  category?: string | null;
}

interface RawPart {
  id: string;
  part_number: string;
  model_name?: string | null;
  vendor?: string | null;
  technology_type?: string | null;
  category?: string | null;
}

interface MarketOption {
  id: string;
  marketName: string;
  country?: string | null;
  region?: string | null;
}

interface WarehouseOption {
  id: string;
  code: string;
  name: string;
  city?: string | null;
  country?: string | null;
  status?: string | null;
}

interface ProjectOption {
  id: string;
  projectName: string;
}

interface AddForm {
  date: string;
  movement_type: MovementType;
  market_id: string;
  part_id: string;
  part_number: string;
  vendor: string;
  quantity: string;
  unit_price_usd: string;
  serial_number: string;
  condition: string;
  source_warehouse_id: string;
  destination_warehouse_id: string;
  project_id: string;
  po_number: string;
}

interface EditForm extends AddForm {
  contact_id: string;
}

interface LineItemDraft {
  localId: string;
  part_id: string;
  part_number: string;
  quantity: string;
  unit_price_usd: string;
  serial_number: string;
  condition: string;
  source_warehouse_id: string;
  destination_warehouse_id: string;
  notes: string;
}

const DEFAULT_FILTERS: TransactionFilters = {
  searchTerm: '',
  type: '',
  startDate: '',
  endDate: '',
};

const DEFAULT_SUMMARY: TransactionSummary = {
  total: 0,
  purchases: 0,
  sales: 0,
  redeploys: 0,
  recycles: 0,
  totalValue: 0,
};

const DEFAULT_ADD_FORM: AddForm = {
  date: new Date().toISOString().slice(0, 10),
  movement_type: 'Purchase',
  market_id: '',
  part_id: '',
  part_number: '',
  vendor: '',
  quantity: '1',
  unit_price_usd: '0',
  serial_number: '',
  condition: '',
  source_warehouse_id: '',
  destination_warehouse_id: '',
  project_id: '',
  po_number: '',
};

function createLineItemDraft(): LineItemDraft {
  return {
    localId: Math.random().toString(36).slice(2),
    part_id: '',
    part_number: '',
    quantity: '1',
    unit_price_usd: '0',
    serial_number: '',
    condition: '',
    source_warehouse_id: '',
    destination_warehouse_id: '',
    notes: '',
  };
}

function formatCurrency(value: number | null | undefined): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function movementBadgeClass(type: string): string {
  switch (type) {
    case 'Purchase':
      return 'bg-signal-teal/15 text-signal-teal';
    case 'Sale':
      return 'bg-verified-green/15 text-verified-green';
    case 'Redeploy':
      return 'bg-blue-500/15 text-blue-600';
    case 'Recycle':
      return 'bg-amber-500/15 text-amber-600';
    default:
      return 'bg-gray-100 text-gray-600';
  }
}

function buildTransactionsCsv(transactions: EnrichedTxn[]): string {
  const headers = [
    'Date',
    'Type',
    'Market',
    'Part Number',
    'Part Name',
    'Serial Number',
    'Condition',
    'Source',
    'Destination',
    'Project',
    'PO Number',
    'Buyer',
    'Vendor',
    'Quantity',
    'Unit Price',
    'Total',
  ];

  const rows = transactions.map((txn) => [
    txn.date,
    txn.movementType,
    txn.marketName || '',
    txn.partNumber || '',
    txn.partName || '',
    txn.serialNumber || '',
    txn.condition || '',
    txn.sourceWarehouseCode || txn.sourceWarehouseName || '',
    txn.destinationWarehouseCode || txn.destinationWarehouseName || '',
    txn.projectName || '',
    txn.poNumber || '',
    txn.contactCompanyName || '',
    txn.vendor || txn.companyName || '',
    txn.quantity,
    txn.unitPrice,
    txn.totalValue,
  ]);

  const escapeCell = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
  return [headers, ...rows].map((row) => row.map(escapeCell).join(',')).join('\n');
}

async function readApiError(response: Response): Promise<string> {
  const parsed = await response.json().catch(() => null) as { error?: string; message?: string } | null;
  return parsed?.message || parsed?.error || response.statusText || 'Request failed';
}

async function uploadTransactionPO(transactionId: string, file: File): Promise<void> {
  const formData = new FormData();
  formData.append('file', file);
  const token = getToken();
  const headers: HeadersInit = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_URL}/api/transactions/${transactionId}/po-upload`, {
    method: 'POST',
    headers,
    body: formData,
  });

  if (!response.ok) throw new Error(await readApiError(response));
}

async function downloadTransactionPO(transaction: EnrichedTxn): Promise<void> {
  const token = getToken();
  const headers: HeadersInit = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_URL}/api/transactions/${transaction.id}/po-download`, { headers });
  if (!response.ok) throw new Error(await readApiError(response));

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = transaction.poFileName || 'purchase-order';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function fetchTransactionsApi(
  filters: TransactionFilters,
  pageSize: number,
  currentPage: number,
): Promise<{ transactions: EnrichedTxn[]; total: number }> {
  const response = await apiRequest<{ transactions: EnrichedTxn[]; total: number }>('/api/transactions', {
    params: {
      search: filters.searchTerm || undefined,
      movement_type: filters.type || undefined,
      start_date: filters.startDate || undefined,
      end_date: filters.endDate || undefined,
      limit: pageSize,
      offset: (currentPage - 1) * pageSize,
    },
  });
  return {
    transactions: response.transactions || [],
    total: response.total || 0,
  };
}

async function fetchSummaryApi(): Promise<TransactionSummary> {
  const response = await apiRequest<{ summary: TransactionSummary }>('/api/transactions/summary');
  return response.summary || DEFAULT_SUMMARY;
}

async function fetchPartsApi(): Promise<TransactionPartOption[]> {
  const response = await apiRequest<{ parts: RawPart[] }>('/api/parts', { params: { limit: 1000 } });
  return (response.parts || []).map((part) => ({
    id: part.id,
    partNumber: part.part_number,
    partName: part.model_name,
    vendor: part.vendor,
    technology: part.technology_type,
    category: part.category,
  }));
}

async function fetchMarketsApi(): Promise<MarketOption[]> {
  const response = await apiRequest<{ markets: MarketOption[] }>('/api/transactions/markets');
  return response.markets || [];
}

async function fetchWarehousesApi(): Promise<WarehouseOption[]> {
  const response = await apiRequest<{ warehouses: WarehouseOption[] }>('/api/transactions/warehouses-list');
  return response.warehouses || [];
}

async function fetchProjectsApi(): Promise<ProjectOption[]> {
  const response = await apiRequest<{ projects: ProjectOption[] }>('/api/transactions/projects-list');
  return response.projects || [];
}

async function fetchTransactionItemsApi(transactionId: string): Promise<TransactionItemDetail[]> {
  const response = await apiRequest<{ items: TransactionItemDetail[] }>(`/api/transactions/items/${transactionId}`);
  return response.items || [];
}

export function TransactionsPage() {
  const { user } = useAuthStore();
  const canEdit = user?.role === 'Admin' || user?.role === 'User';
  const canDelete = user?.role === 'Admin';

  const [transactions, setTransactions] = useState<EnrichedTxn[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<TransactionFilters>(DEFAULT_FILTERS);
  const [summary, setSummary] = useState<TransactionSummary>(DEFAULT_SUMMARY);
  const [totalCount, setTotalCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [refreshKey, setRefreshKey] = useState(0);

  const [parts, setParts] = useState<TransactionPartOption[]>([]);
  const [markets, setMarkets] = useState<MarketOption[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);

  const [expandedTxn, setExpandedTxn] = useState<string | null>(null);
  const [expandedItems, setExpandedItems] = useState<TransactionItemDetail[]>([]);
  const [expandedLoading, setExpandedLoading] = useState(false);
  const [uploadingPO, setUploadingPO] = useState<string | null>(null);

  const [showAddModal, setShowAddModal] = useState(false);
  const [editingTxn, setEditingTxn] = useState<EnrichedTxn | null>(null);
  const [deleteTxn, setDeleteTxn] = useState<EnrichedTxn | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const showNotice = useCallback((type: NoticeType, text: string) => {
    setNotice({ type, text });
    window.setTimeout(() => setNotice(null), 4500);
  }, []);

  const refreshTransactions = useCallback(() => {
    setRefreshKey((key) => key + 1);
  }, []);

  const loadReferences = useCallback(async () => {
    const [partsResult, marketsResult, warehousesResult, projectsResult] = await Promise.allSettled([
      fetchPartsApi(),
      fetchMarketsApi(),
      fetchWarehousesApi(),
      fetchProjectsApi(),
    ]);

    if (partsResult.status === 'fulfilled') setParts(partsResult.value);
    if (marketsResult.status === 'fulfilled') setMarkets(marketsResult.value);
    if (warehousesResult.status === 'fulfilled') setWarehouses(warehousesResult.value);
    if (projectsResult.status === 'fulfilled') setProjects(projectsResult.value);
  }, []);

  useEffect(() => {
    void loadReferences();
  }, [loadReferences]);

  useEffect(() => {
    let active = true;

    const loadSummary = async () => {
      try {
        const data = await fetchSummaryApi();
        if (active) setSummary(data);
      } catch (error) {
        if (active) showNotice('error', getErrorMessage(error, 'Failed to load transaction summary'));
      }
    };

    void loadSummary();
    return () => {
      active = false;
    };
  }, [refreshKey, showNotice]);

  useEffect(() => {
    let active = true;

    const loadTransactions = async () => {
      setLoading(true);
      try {
        const data = await fetchTransactionsApi(filters, pageSize, currentPage);
        if (!active) return;
        setTransactions(data.transactions);
        setTotalCount(data.total);
      } catch (error) {
        if (active) showNotice('error', getErrorMessage(error, 'Failed to load transactions'));
      } finally {
        if (active) setLoading(false);
      }
    };

    void loadTransactions();
    return () => {
      active = false;
    };
  }, [filters, currentPage, pageSize, refreshKey, showNotice]);

  const updateFilters = useCallback((nextFilters: TransactionFilters) => {
    setFilters(nextFilters);
    setCurrentPage(1);
  }, []);

  const toggleExpandTxn = useCallback(async (transactionId: string) => {
    if (expandedTxn === transactionId) {
      setExpandedTxn(null);
      setExpandedItems([]);
      return;
    }

    setExpandedTxn(transactionId);
    setExpandedLoading(true);
    setExpandedItems([]);
    try {
      const items = await fetchTransactionItemsApi(transactionId);
      setExpandedItems(items);
    } catch (error) {
      showNotice('error', getErrorMessage(error, 'Failed to load transaction items'));
    } finally {
      setExpandedLoading(false);
    }
  }, [expandedTxn, showNotice]);

  const exportToCSV = useCallback(() => {
    if (transactions.length === 0) return;
    const csvContent = buildTransactionsCsv(transactions);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }, [transactions]);

  const handlePODownload = useCallback(async (transaction: EnrichedTxn) => {
    try {
      await downloadTransactionPO(transaction);
    } catch (error) {
      showNotice('error', getErrorMessage(error, 'Failed to download PO file'));
    }
  }, [showNotice]);

  const handlePOUpload = useCallback(async (transactionId: string, file: File) => {
    setUploadingPO(transactionId);
    try {
      await uploadTransactionPO(transactionId, file);
      showNotice('success', 'PO file uploaded');
      refreshTransactions();
    } catch (error) {
      showNotice('error', getErrorMessage(error, 'Failed to upload PO file'));
    } finally {
      setUploadingPO(null);
    }
  }, [refreshTransactions, showNotice]);

  const handleDeleteConfirmed = useCallback(async () => {
    if (!deleteTxn) return;
    setDeleting(true);
    try {
      await apiRequest(`/api/transactions/${deleteTxn.id}`, { method: 'DELETE' });
      setDeleteTxn(null);
      showNotice('success', 'Transaction deleted');
      refreshTransactions();
    } catch (error) {
      showNotice('error', getErrorMessage(error, 'Failed to delete transaction'));
    } finally {
      setDeleting(false);
    }
  }, [deleteTxn, refreshTransactions, showNotice]);

  return (
    <div className="space-y-6">
      {notice && (
        <div className={`fixed right-6 top-6 z-[70] flex items-start gap-3 rounded-apple-lg border px-4 py-3 shadow-apple-sm ${
          notice.type === 'success'
            ? 'border-verified-green/30 bg-verified-green/10 text-deep-teal'
            : 'border-red-200 bg-red-50 text-red-800'
        }`}>
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="text-caption font-medium">{notice.text}</span>
        </div>
      )}

      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-tile font-semibold text-gray-900 dark:text-white">Transaction History</h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">Detailed pricing, buy, and sell history</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {canEdit && (
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 rounded-apple-md bg-verified-green px-4 py-2.5 text-caption font-medium text-white shadow-none transition-colors hover:bg-verified-green/90"
            >
              <Plus className="h-4 w-4" />
              Add Transaction
            </button>
          )}
          <button
            onClick={exportToCSV}
            disabled={transactions.length === 0}
            className="flex items-center gap-2 rounded-apple-md bg-signal-teal px-4 py-2.5 text-caption font-medium text-white shadow-none transition-colors hover:bg-signal-teal/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </button>
        </div>
      </div>

      <TransactionSummaryCards summary={summary} />

      <TransactionFiltersPanel filters={filters} onFiltersChange={updateFilters} />

      <TransactionsTable
        transactions={transactions}
        loading={loading}
        expandedTxn={expandedTxn}
        expandedItems={expandedItems}
        expandedLoading={expandedLoading}
        uploadingPO={uploadingPO}
        canEdit={canEdit}
        canDelete={canDelete}
        currentPage={currentPage}
        pageSize={pageSize}
        totalCount={totalCount}
        totalPages={totalPages}
        setCurrentPage={setCurrentPage}
        setPageSize={setPageSize}
        onToggleExpand={toggleExpandTxn}
        onPODownload={handlePODownload}
        onPOUpload={handlePOUpload}
        onEdit={setEditingTxn}
        onDelete={setDeleteTxn}
      />

      {showAddModal && (
        <AddTransactionModal
          parts={parts}
          markets={markets}
          warehouses={warehouses}
          projects={projects}
          onClose={() => setShowAddModal(false)}
          onCreated={() => {
            setShowAddModal(false);
            showNotice('success', 'Transaction created');
            refreshTransactions();
            void loadReferences();
          }}
        />
      )}

      {editingTxn && (
        <EditTransactionModal
          transaction={editingTxn}
          parts={parts}
          markets={markets}
          warehouses={warehouses}
          projects={projects}
          onClose={() => setEditingTxn(null)}
          onSaved={() => {
            setEditingTxn(null);
            showNotice('success', 'Transaction updated');
            refreshTransactions();
            void loadReferences();
          }}
        />
      )}

      {deleteTxn && (
        <DeleteTransactionModal
          transaction={deleteTxn}
          deleting={deleting}
          onCancel={() => setDeleteTxn(null)}
          onConfirm={handleDeleteConfirmed}
        />
      )}
    </div>
  );
}

interface SummaryCardsProps {
  summary: TransactionSummary;
}

function TransactionSummaryCards({ summary }: SummaryCardsProps) {
  const cards = [
    { label: 'Total Transactions', value: summary.total.toLocaleString(), icon: Receipt, color: 'text-signal-teal', bg: 'bg-signal-teal/15' },
    { label: 'Purchases', value: summary.purchases.toLocaleString(), icon: ShoppingCart, color: 'text-signal-teal', bg: 'bg-signal-teal/15' },
    { label: 'Sales', value: summary.sales.toLocaleString(), icon: ArrowUpRight, color: 'text-verified-green', bg: 'bg-verified-green/15' },
    { label: 'Total Value', value: formatCurrency(summary.totalValue), icon: DollarSign, color: 'text-amber-500', bg: 'bg-amber-500/15' },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 stagger-tiles">
      {cards.map((card) => (
        <div key={card.label} className="rounded-apple-lg border border-gray-100 bg-white p-6 shadow-none transition-all hover:shadow-apple-sm dark:border-white/[0.04] dark:bg-surface-card">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <p className="text-caption font-medium text-gray-500 dark:text-gray-400">{card.label}</p>
              <p className="mt-2 text-tile font-semibold text-gray-900 dark:text-white">{card.value}</p>
            </div>
            <div className={`flex h-12 w-12 items-center justify-center rounded-apple-xl ${card.bg}`}>
              <card.icon className={`h-6 w-6 ${card.color}`} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

interface FiltersPanelProps {
  filters: TransactionFilters;
  onFiltersChange: (filters: TransactionFilters) => void;
}

function TransactionFiltersPanel({ filters, onFiltersChange }: FiltersPanelProps) {
  const updateFilter = (field: keyof TransactionFilters, value: string) => {
    onFiltersChange({ ...filters, [field]: value });
  };

  return (
    <div className="rounded-apple-md border border-gray-200 bg-white p-4 shadow-none dark:border-white/[0.04] dark:bg-surface-card">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.5fr_1fr_1fr_1fr_auto]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            value={filters.searchTerm}
            onChange={(event) => updateFilter('searchTerm', event.target.value)}
            placeholder="Search part number, market, vendor..."
            className="input-base pl-10"
          />
        </div>
        <input
          type="date"
          value={filters.startDate}
          onChange={(event) => updateFilter('startDate', event.target.value)}
          className="input-base"
        />
        <input
          type="date"
          value={filters.endDate}
          onChange={(event) => updateFilter('endDate', event.target.value)}
          className="input-base"
        />
        <select
          value={filters.type}
          onChange={(event) => updateFilter('type', event.target.value)}
          className="input-base"
        >
          <option value="">All Types</option>
          {MOVEMENT_TYPES.map((type) => (
            <option key={type} value={type}>{type}</option>
          ))}
        </select>
        <button
          onClick={() => onFiltersChange(DEFAULT_FILTERS)}
          className="rounded-apple-md border border-gray-200 px-4 py-2.5 text-caption font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-white/10 dark:text-gray-300 dark:hover:bg-surface-hover"
        >
          Reset
        </button>
      </div>
    </div>
  );
}

interface TransactionsTableProps {
  transactions: EnrichedTxn[];
  loading: boolean;
  expandedTxn: string | null;
  expandedItems: TransactionItemDetail[];
  expandedLoading: boolean;
  uploadingPO: string | null;
  canEdit: boolean;
  canDelete: boolean;
  currentPage: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  setCurrentPage: Dispatch<SetStateAction<number>>;
  setPageSize: Dispatch<SetStateAction<number>>;
  onToggleExpand: (transactionId: string) => void;
  onPODownload: (transaction: EnrichedTxn) => void;
  onPOUpload: (transactionId: string, file: File) => void;
  onEdit: (transaction: EnrichedTxn) => void;
  onDelete: (transaction: EnrichedTxn) => void;
}

function TransactionsTable({
  transactions,
  loading,
  expandedTxn,
  expandedItems,
  expandedLoading,
  uploadingPO,
  canEdit,
  canDelete,
  currentPage,
  pageSize,
  totalCount,
  totalPages,
  setCurrentPage,
  setPageSize,
  onToggleExpand,
  onPODownload,
  onPOUpload,
  onEdit,
  onDelete,
}: TransactionsTableProps) {
  return (
    <div className="overflow-hidden rounded-apple-md border border-gray-200 bg-white shadow-none dark:border-white/[0.04] dark:bg-surface-card">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 dark:border-white/[0.04] dark:bg-surface-card-alt">
              <th className="px-6 py-4 text-left text-micro font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Date</th>
              <th className="px-6 py-4 text-left text-micro font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Type</th>
              <th className="px-6 py-4 text-left text-micro font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Part Details</th>
              <th className="px-6 py-4 text-left text-micro font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Serial #</th>
              <th className="px-6 py-4 text-left text-micro font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Condition</th>
              <th className="px-6 py-4 text-left text-micro font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Source / Dest</th>
              <th className="px-6 py-4 text-left text-micro font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Project / PO</th>
              <th className="px-6 py-4 text-left text-micro font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Buyer</th>
              <th className="px-6 py-4 text-right text-micro font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Qty</th>
              <th className="px-6 py-4 text-right text-micro font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Unit Price</th>
              <th className="px-6 py-4 text-right text-micro font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Total</th>
              <th className="px-6 py-4 text-center text-micro font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">PO</th>
              <th className="w-10 px-3 py-4 text-center text-micro font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-white/[0.04] stagger-rows">
            {loading ? (
              <TableRowsSkeleton rows={8} columns={13} />
            ) : transactions.length === 0 ? (
              <tr>
                <td colSpan={13} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
                  No transactions found matching your filters.
                </td>
              </tr>
            ) : (
              transactions.map((transaction) => (
                <Fragment key={transaction.id}>
                  <tr className="transition-colors hover:bg-gray-50 dark:hover:bg-surface-hover">
                    <td className="whitespace-nowrap px-6 py-4 text-caption text-gray-600 dark:text-gray-300">
                      {transaction.date}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <TransactionMovementBadge type={transaction.movementType} />
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-caption font-medium text-gray-900 dark:text-white">
                        {transaction.partNumber || 'Unassigned part'}
                      </div>
                      <div className="text-micro text-gray-500 dark:text-gray-400">
                        {transaction.partName || transaction.technology || transaction.category || transaction.marketName || ''}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-caption text-gray-600 dark:text-gray-300">
                      {Number(transaction.itemCount || 0) > 0 ? (
                        <button
                          onClick={() => onToggleExpand(transaction.id)}
                          className="inline-flex items-center gap-1 font-medium text-signal-teal transition-colors hover:text-signal-teal/80"
                        >
                          {expandedTxn === transaction.id ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                          {transaction.itemCount} item{Number(transaction.itemCount) > 1 ? 's' : ''}
                        </button>
                      ) : (
                        transaction.serialNumber || '-'
                      )}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      {transaction.condition ? (
                        <span className="inline-flex rounded bg-gray-100 px-2 py-0.5 text-micro font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-300">
                          {transaction.condition}
                        </span>
                      ) : '-'}
                    </td>
                    <td className="px-6 py-4 text-caption">
                      {transaction.sourceWarehouseCode || transaction.destinationWarehouseCode ? (
                        <div>
                          {transaction.sourceWarehouseCode && (
                            <div className="text-gray-600 dark:text-gray-300">
                              <span className="text-micro text-gray-400">From:</span> {transaction.sourceWarehouseCode}
                            </div>
                          )}
                          {transaction.destinationWarehouseCode && (
                            <div className="text-gray-600 dark:text-gray-300">
                              <span className="text-micro text-gray-400">To:</span> {transaction.destinationWarehouseCode}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-caption">
                      {transaction.projectName || transaction.poNumber ? (
                        <div>
                          {transaction.projectName && (
                            <div className="text-micro font-medium text-gray-900 dark:text-white">{transaction.projectName}</div>
                          )}
                          {transaction.poNumber && (
                            <div className="text-micro text-gray-500 dark:text-gray-400">PO: {transaction.poNumber}</div>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-caption">
                      {transaction.contactCompanyName ? (
                        <div>
                          <div className="text-micro font-medium text-gray-900 dark:text-white">{transaction.contactCompanyName}</div>
                          {transaction.contactPersonName && (
                            <div className="text-micro text-gray-500 dark:text-gray-400">{transaction.contactPersonName}</div>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-right text-caption font-medium text-gray-900 dark:text-white">
                      {Number(transaction.quantity || 0).toLocaleString()}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-right text-caption text-gray-600 dark:text-gray-300">
                      {formatCurrency(transaction.unitPrice)}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-right text-caption font-bold text-gray-900 dark:text-white">
                      {formatCurrency(transaction.totalValue)}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-center">
                      {transaction.poFileKey ? (
                        <button
                          onClick={() => onPODownload(transaction)}
                          className="inline-flex items-center gap-1 px-2 py-1 text-micro font-medium text-signal-teal transition-colors hover:text-signal-teal/80"
                          title={`Download ${transaction.poFileName || 'PO'}`}
                        >
                          <FileText className="h-3.5 w-3.5" />
                          View
                        </button>
                      ) : canEdit ? (
                        <label className="inline-flex cursor-pointer items-center gap-1 px-2 py-1 text-micro font-medium text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-300" title="Upload PO">
                          {uploadingPO === transaction.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Upload className="h-3.5 w-3.5" />
                          )}
                          <input
                            type="file"
                            className="hidden"
                            accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
                            onChange={(event) => {
                              const file = event.target.files?.[0];
                              if (file) onPOUpload(transaction.id, file);
                              event.target.value = '';
                            }}
                          />
                        </label>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-3 py-4 text-center">
                      <div className="inline-flex items-center gap-1">
                        {canEdit && (
                          <button
                            onClick={() => onEdit(transaction)}
                            className="rounded p-1 text-slate transition-colors hover:bg-signal-teal/15 hover:text-signal-teal"
                            title="Edit transaction"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {canDelete && (
                          <button
                            onClick={() => onDelete(transaction)}
                            className="rounded p-1 text-slate transition-colors hover:bg-red-500/15 hover:text-red-500"
                            title="Delete transaction"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {expandedTxn === transaction.id && (
                    <tr className="bg-signal-teal/5 dark:bg-signal-teal/10">
                      <td colSpan={13} className="px-6 py-3">
                        <ExpandedLineItems items={expandedItems} loading={expandedLoading} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="border-t border-gray-200 bg-gray-50/50 px-6 py-4 dark:border-white/[0.04] dark:bg-surface-card-alt">
        <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
          <div className="flex items-center gap-3">
            <span className="text-caption text-gray-500 dark:text-gray-400">
              {totalCount > 0
                ? `Showing ${(currentPage - 1) * pageSize + 1}-${Math.min(currentPage * pageSize, totalCount)} of ${totalCount.toLocaleString()}`
                : 'No results'}
            </span>
            <select
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setCurrentPage(1);
              }}
              className="rounded-apple border border-gray-300 bg-white px-3 py-2 text-caption text-gray-700 dark:border-white/10 dark:bg-surface-card dark:text-gray-300"
            >
              {[25, 50, 100, 250].map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-1">
            <PaginationButton title="First page" disabled={currentPage === 1} onClick={() => setCurrentPage(1)}>
              <ChevronsLeft className="h-4 w-4" />
            </PaginationButton>
            <PaginationButton title="Previous page" disabled={currentPage === 1} onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}>
              <ChevronLeft className="h-4 w-4" />
            </PaginationButton>
            <span className="rounded-apple-md bg-signal-teal/10 px-4 py-2 text-caption font-medium text-signal-teal">
              {currentPage} / {totalPages}
            </span>
            <PaginationButton title="Next page" disabled={currentPage === totalPages} onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}>
              <ChevronRight className="h-4 w-4" />
            </PaginationButton>
            <PaginationButton title="Last page" disabled={currentPage === totalPages} onClick={() => setCurrentPage(totalPages)}>
              <ChevronsRight className="h-4 w-4" />
            </PaginationButton>
          </div>
        </div>
      </div>
    </div>
  );
}

function TransactionMovementBadge({ type }: { type: string }) {
  return (
    <span className={`inline-flex rounded-pill px-2.5 py-1 text-micro font-semibold ${movementBadgeClass(type)}`}>
      {type}
    </span>
  );
}

function TableRowsSkeleton({ rows, columns }: { rows: number; columns: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <tr key={rowIndex}>
          {Array.from({ length: columns }).map((__, columnIndex) => (
            <td key={columnIndex} className="px-6 py-4">
              <div className="skeleton h-4 w-20 rounded" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function ExpandedLineItems({ items, loading }: { items: TransactionItemDetail[]; loading: boolean }) {
  if (loading) {
    return <div className="py-2 text-caption italic text-gray-400">Loading items...</div>;
  }

  if (items.length === 0) {
    return <div className="py-2 text-caption italic text-gray-400">No line items recorded.</div>;
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-1 text-micro font-semibold uppercase text-gray-500 dark:text-gray-400">
        <Cpu className="h-3 w-3" />
        Line Items ({items.length})
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-micro">
          <thead>
            <tr className="text-gray-400 dark:text-gray-500">
              <th className="pb-1 pr-4 text-left font-medium">#</th>
              <th className="pb-1 pr-4 text-left font-medium">Part</th>
              <th className="pb-1 pr-4 text-left font-medium">Serial #</th>
              <th className="pb-1 pr-4 text-left font-medium">Condition</th>
              <th className="pb-1 pr-4 text-right font-medium">Qty</th>
              <th className="pb-1 pr-4 text-right font-medium">Unit $</th>
              <th className="pb-1 pr-4 text-right font-medium">Total</th>
              <th className="pb-1 pr-4 text-left font-medium">Source</th>
              <th className="pb-1 text-left font-medium">Dest</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200/50 dark:divide-white/[0.04]">
            {items.map((item, index) => (
              <tr key={item.id} className="text-gray-700 dark:text-gray-300">
                <td className="py-1.5 pr-4 text-gray-400">{index + 1}</td>
                <td className="py-1.5 pr-4">
                  <span className="font-medium text-gray-900 dark:text-white">{item.partNumber || '-'}</span>
                  {item.partName && <span className="ml-1 text-gray-400">{item.partName}</span>}
                </td>
                <td className="py-1.5 pr-4 font-mono">{item.serialNumber || '-'}</td>
                <td className="py-1.5 pr-4">{item.condition || '-'}</td>
                <td className="py-1.5 pr-4 text-right">{item.quantity}</td>
                <td className="py-1.5 pr-4 text-right">{formatCurrency(item.unitPrice)}</td>
                <td className="py-1.5 pr-4 text-right font-medium text-gray-900 dark:text-white">{formatCurrency(item.totalValue)}</td>
                <td className="py-1.5 pr-4">{item.sourceWarehouseCode || '-'}</td>
                <td className="py-1.5">{item.destinationWarehouseCode || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PaginationButton({
  children,
  disabled,
  title,
  onClick,
}: {
  children: ReactNode;
  disabled: boolean;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-apple border border-gray-300 p-2 text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:text-gray-300 dark:hover:bg-surface-hover"
      title={title}
    >
      {children}
    </button>
  );
}

interface ModalReferenceProps {
  parts: TransactionPartOption[];
  markets: MarketOption[];
  warehouses: WarehouseOption[];
  projects: ProjectOption[];
}

interface AddTransactionModalProps extends ModalReferenceProps {
  onClose: () => void;
  onCreated: () => void;
}

function AddTransactionModal({ parts, markets, warehouses, projects, onClose, onCreated }: AddTransactionModalProps) {
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<'single' | 'multi'>('single');
  const [form, setForm] = useState<AddForm>(DEFAULT_ADD_FORM);
  const [items, setItems] = useState<LineItemDraft[]>([createLineItemDraft()]);
  const [poFile, setPoFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!form.market_id && markets.length > 0) {
      setForm((current) => ({ ...current, market_id: markets[0].id }));
    }
  }, [form.market_id, markets]);

  const lineItemTotals = useMemo(() => {
    const quantity = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    const total = items.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unit_price_usd || 0), 0);
    return { quantity, total };
  }, [items]);

  const simpleTotal = Number(form.quantity || 0) * Number(form.unit_price_usd || 0);
  const activeTotal = mode === 'single' ? simpleTotal : lineItemTotals.total;

  const updateForm = <K extends keyof AddForm>(field: K, value: AddForm[K]) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const updateItem = <K extends keyof LineItemDraft>(id: string, field: K, value: LineItemDraft[K]) => {
    setItems((current) => current.map((item) => (item.localId === id ? { ...item, [field]: value } : item)));
  };

  const validate = (): string | null => {
    if (!form.date) return 'Date is required';
    if (mode === 'single') {
      if (!form.part_id && !form.part_number.trim()) return 'Select a part or enter a new part number';
      if (Number(form.quantity) <= 0) return 'Quantity must be greater than zero';
      if (Number(form.unit_price_usd || 0) < 0) return 'Unit price must be zero or greater';
      return null;
    }

    for (const item of items) {
      if (!item.part_id && !item.part_number.trim()) return 'Each line item needs a part';
      if (Number(item.quantity) <= 0) return 'Each line item needs a positive quantity';
      if (Number(item.unit_price_usd || 0) < 0) return 'Line item unit prices must be zero or greater';
    }
    return null;
  };

  const handleSubmit = async () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError('');
    try {
      const commonPayload = {
        date: form.date,
        movement_type: form.movement_type,
        market_id: form.market_id || undefined,
        vendor: form.vendor.trim() || undefined,
        source_warehouse_id: form.source_warehouse_id || undefined,
        destination_warehouse_id: form.destination_warehouse_id || undefined,
        project_id: form.project_id || undefined,
        po_number: form.po_number.trim() || undefined,
      };

      const payload = mode === 'single'
        ? {
          ...commonPayload,
          part_id: form.part_id || undefined,
          part_number: form.part_id ? undefined : form.part_number.trim(),
          quantity: Number(form.quantity),
          unit_price_usd: Number(form.unit_price_usd || 0),
          serial_number: form.serial_number.trim() || undefined,
          condition: form.condition || undefined,
        }
        : {
          ...commonPayload,
          quantity: lineItemTotals.quantity,
          unit_price_usd: lineItemTotals.quantity > 0 ? lineItemTotals.total / lineItemTotals.quantity : 0,
          items: items.map((item) => ({
            part_id: item.part_id || undefined,
            part_number: item.part_id ? undefined : item.part_number.trim(),
            quantity: Number(item.quantity),
            unit_price_usd: Number(item.unit_price_usd || 0),
            serial_number: item.serial_number.trim() || undefined,
            condition: item.condition || undefined,
            source_warehouse_id: item.source_warehouse_id || form.source_warehouse_id || undefined,
            destination_warehouse_id: item.destination_warehouse_id || form.destination_warehouse_id || undefined,
            notes: item.notes.trim() || undefined,
          })),
        };

      const response = await apiRequest<{ id: string }>('/api/transactions', {
        method: 'POST',
        body: payload,
      });
      if (poFile) await uploadTransactionPO(response.id, poFile);
      onCreated();
    } catch (submitError) {
      setError(getErrorMessage(submitError, 'Failed to create transaction'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="Add Transaction" onClose={onClose} widthClass="max-w-2xl">
      <div className="border-b border-gray-100 px-6 py-4 dark:border-white/[0.04]">
        <StepIndicator step={step} labels={['Details', 'Items & Pricing', 'Logistics & Submit']} />
      </div>
      <div className="max-h-[68vh] overflow-y-auto px-6 py-5">
        {error && <ModalError message={error} />}
        {step === 0 && (
          <div className="grid gap-5 md:grid-cols-2">
            <Field label="Date" required>
              <input type="date" value={form.date} onChange={(event) => updateForm('date', event.target.value)} className="input-base" />
            </Field>
            <Field label="Market">
              <select value={form.market_id} onChange={(event) => updateForm('market_id', event.target.value)} className="input-base">
                <option value="">Global</option>
                {markets.map((market) => (
                  <option key={market.id} value={market.id}>{market.marketName}</option>
                ))}
              </select>
            </Field>
            <div className="md:col-span-2">
              <Field label="Movement Type" required>
                <MovementTypeSelector value={form.movement_type} onChange={(value) => updateForm('movement_type', value)} />
              </Field>
            </div>
          </div>
        )}
        {step === 1 && (
          <div className="space-y-5">
            <div className="inline-flex rounded-apple-md border border-gray-200 bg-gray-50 p-1 dark:border-white/10 dark:bg-surface-card-alt">
              <button
                onClick={() => setMode('single')}
                className={`rounded-apple px-4 py-2 text-caption font-medium transition-colors ${mode === 'single' ? 'bg-white text-signal-teal shadow-sm dark:bg-surface-card' : 'text-gray-500'}`}
              >
                Single Item
              </button>
              <button
                onClick={() => setMode('multi')}
                className={`rounded-apple px-4 py-2 text-caption font-medium transition-colors ${mode === 'multi' ? 'bg-white text-signal-teal shadow-sm dark:bg-surface-card' : 'text-gray-500'}`}
              >
                Multiple Items
              </button>
            </div>
            {mode === 'single' ? (
              <SingleItemFields form={form} parts={parts} onChange={setForm} />
            ) : (
              <MultiItemFields
                items={items}
                parts={parts}
                warehouses={warehouses}
                onAdd={() => setItems((current) => [...current, createLineItemDraft()])}
                onRemove={(id) => setItems((current) => current.length === 1 ? current : current.filter((item) => item.localId !== id))}
                onChange={updateItem}
                onPartSelected={(part) => setForm((current) => ({ ...current, vendor: part.vendor || current.vendor }))}
              />
            )}
          </div>
        )}
        {step === 2 && (
          <LogisticsFields
            form={form}
            warehouses={warehouses}
            projects={projects}
            poFile={poFile}
            totalValue={activeTotal}
            onFormChange={setForm}
            onFileChange={setPoFile}
          />
        )}
      </div>
      <div className="flex items-center justify-between border-t border-gray-100 bg-gray-50/50 px-6 py-4 dark:border-white/[0.04] dark:bg-surface-card-alt">
        <button onClick={onClose} className="btn-secondary">Cancel</button>
        <div className="flex items-center gap-2">
          {step > 0 && (
            <button onClick={() => setStep((current) => Math.max(0, current - 1))} className="btn-secondary">
              Back
            </button>
          )}
          {step < 2 ? (
            <button onClick={() => setStep((current) => Math.min(2, current + 1))} className="btn-primary">
              Next
            </button>
          ) : (
            <button onClick={handleSubmit} disabled={saving} className="btn-primary">
              {saving ? 'Saving...' : 'Submit Transaction'}
            </button>
          )}
        </div>
      </div>
    </ModalShell>
  );
}

interface EditTransactionModalProps extends ModalReferenceProps {
  transaction: EnrichedTxn;
  onClose: () => void;
  onSaved: () => void;
}

function EditTransactionModal({ transaction, parts, markets, warehouses, projects, onClose, onSaved }: EditTransactionModalProps) {
  const [form, setForm] = useState<EditForm>({
    date: transaction.date || new Date().toISOString().slice(0, 10),
    movement_type: transaction.movementType || 'Purchase',
    market_id: transaction.marketId || '',
    part_id: transaction.partId || '',
    part_number: transaction.partNumber || '',
    vendor: transaction.vendor || transaction.companyName || '',
    quantity: String(transaction.quantity || 1),
    unit_price_usd: String(transaction.unitPrice || 0),
    serial_number: transaction.serialNumber || '',
    condition: transaction.condition || '',
    source_warehouse_id: transaction.sourceWarehouseId || '',
    destination_warehouse_id: transaction.destinationWarehouseId || '',
    project_id: transaction.projectId || '',
    po_number: transaction.poNumber || '',
    contact_id: transaction.contactId || '',
  });
  const [poFile, setPoFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const updateForm = <K extends keyof EditForm>(field: K, value: EditForm[K]) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit = async () => {
    if (!form.date) {
      setError('Date is required');
      return;
    }
    if (Number(form.quantity) <= 0) {
      setError('Quantity must be greater than zero');
      return;
    }
    if (Number(form.unit_price_usd || 0) < 0) {
      setError('Unit price must be zero or greater');
      return;
    }

    setSaving(true);
    setError('');
    try {
      await apiRequest(`/api/transactions/${transaction.id}`, {
        method: 'PUT',
        body: {
          date: form.date,
          movement_type: form.movement_type,
          market_id: form.market_id || null,
          part_id: form.part_id || undefined,
          part_number: form.part_id ? undefined : form.part_number.trim() || undefined,
          vendor: form.vendor.trim() || null,
          quantity: Number(form.quantity),
          unit_price_usd: Number(form.unit_price_usd || 0),
          serial_number: form.serial_number.trim() || null,
          condition: form.condition || null,
          source_warehouse_id: form.source_warehouse_id || null,
          destination_warehouse_id: form.destination_warehouse_id || null,
          project_id: form.project_id || null,
          po_number: form.po_number.trim() || null,
          contact_id: form.contact_id || null,
        },
      });
      if (poFile) await uploadTransactionPO(transaction.id, poFile);
      onSaved();
    } catch (submitError) {
      setError(getErrorMessage(submitError, 'Failed to update transaction'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="Edit Transaction" onClose={onClose} widthClass="max-w-lg">
      <div className="max-h-[72vh] overflow-y-auto px-6 py-5">
        {error && <ModalError message={error} />}
        <div className="grid gap-5 md:grid-cols-2">
          <Field label="Date" required>
            <input type="date" value={form.date} onChange={(event) => updateForm('date', event.target.value)} className="input-base" />
          </Field>
          <Field label="Market">
            <select value={form.market_id} onChange={(event) => updateForm('market_id', event.target.value)} className="input-base">
              <option value="">Global</option>
              {markets.map((market) => (
                <option key={market.id} value={market.id}>{market.marketName}</option>
              ))}
            </select>
          </Field>
          <div className="md:col-span-2">
            <Field label="Movement Type" required>
              <MovementTypeSelector value={form.movement_type} onChange={(value) => updateForm('movement_type', value)} />
            </Field>
          </div>
          <Field label="Part">
            <PartSelector
              value={form.part_id}
              partNumber={form.part_number}
              parts={parts}
              onPartChange={(partId, part) => setForm((current) => ({
                ...current,
                part_id: partId,
                part_number: partId ? '' : current.part_number,
                vendor: part?.vendor || current.vendor,
              }))}
              onPartNumberChange={(partNumber) => updateForm('part_number', partNumber)}
            />
          </Field>
          <Field label="Vendor (auto-filled from part)">
            <input value={form.vendor} onChange={(event) => updateForm('vendor', event.target.value)} className="input-base" />
          </Field>
          <Field label="Quantity" required>
            <input type="number" min="1" value={form.quantity} onChange={(event) => updateForm('quantity', event.target.value)} className="input-base" />
          </Field>
          <Field label="Unit Price (USD)">
            <input type="number" min="0" step="0.01" value={form.unit_price_usd} onChange={(event) => updateForm('unit_price_usd', event.target.value)} className="input-base" />
          </Field>
          <Field label="Serial Number">
            <input value={form.serial_number} onChange={(event) => updateForm('serial_number', event.target.value)} className="input-base" />
          </Field>
          <Field label="Condition">
            <ConditionSelect value={form.condition} onChange={(value) => updateForm('condition', value)} />
          </Field>
          <Field label="Source Warehouse">
            <WarehouseSelect value={form.source_warehouse_id} warehouses={warehouses} onChange={(value) => updateForm('source_warehouse_id', value)} />
          </Field>
          <Field label="Destination Warehouse">
            <WarehouseSelect value={form.destination_warehouse_id} warehouses={warehouses} onChange={(value) => updateForm('destination_warehouse_id', value)} />
          </Field>
          <Field label="Project">
            <ProjectSelect value={form.project_id} projects={projects} onChange={(value) => updateForm('project_id', value)} />
          </Field>
          <Field label="PO Number">
            <input value={form.po_number} onChange={(event) => updateForm('po_number', event.target.value)} className="input-base" />
          </Field>
          <div className="md:col-span-2">
            <Field label="PO Document">
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
                onChange={(event) => setPoFile(event.target.files?.[0] || null)}
                className="input-base"
              />
            </Field>
          </div>
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-gray-100 bg-gray-50/50 px-6 py-4 dark:border-white/[0.04] dark:bg-surface-card-alt">
        <button onClick={onClose} className="btn-secondary">Cancel</button>
        <button onClick={handleSubmit} disabled={saving} className="btn-primary">
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </ModalShell>
  );
}

function SingleItemFields({
  form,
  parts,
  onChange,
}: {
  form: AddForm;
  parts: TransactionPartOption[];
  onChange: Dispatch<SetStateAction<AddForm>>;
}) {
  const update = <K extends keyof AddForm>(field: K, value: AddForm[K]) => {
    onChange((current) => ({ ...current, [field]: value }));
  };

  return (
    <div className="grid gap-5 md:grid-cols-2">
      <Field label="Part" required>
        <PartSelector
          value={form.part_id}
          partNumber={form.part_number}
          parts={parts}
          onPartChange={(partId, part) => onChange((current) => ({
            ...current,
            part_id: partId,
            part_number: partId ? '' : current.part_number,
            vendor: part?.vendor || current.vendor,
          }))}
          onPartNumberChange={(partNumber) => update('part_number', partNumber)}
        />
      </Field>
      <Field label="Vendor (auto-filled from part)">
        <input value={form.vendor} onChange={(event) => update('vendor', event.target.value)} className="input-base" />
      </Field>
      <Field label="Quantity" required>
        <input type="number" min="1" value={form.quantity} onChange={(event) => update('quantity', event.target.value)} className="input-base" />
      </Field>
      <Field label="Unit Price (USD)">
        <input type="number" min="0" step="0.01" value={form.unit_price_usd} onChange={(event) => update('unit_price_usd', event.target.value)} className="input-base" />
      </Field>
      <Field label="Serial Number">
        <input value={form.serial_number} onChange={(event) => update('serial_number', event.target.value)} className="input-base" />
      </Field>
      <Field label="Condition">
        <ConditionSelect value={form.condition} onChange={(value) => update('condition', value)} />
      </Field>
    </div>
  );
}

function MultiItemFields({
  items,
  parts,
  warehouses,
  onAdd,
  onRemove,
  onChange,
  onPartSelected,
}: {
  items: LineItemDraft[];
  parts: TransactionPartOption[];
  warehouses: WarehouseOption[];
  onAdd: () => void;
  onRemove: (id: string) => void;
  onChange: <K extends keyof LineItemDraft>(id: string, field: K, value: LineItemDraft[K]) => void;
  onPartSelected: (part: TransactionPartOption) => void;
}) {
  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <div key={item.localId} className="rounded-apple-md border border-gray-200 p-4 dark:border-white/10">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-caption font-semibold text-gray-900 dark:text-white">Item {index + 1}</div>
            <button onClick={() => onRemove(item.localId)} className="btn-ghost px-2 py-1 text-xs" disabled={items.length === 1}>
              <X className="h-3.5 w-3.5" />
              Remove
            </button>
          </div>
          <div className="grid gap-3 lg:grid-cols-4">
            <PartSelector
              value={item.part_id}
              partNumber={item.part_number}
              parts={parts}
              compact
              onPartChange={(partId, part) => {
                onChange(item.localId, 'part_id', partId);
                if (partId) onChange(item.localId, 'part_number', '');
                if (part) onPartSelected(part);
              }}
              onPartNumberChange={(partNumber) => onChange(item.localId, 'part_number', partNumber)}
            />
            <input
              type="number"
              min="1"
              value={item.quantity}
              onChange={(event) => onChange(item.localId, 'quantity', event.target.value)}
              placeholder="Qty"
              className="input-base"
            />
            <input
              type="number"
              min="0"
              step="0.01"
              value={item.unit_price_usd}
              onChange={(event) => onChange(item.localId, 'unit_price_usd', event.target.value)}
              placeholder="Unit price"
              className="input-base"
            />
            <ConditionSelect value={item.condition} onChange={(value) => onChange(item.localId, 'condition', value)} />
            <input
              value={item.serial_number}
              onChange={(event) => onChange(item.localId, 'serial_number', event.target.value)}
              placeholder="Serial number"
              className="input-base"
            />
            <WarehouseSelect value={item.source_warehouse_id} warehouses={warehouses} onChange={(value) => onChange(item.localId, 'source_warehouse_id', value)} compactLabel="Source" />
            <WarehouseSelect value={item.destination_warehouse_id} warehouses={warehouses} onChange={(value) => onChange(item.localId, 'destination_warehouse_id', value)} compactLabel="Destination" />
            <input
              value={item.notes}
              onChange={(event) => onChange(item.localId, 'notes', event.target.value)}
              placeholder="Notes"
              className="input-base"
            />
          </div>
        </div>
      ))}
      <button onClick={onAdd} className="btn-secondary">
        <Plus className="h-4 w-4" />
        Add Line Item
      </button>
    </div>
  );
}

function LogisticsFields({
  form,
  warehouses,
  projects,
  poFile,
  totalValue,
  onFormChange,
  onFileChange,
}: {
  form: AddForm;
  warehouses: WarehouseOption[];
  projects: ProjectOption[];
  poFile: File | null;
  totalValue: number;
  onFormChange: Dispatch<SetStateAction<AddForm>>;
  onFileChange: (file: File | null) => void;
}) {
  const update = <K extends keyof AddForm>(field: K, value: AddForm[K]) => {
    onFormChange((current) => ({ ...current, [field]: value }));
  };

  return (
    <div className="grid gap-5 md:grid-cols-2">
      <Field label="Source Warehouse">
        <WarehouseSelect value={form.source_warehouse_id} warehouses={warehouses} onChange={(value) => update('source_warehouse_id', value)} />
      </Field>
      <Field label="Destination Warehouse">
        <WarehouseSelect value={form.destination_warehouse_id} warehouses={warehouses} onChange={(value) => update('destination_warehouse_id', value)} />
      </Field>
      <Field label="Project">
        <ProjectSelect value={form.project_id} projects={projects} onChange={(value) => update('project_id', value)} />
      </Field>
      <Field label="PO Number">
        <input value={form.po_number} onChange={(event) => update('po_number', event.target.value)} className="input-base" />
      </Field>
      <div className="md:col-span-2">
        <Field label="PO Document">
          <input
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
            onChange={(event) => onFileChange(event.target.files?.[0] || null)}
            className="input-base"
          />
        </Field>
      </div>
      <div className="md:col-span-2 rounded-apple-lg border border-signal-teal/20 bg-signal-teal/5 p-4">
        <div className="flex items-center justify-between">
          <span className="text-caption font-medium text-gray-600 dark:text-gray-300">Transaction Value</span>
          <span className="text-tile font-semibold text-signal-teal">{formatCurrency(totalValue)}</span>
        </div>
        {poFile && (
          <div className="mt-2 text-micro text-gray-500 dark:text-gray-400">PO file: {poFile.name}</div>
        )}
      </div>
    </div>
  );
}

function PartSelector({
  value,
  partNumber,
  parts,
  compact = false,
  onPartChange,
  onPartNumberChange,
}: {
  value: string;
  partNumber: string;
  parts: TransactionPartOption[];
  compact?: boolean;
  onPartChange: (partId: string, part?: TransactionPartOption) => void;
  onPartNumberChange: (partNumber: string) => void;
}) {
  const selectedPart = useMemo(
    () => parts.find((part) => part.id === value),
    [parts, value],
  );
  const [searchText, setSearchText] = useState(selectedPart?.partNumber || partNumber);

  useEffect(() => {
    setSearchText(selectedPart?.partNumber || partNumber);
  }, [partNumber, selectedPart]);

  const filteredParts = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    const source = query
      ? parts.filter((part) => {
        const haystack = [
          part.partNumber,
          part.partName,
          part.vendor,
          part.technology,
          part.category,
        ].filter(Boolean).join(' ').toLowerCase();
        return haystack.includes(query);
      })
      : parts;
    return source.slice(0, compact ? 5 : 8);
  }, [compact, parts, searchText]);

  const handleSearchChange = (text: string) => {
    setSearchText(text);
    onPartChange('');
    onPartNumberChange(text);
  };

  if (value && selectedPart) {
    return (
      <div className="flex items-center gap-2 rounded-apple border border-signal-teal/20 bg-signal-teal/10 px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-caption font-medium text-signal-teal">
          {selectedPart.partNumber} - {selectedPart.partName || 'Unknown'}
        </span>
        {selectedPart.vendor && (
          <span className="hidden shrink-0 text-micro text-signal-teal/80 sm:inline">({selectedPart.vendor})</span>
        )}
        <button
          type="button"
          onClick={() => {
            onPartChange('');
            onPartNumberChange('');
          }}
          className="ml-auto rounded-apple p-0.5 hover:bg-signal-teal/10"
          title="Clear part"
        >
          <X className="h-4 w-4 text-signal-teal" />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={searchText}
          onChange={(event) => handleSearchChange(event.target.value)}
          placeholder="Search or enter new part number..."
          className="input-base pl-10"
        />
      </div>
      <div className={`${compact ? 'max-h-28' : 'max-h-36'} overflow-y-auto rounded-apple border border-gray-200 divide-y divide-gray-100 dark:border-white/10 dark:divide-white/[0.04]`}>
        {filteredParts.length === 0 ? (
          <div className="px-3 py-2 text-caption">
            {searchText.trim() ? (
              <div className="flex items-center justify-between gap-3">
                <span className="text-gray-400">No matching parts</span>
                <span className="shrink-0 text-micro font-medium text-signal-teal">New part will be created on save</span>
              </div>
            ) : (
              <span className="text-gray-400">Type to search parts...</span>
            )}
          </div>
        ) : (
          filteredParts.map((part) => (
            <button
              key={part.id}
              type="button"
              onClick={() => {
                onPartChange(part.id, part);
                onPartNumberChange('');
                setSearchText(part.partNumber);
              }}
              className="w-full px-3 py-2 text-left text-caption transition-colors hover:bg-gray-50 dark:hover:bg-surface-hover"
            >
              <span className="font-medium text-gray-900 dark:text-white">{part.partNumber}</span>
              {part.partName && <span className="ml-2 text-gray-500 dark:text-gray-400">{part.partName}</span>}
              {part.vendor && <span className="ml-1 text-micro text-gray-400 dark:text-gray-500">({part.vendor})</span>}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function ConditionSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)} className="input-base">
      <option value="">Condition</option>
      {CONDITIONS.map((condition) => (
        <option key={condition.value} value={condition.value}>{condition.label}</option>
      ))}
    </select>
  );
}

function WarehouseSelect({
  value,
  warehouses,
  compactLabel,
  onChange,
}: {
  value: string;
  warehouses: WarehouseOption[];
  compactLabel?: string;
  onChange: (value: string) => void;
}) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)} className="input-base">
      <option value="">{compactLabel || 'Select warehouse'}</option>
      {warehouses.map((warehouse) => (
        <option key={warehouse.id} value={warehouse.id}>
          {warehouse.code} - {warehouse.name}
        </option>
      ))}
    </select>
  );
}

function ProjectSelect({ value, projects, onChange }: { value: string; projects: ProjectOption[]; onChange: (value: string) => void }) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)} className="input-base">
      <option value="">No project</option>
      {projects.map((project) => (
        <option key={project.id} value={project.id}>{project.projectName}</option>
      ))}
    </select>
  );
}

function MovementTypeSelector({ value, onChange }: { value: MovementType; onChange: (value: MovementType) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      {MOVEMENT_TYPES.map((type) => (
        <button
          key={type}
          type="button"
          onClick={() => onChange(type)}
          className={`rounded-apple-md border px-4 py-3 text-caption font-semibold transition-colors ${
            value === type
              ? 'border-signal-teal bg-signal-teal/10 text-signal-teal'
              : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-white/10 dark:bg-surface-card dark:text-gray-300'
          }`}
        >
          {type}
        </button>
      ))}
    </div>
  );
}

function StepIndicator({ step, labels }: { step: number; labels: string[] }) {
  return (
    <div className="flex items-center gap-3">
      {labels.map((label, index) => (
        <Fragment key={label}>
          <div className="flex items-center gap-2">
            <div className={`flex h-7 w-7 items-center justify-center rounded-pill text-micro font-semibold ${
              index < step
                ? 'bg-verified-green text-white'
                : index === step
                  ? 'bg-signal-teal text-white'
                  : 'bg-gray-100 text-gray-500 dark:bg-surface-card-alt'
            }`}>
              {index < step ? <Check className="h-3.5 w-3.5" /> : index + 1}
            </div>
            <span className={`text-caption font-medium ${index === step ? 'text-signal-teal' : 'text-gray-500 dark:text-gray-400'}`}>
              {label}
            </span>
          </div>
          {index < labels.length - 1 && <div className="h-px flex-1 bg-gray-200 dark:bg-white/10" />}
        </Fragment>
      ))}
    </div>
  );
}

function ModalShell({
  title,
  widthClass,
  children,
  onClose,
}: {
  title: string;
  widthClass: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className={`modal-panel ${widthClass}`} onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4 dark:border-white/[0.04]">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">{title}</h2>
          <button onClick={onClose} className="btn-ghost p-1.5">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, required = false, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-micro font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
        {label}{required && <span className="text-verified-green"> *</span>}
      </span>
      {children}
    </label>
  );
}

function ModalError({ message }: { message: string }) {
  return (
    <div className="mb-4 flex items-start gap-2 rounded-apple-md border border-red-200 bg-red-50 p-3 text-caption text-red-700">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

function DeleteTransactionModal({
  transaction,
  deleting,
  onCancel,
  onConfirm,
}: {
  transaction: EnrichedTxn;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ModalShell title="Delete Transaction" onClose={onCancel} widthClass="max-w-md">
      <div className="px-6 py-5">
        <p className="text-caption text-gray-600 dark:text-gray-300">
          Delete {transaction.movementType.toLowerCase()} transaction for{' '}
          <span className="font-semibold text-gray-900 dark:text-white">{transaction.partNumber || 'unassigned part'}</span>?
        </p>
        <p className="mt-2 text-micro text-gray-500">This removes the transaction, line items, and PO file.</p>
      </div>
      <div className="flex justify-end gap-2 border-t border-gray-100 bg-gray-50/50 px-6 py-4 dark:border-white/[0.04] dark:bg-surface-card-alt">
        <button onClick={onCancel} className="btn-secondary">Cancel</button>
        <button
          onClick={onConfirm}
          disabled={deleting}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition-all duration-200 hover:bg-red-700 disabled:pointer-events-none disabled:opacity-50"
        >
          {deleting ? 'Deleting...' : 'Delete'}
        </button>
      </div>
    </ModalShell>
  );
}
