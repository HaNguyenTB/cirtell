import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { apiRequest } from '../lib/api';
import { useAuthStore } from '../stores/authStore';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Building2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  Leaf,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Trash2,
  Upload,
  X,
  type LucideIcon,
} from 'lucide-react';

interface Part {
  id: string;
  part_number: string;
  manufacturer_part_number: string | null;
  model_name: string | null;
  vendor: string | null;
  technology_type: string | null;
  weight_kg: number | null;
  emission_factor_kg: number | null;
  manufacture_start_year?: number | null;
  manufacture_end_year?: number | null;
  category: string | null;
  subcategory: string | null;
  description: string | null;
  price?: number | null;
  needs_review?: boolean | number | null;
  review_notes?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  tenant_name?: string | null;
}

type PartColumn = keyof Part;

interface ColumnConfig {
  key: PartColumn;
  label: string;
  visible: boolean;
  align?: 'left' | 'right';
}

interface PartForm {
  part_number: string;
  manufacturer_part_number: string;
  model_name: string;
  vendor: string;
  technology_type: string;
  weight_kg: string;
  emission_factor_kg: string;
  manufacture_start_year: string;
  manufacture_end_year: string;
  category: string;
  subcategory: string;
  description: string;
  needs_review: boolean;
  review_notes: string;
}

interface ImportPartPayload {
  part_number?: string;
  manufacturer_part_number?: string | null;
  model_name?: string | null;
  vendor?: string | null;
  technology_type?: string | null;
  weight_kg?: number | null;
  emission_factor_kg?: number | null;
  manufacture_start_year?: number | null;
  manufacture_end_year?: number | null;
  category?: string | null;
  subcategory?: string | null;
  description?: string | null;
  needs_review?: boolean;
  review_notes?: string | null;
}

interface ImportIssue {
  row: number;
  part_number?: string;
  error: string;
}

interface ImportSummary {
  created: number;
  updated: number;
  skipped: number;
  total: number;
}

interface PartsFilters {
  vendor: string;
  technology: string;
  category: string;
  showNeedsReview: boolean;
}

const DEFAULT_COLUMNS: ColumnConfig[] = [
  { key: 'part_number', label: 'Part Number', visible: true },
  { key: 'manufacturer_part_number', label: 'Mfr Part Number', visible: true },
  { key: 'model_name', label: 'Model Name', visible: true },
  { key: 'vendor', label: 'Vendor', visible: true },
  { key: 'technology_type', label: 'Technology', visible: true },
  { key: 'category', label: 'Category', visible: true },
  { key: 'subcategory', label: 'Subcategory', visible: true },
  { key: 'needs_review', label: 'Needs Review', visible: true },
  { key: 'weight_kg', label: 'Weight (kg)', visible: true, align: 'right' },
  { key: 'emission_factor_kg', label: 'CO2e Factor', visible: true, align: 'right' },
  { key: 'created_at', label: 'Uploaded', visible: true },
  { key: 'description', label: 'Description', visible: false },
  { key: 'review_notes', label: 'Review Notes', visible: false },
  { key: 'updated_at', label: 'Modified', visible: false },
];

const emptyForm: PartForm = {
  part_number: '',
  manufacturer_part_number: '',
  model_name: '',
  vendor: '',
  technology_type: '',
  weight_kg: '',
  emission_factor_kg: '',
  manufacture_start_year: '',
  manufacture_end_year: '',
  category: '',
  subcategory: '',
  description: '',
  needs_review: false,
  review_notes: '',
};

const PAGE_SIZE_OPTIONS = [25, 50, 100, 250];
const VENDOR_COLORS = ['#0E5A5A', '#25957B', '#3BCF9B', '#065F46'];
const IMPORT_LIMIT = 1000;

const IMPORT_HEADER_MAP: Record<string, keyof ImportPartPayload> = {
  partnumber: 'part_number',
  partno: 'part_number',
  part: 'part_number',
  sku: 'part_number',
  itemnumber: 'part_number',
  manufacturerpartnumber: 'manufacturer_part_number',
  mfrpartnumber: 'manufacturer_part_number',
  mfrpartno: 'manufacturer_part_number',
  mpn: 'manufacturer_part_number',
  modelname: 'model_name',
  model: 'model_name',
  partname: 'model_name',
  name: 'model_name',
  vendor: 'vendor',
  manufacturer: 'vendor',
  supplier: 'vendor',
  technology: 'technology_type',
  technologytype: 'technology_type',
  weight: 'weight_kg',
  weightkg: 'weight_kg',
  emissionfactor: 'emission_factor_kg',
  co2efactor: 'emission_factor_kg',
  co2factor: 'emission_factor_kg',
  carbonfactor: 'emission_factor_kg',
  manufacturestartyear: 'manufacture_start_year',
  startyear: 'manufacture_start_year',
  manufactureendyear: 'manufacture_end_year',
  endyear: 'manufacture_end_year',
  category: 'category',
  subcategory: 'subcategory',
  description: 'description',
  needsreview: 'needs_review',
  review: 'needs_review',
  reviewnotes: 'review_notes',
  notes: 'review_notes',
};

function isTruthyReview(value: Part['needs_review']) {
  return value === true || value === 1;
}

function getMissingFields(part: Part) {
  const missing: string[] = [];
  if (!part.model_name) missing.push('Model Name');
  if (!part.vendor) missing.push('Vendor');
  if (!part.technology_type) missing.push('Technology');
  if (!part.category) missing.push('Category');
  if (part.weight_kg == null) missing.push('Weight');
  if (part.emission_factor_kg == null) missing.push('CO2e Factor');
  return missing;
}

function partNeedsReview(part: Part) {
  return isTruthyReview(part.needs_review) || getMissingFields(part).length > 0;
}

function formatEmpty(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return '-';
  return String(value);
}

function formatDate(value: string | null | undefined) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString();
}

function parseNumeric(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeImportHeader(value: unknown) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function isBlankImportCell(value: unknown) {
  return value === null || value === undefined || String(value).trim() === '';
}

function importText(value: unknown, maxLength = 500): string | null {
  if (isBlankImportCell(value)) return null;
  const text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).trim();
  return text ? text.slice(0, maxLength) : null;
}

function importNumber(value: unknown): number | null {
  if (isBlankImportCell(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function importInteger(value: unknown): number | null {
  const parsed = importNumber(value);
  return parsed === null ? null : Math.trunc(parsed);
}

function importBoolean(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || isBlankImportCell(value)) return false;
  return ['1', 'true', 'yes', 'y', 'review', 'needs review'].includes(String(value).trim().toLowerCase());
}

function parseCsvRows(text: string): unknown[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }

  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function parseImportRows(rows: unknown[][]): { parts: ImportPartPayload[]; issues: ImportIssue[] } {
  const headerIndex = rows.findIndex((row) => row.some((cell) => !isBlankImportCell(cell)));
  if (headerIndex === -1) {
    return { parts: [], issues: [{ row: 1, error: 'The file is empty' }] };
  }

  const headers = rows[headerIndex].map((header) => IMPORT_HEADER_MAP[normalizeImportHeader(header)] || null);
  if (!headers.includes('part_number')) {
    return { parts: [], issues: [{ row: headerIndex + 1, error: 'A Part Number column is required' }] };
  }

  const parts: ImportPartPayload[] = [];
  const issues: ImportIssue[] = [];

  for (const [rowOffset, row] of rows.slice(headerIndex + 1).entries()) {
    const rowNumber = headerIndex + rowOffset + 2;
    if (!row.some((cell) => !isBlankImportCell(cell))) continue;

    const item: ImportPartPayload = {};
    headers.forEach((field, columnIndex) => {
      if (!field) return;
      const value = row[columnIndex];
      if (field === 'needs_review') {
        if (!isBlankImportCell(value)) item.needs_review = importBoolean(value);
        return;
      }
      if (field === 'weight_kg' || field === 'emission_factor_kg') {
        if (!isBlankImportCell(value)) (item as Record<string, unknown>)[field] = importNumber(value);
        return;
      }
      if (field === 'manufacture_start_year' || field === 'manufacture_end_year') {
        if (!isBlankImportCell(value)) (item as Record<string, unknown>)[field] = importInteger(value);
        return;
      }
      if (!isBlankImportCell(value)) {
        const text = importText(value, field === 'description' ? 2000 : 500);
        if (text !== null) (item as Record<string, unknown>)[field] = text;
      }
    });

    if (!item.part_number) {
      issues.push({ row: rowNumber, error: 'Part Number is required' });
      continue;
    }

    parts.push(item);
  }

  if (parts.length > IMPORT_LIMIT) {
    issues.push({ row: IMPORT_LIMIT + 2, error: `Only the first ${IMPORT_LIMIT} valid rows will be imported` });
    return { parts: parts.slice(0, IMPORT_LIMIT), issues };
  }

  return { parts, issues };
}

function uniqueValues(parts: Part[], key: PartColumn) {
  return Array.from(
    new Set(parts.map((part) => part[key]).filter((value): value is string => typeof value === 'string' && value.trim().length > 0)),
  ).sort((a, b) => a.localeCompare(b));
}

function getVendorInitials(vendor: string | null | undefined) {
  if (!vendor) return '?';
  return vendor
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
}

function getVendorColor(vendor: string) {
  const code = vendor.split('').reduce((total, char) => total + char.charCodeAt(0), 0);
  return VENDOR_COLORS[code % VENDOR_COLORS.length];
}

function getCellExportValue(part: Part, column: ColumnConfig) {
  const value = part[column.key];
  if (column.key === 'needs_review') return partNeedsReview(part) ? 'Review' : 'Complete';
  if (column.key === 'created_at' || column.key === 'updated_at') return formatDate(value as string | null | undefined);
  return value === null || value === undefined ? '' : String(value);
}

function sortParts(parts: Part[], column: PartColumn | null, direction: 'asc' | 'desc') {
  if (!column) return parts;
  const multiplier = direction === 'asc' ? 1 : -1;
  return [...parts].sort((a, b) => {
    if (column === 'needs_review') {
      return (Number(partNeedsReview(a)) - Number(partNeedsReview(b))) * multiplier;
    }

    const aValue = a[column];
    const bValue = b[column];
    if (aValue == null && bValue == null) return 0;
    if (aValue == null) return 1;
    if (bValue == null) return -1;
    if (typeof aValue === 'number' && typeof bValue === 'number') return (aValue - bValue) * multiplier;
    return String(aValue).localeCompare(String(bValue), undefined, { numeric: true, sensitivity: 'base' }) * multiplier;
  });
}

function KpiCard({
  icon: Icon,
  label,
  value,
  detail,
  active = false,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left bg-white rounded-apple-lg p-6 shadow-none border hover:shadow-apple-sm transition-all ${
        onClick ? 'cursor-pointer' : 'cursor-default'
      } ${active ? 'border-signal-teal ring-2 ring-signal-teal/20' : 'border-gray-100'}`}
    >
      <div className="flex items-center justify-between mb-4">
        <div className="w-12 h-12 rounded-apple-xl flex items-center justify-center bg-signal-teal/15">
          <Icon className="w-6 h-6 text-signal-teal" />
        </div>
        {active && (
          <span className="px-2.5 py-1 rounded-apple-sm text-micro font-semibold bg-signal-teal/10 text-signal-teal border border-signal-teal/20">
            Filtered
          </span>
        )}
      </div>
      <p className="text-caption font-medium text-gray-500 mb-1">{label}</p>
      <p className="text-tile font-semibold text-gray-900">{value}</p>
      <p className="text-micro text-gray-400 mt-2">{detail}</p>
    </button>
  );
}

function VendorPill({ vendor }: { vendor: string | null }) {
  if (!vendor) return <span className="text-gray-400 text-caption">-</span>;
  return (
    <span className="px-2.5 py-1 inline-flex items-center gap-1.5 text-micro leading-5 font-medium rounded-pill bg-deep-teal/15 text-deep-teal border border-deep-teal/20">
      <span
        className="w-4 h-4 rounded-sm flex items-center justify-center text-[8px] font-bold text-white shrink-0"
        style={{ backgroundColor: getVendorColor(vendor) }}
      >
        {getVendorInitials(vendor)}
      </span>
      {vendor}
    </span>
  );
}

function ReviewBadge({ part }: { part: Part }) {
  const missing = getMissingFields(part);
  if (!partNeedsReview(part)) {
    return (
      <span className="px-2.5 py-1 inline-flex items-center gap-1 text-micro leading-5 font-medium rounded-apple bg-verified-green/10 text-verified-green">
        <CheckCircle2 className="w-3 h-3" />
        Complete
      </span>
    );
  }

  return (
    <div className="relative group">
      <span className="px-2.5 py-1 inline-flex items-center gap-1.5 text-micro leading-5 font-semibold rounded-apple bg-amber-50 text-amber-700 border border-amber-200">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
        {missing.length > 0 ? `${missing.length} Missing` : 'Review'}
      </span>
      {missing.length > 0 && (
        <div className="absolute bottom-full left-0 mb-2 hidden group-hover:block z-20">
          <div className="bg-gray-900 border border-white/[0.08] text-white text-micro rounded-apple py-2 px-3 whitespace-nowrap shadow-apple">
            <div className="font-semibold mb-1 text-amber-400">Missing Fields:</div>
            {missing.map((field) => (
              <div key={field} className="text-gray-300">- {field}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function PartsPage() {
  const { user } = useAuthStore();
  const canEdit = user?.role === 'Admin' || user?.role === 'User';
  const importInputRef = useRef<HTMLInputElement>(null);

  const [parts, setParts] = useState<Part[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [filters, setFilters] = useState<PartsFilters>({ vendor: '', technology: '', category: '', showNeedsReview: false });
  const [columns, setColumns] = useState<ColumnConfig[]>(DEFAULT_COLUMNS);
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sortColumn, setSortColumn] = useState<PartColumn | null>('part_number');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [vendorOptions, setVendorOptions] = useState<string[]>([]);

  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<PartForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [importIssues, setImportIssues] = useState<ImportIssue[]>([]);

  const fetchParts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{ success: boolean; parts: Part[]; total: number }>(
        '/api/parts',
        {
          params: {
            search: search || undefined,
            vendor: filters.vendor || undefined,
            category: filters.category || undefined,
            limit: pageSize,
            offset,
          },
        },
      );
      setParts(res.parts || []);
      setTotal(res.total || 0);
      setSelectedIds(new Set());
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load parts from backend');
    } finally {
      setLoading(false);
    }
  }, [filters.category, filters.vendor, offset, pageSize, search]);

  useEffect(() => {
    fetchParts();
  }, [fetchParts]);

  useEffect(() => {
    let cancelled = false;
    apiRequest<{ success: boolean; vendors: { id: string; vendor_name: string }[] }>('/api/parts/vendors/list')
      .then((res) => {
        if (!cancelled) setVendorOptions((res.vendors || []).map((vendor) => vendor.vendor_name).sort());
      })
      .catch(() => {
        if (!cancelled) setVendorOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const visibleColumns = useMemo(() => columns.filter((column) => column.visible), [columns]);
  const categoryOptions = useMemo(() => uniqueValues(parts, 'category'), [parts]);
  const technologyOptions = useMemo(() => uniqueValues(parts, 'technology_type'), [parts]);
  const resolvedVendorOptions = vendorOptions.length > 0 ? vendorOptions : uniqueValues(parts, 'vendor');

  const displayParts = useMemo(() => {
    const filtered = parts.filter((part) => {
      if (filters.technology && part.technology_type !== filters.technology) return false;
      if (filters.showNeedsReview && !partNeedsReview(part)) return false;
      return true;
    });
    return sortParts(filtered, sortColumn, sortDirection);
  }, [filters.showNeedsReview, filters.technology, parts, sortColumn, sortDirection]);

  const stats = useMemo(() => {
    const needsReview = parts.filter(partNeedsReview).length;
    const vendors = uniqueValues(parts, 'vendor').length;
    const categories = uniqueValues(parts, 'category').length;
    const emissionValues = parts
      .map((part) => part.emission_factor_kg)
      .filter((value): value is number => typeof value === 'number');
    const avgEmissionFactor = emissionValues.length
      ? emissionValues.reduce((sum, value) => sum + value, 0) / emissionValues.length
      : 0;

    return { needsReview, vendors, categories, avgEmissionFactor };
  }, [parts]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.floor(offset / pageSize) + 1;

  const updateFilter = (key: keyof PartsFilters, value: string | boolean) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setOffset(0);
  };

  const updateFormField = <K extends keyof PartForm>(key: K, value: PartForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSearch = (event: ChangeEvent<HTMLInputElement>) => {
    setSearch(event.target.value);
    setOffset(0);
  };

  const openCreate = () => {
    setForm(emptyForm);
    setEditId(null);
    setShowForm(true);
    setError('');
  };

  const openEdit = (part: Part) => {
    setForm({
      part_number: part.part_number,
      manufacturer_part_number: part.manufacturer_part_number || '',
      model_name: part.model_name || '',
      vendor: part.vendor || '',
      technology_type: part.technology_type || '',
      weight_kg: part.weight_kg?.toString() || '',
      emission_factor_kg: part.emission_factor_kg?.toString() || '',
      manufacture_start_year: part.manufacture_start_year?.toString() || '',
      manufacture_end_year: part.manufacture_end_year?.toString() || '',
      category: part.category || '',
      subcategory: part.subcategory || '',
      description: part.description || '',
      needs_review: isTruthyReview(part.needs_review),
      review_notes: part.review_notes || '',
    });
    setEditId(part.id);
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
      const body = {
        part_number: form.part_number.trim(),
        manufacturer_part_number: form.manufacturer_part_number.trim() || null,
        model_name: form.model_name.trim() || null,
        vendor: form.vendor.trim() || null,
        technology_type: form.technology_type.trim() || null,
        weight_kg: parseNumeric(form.weight_kg),
        emission_factor_kg: parseNumeric(form.emission_factor_kg),
        manufacture_start_year: parseNumeric(form.manufacture_start_year),
        manufacture_end_year: parseNumeric(form.manufacture_end_year),
        category: form.category.trim() || null,
        subcategory: form.subcategory.trim() || null,
        description: form.description.trim() || null,
        needs_review: form.needs_review,
        review_notes: form.review_notes.trim() || null,
      };
      if (editId) {
        await apiRequest(`/api/parts/${editId}`, { method: 'PUT', body });
      } else {
        await apiRequest('/api/parts', { method: 'POST', body });
      }
      setShowForm(false);
      await fetchParts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save part');
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePart = async (partId: string) => {
    if (!window.confirm('Delete this part?')) return;
    setError('');
    try {
      await apiRequest(`/api/parts/${partId}`, { method: 'DELETE' });
      await fetchParts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete part');
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0 || !window.confirm(`Delete ${selectedIds.size} selected part(s)?`)) return;
    setError('');
    try {
      for (const id of selectedIds) {
        await apiRequest(`/api/parts/${id}`, { method: 'DELETE' });
      }
      setSelectedIds(new Set());
      await fetchParts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete selected parts');
    }
  };

  const handleSort = (column: PartColumn) => {
    if (sortColumn === column) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortColumn(column);
    setSortDirection('asc');
  };

  const toggleColumn = (key: PartColumn) => {
    setColumns((prev) => prev.map((column) => (column.key === key ? { ...column, visible: !column.visible } : column)));
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      if (displayParts.length > 0 && prev.size === displayParts.length) return new Set();
      return new Set(displayParts.map((part) => part.id));
    });
  };

  const exportToCSV = () => {
    const rows = selectedIds.size > 0 ? displayParts.filter((part) => selectedIds.has(part.id)) : displayParts;
    if (rows.length === 0) return;

    const header = visibleColumns.map((column) => column.label);
    const csvRows = rows.map((part) => visibleColumns.map((column) => getCellExportValue(part, column)));
    const csv = [header, ...csvRows]
      .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `cirtell-parts-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setImporting(true);
    setImportSummary(null);
    setImportIssues([]);
    setError('');

    try {
      const lowerName = file.name.toLowerCase();
      let rows: unknown[][];

      if (lowerName.endsWith('.csv')) {
        rows = parseCsvRows(await file.text());
      } else if (lowerName.endsWith('.xlsx')) {
        const { readSheet } = await import('read-excel-file/browser');
        rows = await readSheet(file, 1) as unknown as unknown[][];
      } else {
        throw new Error('Use a .xlsx or .csv file for import');
      }

      const parsed = parseImportRows(rows);
      if (parsed.parts.length === 0) {
        setImportIssues(parsed.issues);
        throw new Error(parsed.issues[0]?.error || 'No importable rows found');
      }

      const response = await apiRequest<{ success: boolean; summary: ImportSummary; errors?: ImportIssue[] }>('/api/parts/import', {
        method: 'POST',
        body: { parts: parsed.parts },
      });

      setImportSummary(response.summary);
      setImportIssues([...parsed.issues, ...(response.errors || [])]);
      await fetchParts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import parts');
    } finally {
      setImporting(false);
    }
  };

  const renderCell = (part: Part, column: ColumnConfig) => {
    const value = part[column.key];

    switch (column.key) {
      case 'part_number':
        return (
          <div className="flex items-center">
            <Package className="h-4 w-4 text-gray-400 mr-2" />
            <span className="text-caption font-medium text-gray-900 font-mono">{part.part_number}</span>
          </div>
        );
      case 'vendor':
        return <VendorPill vendor={part.vendor} />;
      case 'technology_type':
        return value ? (
          <span className="px-2 py-0.5 inline-flex text-micro leading-5 font-medium rounded-pill bg-verified-green/15 text-verified-green border border-verified-green/30">
            {value}
          </span>
        ) : <span className="text-gray-400 text-caption">-</span>;
      case 'category':
        return value ? (
          <span className="px-2.5 py-1 inline-flex text-micro leading-5 font-medium rounded-pill bg-gray-100 text-gray-700 border border-black/[0.06]">
            {value}
          </span>
        ) : <span className="text-gray-400 text-caption">-</span>;
      case 'subcategory':
        return value ? (
          <span className="px-2.5 py-1 inline-flex text-micro leading-5 font-medium rounded-pill bg-gray-50 text-gray-600 border border-black/[0.04]">
            {value}
          </span>
        ) : <span className="text-gray-400 text-caption">-</span>;
      case 'needs_review':
        return <ReviewBadge part={part} />;
      case 'weight_kg':
        return value != null ? <span className="text-caption text-gray-900">{Number(value).toFixed(2)} kg</span> : <span className="text-gray-400 text-caption">-</span>;
      case 'emission_factor_kg':
        return value != null ? <span className="text-caption text-verified-green font-medium">{Number(value).toFixed(2)} kg</span> : <span className="text-gray-400 text-caption">-</span>;
      case 'created_at':
      case 'updated_at':
        return <span className="text-micro text-gray-600">{formatDate(value as string | null | undefined)}</span>;
      case 'review_notes':
      case 'description':
        return value ? <span className="text-micro text-gray-500 max-w-xs truncate block">{value}</span> : <span className="text-gray-400 text-caption">-</span>;
      default:
        return <span className="text-caption text-gray-900">{formatEmpty(value as string | number | null | undefined)}</span>;
    }
  };

  return (
    <div className="space-y-6 pb-8">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="font-display text-tile font-semibold text-gray-900">Parts Catalogue</h1>
          <p className="text-body text-gray-500 mt-1">Manage your equipment parts, specifications, and environmental data</p>
        </div>
        <div className="flex gap-3 flex-wrap">
          <input
            ref={importInputRef}
            type="file"
            accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            onChange={(event) => void handleImportFile(event)}
            className="hidden"
          />
          <button
            type="button"
            onClick={fetchParts}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-apple-md text-caption font-medium transition-all hover:shadow-apple-sm bg-signal-teal/10 text-signal-teal disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          {canEdit && (
            <button
              type="button"
              onClick={() => importInputRef.current?.click()}
              disabled={importing}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-apple-md text-caption font-medium transition-all hover:shadow-apple-sm bg-signal-teal/10 text-signal-teal disabled:opacity-50"
            >
              {importing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {importing ? 'Importing...' : 'Import Excel'}
            </button>
          )}
          <button
            type="button"
            onClick={exportToCSV}
            disabled={displayParts.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-apple-md text-caption font-medium text-white transition-all hover:shadow-apple-sm hover:opacity-90 disabled:opacity-50 bg-signal-teal"
          >
            <Download className="w-4 h-4" />
            Export CSV ({selectedIds.size || displayParts.length})
          </button>
          {canEdit && (
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-apple-md text-caption font-medium text-white transition-all hover:shadow-apple-sm hover:opacity-90 bg-verified-green"
            >
              <Plus className="w-4 h-4" />
              Add Part
            </button>
          )}
        </div>
      </div>

      {(importSummary || importIssues.length > 0) && (
        <div className="rounded-apple-lg border border-signal-teal/20 bg-signal-teal/5 p-4">
          {importSummary && (
            <p className="text-caption font-medium text-deep-teal">
              Import complete: {importSummary.created} created, {importSummary.updated} updated, {importSummary.skipped} skipped.
            </p>
          )}
          {importIssues.length > 0 && (
            <div className="mt-2 space-y-1 text-micro text-gray-600">
              {importIssues.slice(0, 5).map((issue, index) => (
                <p key={`${issue.row}-${index}`}>
                  Row {issue.row}{issue.part_number ? ` (${issue.part_number})` : ''}: {issue.error}
                </p>
              ))}
              {importIssues.length > 5 && <p>{importIssues.length - 5} more issue(s) not shown.</p>}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 stagger-tiles">
        <KpiCard icon={Package} label="Total Parts" value={total.toLocaleString()} detail={`${displayParts.length} shown`} />
        <KpiCard
          icon={AlertCircle}
          label="Needs Review"
          value={stats.needsReview.toLocaleString()}
          detail={filters.showNeedsReview ? 'Click to show all' : 'Click to filter'}
          active={filters.showNeedsReview}
          onClick={() => updateFilter('showNeedsReview', !filters.showNeedsReview)}
        />
        <KpiCard icon={Building2} label="Unique Vendors" value={stats.vendors.toLocaleString()} detail={`${stats.categories} categories`} />
        <KpiCard icon={Leaf} label="Avg CO2e Factor" value={stats.avgEmissionFactor.toFixed(2)} detail="kg CO2e per unit" />
      </div>

      <div className="bg-white rounded-apple-lg shadow-none border border-gray-100 p-5">
        <div className="flex flex-col xl:flex-row xl:items-center gap-4 mb-4">
          <div className="grid flex-1 grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            <label className="relative">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search parts..."
                value={search}
                onChange={handleSearch}
                className="w-full pl-10 pr-3 py-2.5 rounded-pill border border-gray-200 bg-white text-caption text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-signal-teal/30 focus:border-signal-teal"
              />
            </label>
            <select
              value={filters.vendor}
              onChange={(event) => updateFilter('vendor', event.target.value)}
              className="w-full px-4 py-2.5 rounded-pill border border-gray-200 bg-white text-caption text-gray-700 focus:ring-2 focus:ring-signal-teal/30 focus:border-signal-teal"
            >
              <option value="">All vendors</option>
              {resolvedVendorOptions.map((vendor) => <option key={vendor} value={vendor}>{vendor}</option>)}
            </select>
            <select
              value={filters.category}
              onChange={(event) => updateFilter('category', event.target.value)}
              className="w-full px-4 py-2.5 rounded-pill border border-gray-200 bg-white text-caption text-gray-700 focus:ring-2 focus:ring-signal-teal/30 focus:border-signal-teal"
            >
              <option value="">All categories</option>
              {categoryOptions.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
            <select
              value={filters.technology}
              onChange={(event) => updateFilter('technology', event.target.value)}
              className="w-full px-4 py-2.5 rounded-pill border border-gray-200 bg-white text-caption text-gray-700 focus:ring-2 focus:ring-signal-teal/30 focus:border-signal-teal"
            >
              <option value="">All technologies</option>
              {technologyOptions.map((technology) => <option key={technology} value={technology}>{technology}</option>)}
            </select>
          </div>

          <div className="flex gap-2 items-center">
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowColumnMenu((value) => !value)}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-apple-md text-caption font-medium transition-all border border-gray-200 hover:border-gray-300 hover:bg-gray-50 text-gray-700"
              >
                <Settings className="h-4 w-4 text-gray-500" />
                Columns
              </button>
              {showColumnMenu && (
                <>
                  <button type="button" aria-label="Close column menu" className="fixed inset-0 z-10 cursor-default" onClick={() => setShowColumnMenu(false)} />
                  <div className="absolute right-0 mt-2 w-64 bg-white rounded-apple-lg shadow-apple border border-gray-200 z-20">
                    <div className="p-4">
                      <div className="text-caption font-semibold text-gray-700 mb-3 flex items-center gap-2">
                        <Eye className="h-4 w-4" />
                        Show/Hide Columns
                      </div>
                      <div className="space-y-1 max-h-80 overflow-y-auto">
                        {columns.map((column) => (
                          <label key={column.key} className="flex items-center gap-2 text-caption cursor-pointer hover:bg-gray-50 p-2 rounded-apple">
                            <input
                              type="checkbox"
                              checked={column.visible}
                              onChange={() => toggleColumn(column.key)}
                              className="w-4 h-4 rounded border-gray-300 accent-signal-teal"
                            />
                            <span className="text-gray-700">{column.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 text-caption text-gray-500 border-t border-gray-100 pt-4">
          <p>
            Showing <span className="font-semibold text-gray-900">{displayParts.length}</span> of <span className="font-semibold text-gray-900">{total}</span> parts
            {selectedIds.size > 0 && (
              <span className="ml-2 px-2 py-0.5 rounded-apple-sm text-micro font-medium bg-signal-teal/15 text-signal-teal">
                {selectedIds.size} selected
              </span>
            )}
          </p>
          <label className="flex items-center gap-2">
            <span className="text-gray-400">Per page:</span>
            <select
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setOffset(0);
              }}
              className="px-3 py-2 rounded-pill border border-gray-200 bg-white text-caption text-gray-700 focus:ring-2 focus:ring-signal-teal/30 focus:border-signal-teal"
            >
              {PAGE_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
        </div>
      </div>

      {selectedIds.size > 0 && canEdit && (
        <div className="rounded-apple-lg p-4 flex items-center justify-between border bg-signal-teal/5 border-signal-teal/20">
          <span className="text-caption font-medium text-signal-teal">{selectedIds.size} part(s) selected</span>
          <div className="flex gap-2">
            <button type="button" onClick={() => setSelectedIds(new Set())} className="px-3 py-1.5 text-caption text-gray-600 hover:text-gray-900">
              Deselect All
            </button>
            <button
              type="button"
              onClick={handleBulkDelete}
              className="flex items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-caption rounded-apple-md transition-all hover:shadow-apple-sm"
            >
              <Trash2 className="h-4 w-4" />
              Delete Selected
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-apple-lg p-4">
          <p className="text-body text-red-800">{error}</p>
        </div>
      )}

      <div className="bg-[#F9FAFB] rounded-apple-lg shadow-none border border-black/[0.06] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-black/[0.06]">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-4 text-left w-12">
                  <input
                    type="checkbox"
                    checked={displayParts.length > 0 && selectedIds.size === displayParts.length}
                    onChange={toggleSelectAll}
                    className="rounded border-gray-300 accent-signal-teal"
                  />
                </th>
                {visibleColumns.map((column) => (
                  <th
                    key={column.key}
                    className={`px-6 py-4 ${column.align === 'right' ? 'text-right' : 'text-left'} text-micro font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-black/[0.04] transition-colors select-none`}
                    onClick={() => handleSort(column.key)}
                  >
                    <div className={`flex items-center gap-1.5 ${column.align === 'right' ? 'justify-end' : ''}`}>
                      {column.label}
                      {sortColumn === column.key ? (
                        sortDirection === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-signal-teal" /> : <ArrowDown className="h-3.5 w-3.5 text-signal-teal" />
                      ) : (
                        <ArrowUpDown className="h-3.5 w-3.5 text-gray-300" />
                      )}
                    </div>
                  </th>
                ))}
                <th className="px-6 py-4 text-right text-micro font-semibold text-gray-500 uppercase tracking-wider w-24">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-[#F9FAFB] divide-y divide-black/[0.06] stagger-rows">
              {loading ? (
                Array.from({ length: 6 }).map((_, row) => (
                  <tr key={row}>
                    {Array.from({ length: visibleColumns.length + 2 }).map((__, cell) => (
                      <td key={cell} className="px-6 py-4"><div className="skeleton h-4 w-28 rounded" /></td>
                    ))}
                  </tr>
                ))
              ) : displayParts.length === 0 ? (
                <tr>
                  <td colSpan={visibleColumns.length + 2} className="text-center py-16">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-apple-xl flex items-center justify-center bg-signal-teal/10">
                      <Package className="w-8 h-8 text-signal-teal" />
                    </div>
                    <h3 className="text-sub-heading font-semibold text-gray-900 mb-2">No parts found</h3>
                    <p className="text-body text-gray-500">No parts match your current filters</p>
                  </td>
                </tr>
              ) : (
                displayParts.map((part) => {
                  const needsReview = partNeedsReview(part);
                  return (
                    <tr
                      key={part.id}
                      onClick={() => openEdit(part)}
                      className={`hover:bg-black/[0.04] transition-all cursor-pointer ${
                        selectedIds.has(part.id)
                          ? 'bg-signal-teal/5'
                          : needsReview
                            ? 'bg-signal-teal/5 border-l-4 border-l-signal-teal'
                            : ''
                      }`}
                    >
                      <td className="px-6 py-4 whitespace-nowrap w-12" onClick={(event) => event.stopPropagation()}>
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(part.id)}
                            onChange={() => toggleSelect(part.id)}
                            className="rounded border-gray-300 accent-signal-teal"
                          />
                          {needsReview && (
                            <div className="relative group">
                              <div className="flex items-center justify-center w-5 h-5 rounded-apple-sm bg-amber-100 cursor-help">
                                <AlertCircle className="h-3.5 w-3.5 text-amber-600" />
                              </div>
                            </div>
                          )}
                        </div>
                      </td>
                      {visibleColumns.map((column) => (
                        <td key={column.key} className={`px-6 py-4 whitespace-nowrap ${column.align === 'right' ? 'text-right' : ''}`}>
                          {renderCell(part, column)}
                        </td>
                      ))}
                      <td className="px-6 py-4 whitespace-nowrap text-right w-24" onClick={(event) => event.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => openEdit(part)}
                            className="p-1.5 text-gray-500 hover:bg-black/[0.04] rounded transition-colors"
                            title="View details"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => openEdit(part)}
                              className={`p-1.5 rounded transition-colors ${
                                needsReview
                                  ? 'text-signal-teal hover:bg-signal-teal/15 ring-2 ring-signal-teal/30'
                                  : 'text-gray-500 hover:bg-black/[0.04]'
                              }`}
                              title={needsReview ? 'Edit part (needs review)' : 'Edit part'}
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                          )}
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => handleDeletePart(part.id)}
                              className="p-1.5 text-red-500 hover:bg-red-50 rounded transition-colors"
                              title="Delete part"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {total > 0 && (
          <div className="bg-gray-50 px-6 py-4 border-t border-black/[0.06]">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="text-caption text-gray-500">
                Showing <span className="font-semibold text-gray-700">{offset + 1}</span> - <span className="font-semibold text-gray-700">{Math.min(offset + pageSize, total)}</span> of <span className="font-semibold text-gray-700">{total}</span> parts
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setOffset(0)}
                  disabled={offset === 0}
                  className="px-3 py-2 text-caption border border-black/[0.06] rounded-apple-md hover:bg-black/[0.04] disabled:opacity-40 disabled:cursor-not-allowed transition-all text-gray-700"
                >
                  First
                </button>
                <button
                  type="button"
                  onClick={() => setOffset(Math.max(0, offset - pageSize))}
                  disabled={offset === 0}
                  className="inline-flex items-center gap-1 px-4 py-2 text-caption border border-black/[0.06] rounded-apple-md hover:bg-black/[0.04] disabled:opacity-40 disabled:cursor-not-allowed transition-all text-gray-700"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </button>
                <span className="px-4 py-2 text-caption font-medium rounded-apple-md bg-signal-teal/10 text-signal-teal">
                  {currentPage} / {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setOffset(Math.min((totalPages - 1) * pageSize, offset + pageSize))}
                  disabled={currentPage >= totalPages}
                  className="inline-flex items-center gap-1 px-4 py-2 text-caption border border-black/[0.06] rounded-apple-md hover:bg-black/[0.04] disabled:opacity-40 disabled:cursor-not-allowed transition-all text-gray-700"
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setOffset((totalPages - 1) * pageSize)}
                  disabled={currentPage >= totalPages}
                  className="px-3 py-2 text-caption border border-black/[0.06] rounded-apple-md hover:bg-black/[0.04] disabled:opacity-40 disabled:cursor-not-allowed transition-all text-gray-700"
                >
                  Last
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal-panel max-w-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-900">{editId ? (canEdit ? 'Edit Part' : 'Part Details') : 'New Part'}</h2>
              <button type="button" onClick={() => setShowForm(false)} className="btn-ghost p-1.5">
                <X size={18} />
              </button>
            </div>
            <div className="px-6 py-5 space-y-4 overflow-y-auto flex-1">
              {error && (
                <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-100 text-red-700 rounded-apple-lg text-sm">
                  <AlertCircle size={16} className="shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                    <label className="block text-micro font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                      {label}{required && <span className="text-signal-teal ml-0.5">*</span>}
                    </label>
                    <input
                      type="text"
                      disabled={!canEdit}
                      value={form[key as keyof PartForm] as string}
                      onChange={(event) => updateFormField(key as keyof PartForm, event.target.value)}
                      className="input-base"
                    />
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-micro font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Weight (kg)</label>
                  <input type="number" step="0.01" disabled={!canEdit} value={form.weight_kg} onChange={(event) => updateFormField('weight_kg', event.target.value)} className="input-base" />
                </div>
                <div>
                  <label className="block text-micro font-semibold text-gray-500 uppercase tracking-wider mb-1.5">CO2e Factor</label>
                  <input type="number" step="0.001" disabled={!canEdit} value={form.emission_factor_kg} onChange={(event) => updateFormField('emission_factor_kg', event.target.value)} className="input-base" />
                </div>
                <div>
                  <label className="block text-micro font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Start Year</label>
                  <input type="number" disabled={!canEdit} value={form.manufacture_start_year} onChange={(event) => updateFormField('manufacture_start_year', event.target.value)} className="input-base" />
                </div>
                <div>
                  <label className="block text-micro font-semibold text-gray-500 uppercase tracking-wider mb-1.5">End Year</label>
                  <input type="number" disabled={!canEdit} value={form.manufacture_end_year} onChange={(event) => updateFormField('manufacture_end_year', event.target.value)} className="input-base" />
                </div>
              </div>

              <div>
                <label className="block text-micro font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Description</label>
                <textarea rows={3} disabled={!canEdit} value={form.description} onChange={(event) => updateFormField('description', event.target.value)} className="input-base" />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-[auto,1fr] gap-4 items-start rounded-apple-lg border border-signal-teal/20 bg-signal-teal/5 p-4">
                <label className="inline-flex items-center gap-2 text-caption font-medium text-signal-teal">
                  <input
                    type="checkbox"
                    disabled={!canEdit}
                    checked={form.needs_review}
                    onChange={(event) => updateFormField('needs_review', event.target.checked)}
                    className="rounded border-gray-300 accent-signal-teal"
                  />
                  Needs review
                </label>
                <input
                  type="text"
                  disabled={!canEdit}
                  value={form.review_notes}
                  onChange={(event) => updateFormField('review_notes', event.target.value)}
                  placeholder="Review notes"
                  className="input-base"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2.5 px-6 py-4 border-t border-gray-100 bg-gray-50/50">
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">
                {canEdit ? 'Cancel' : 'Close'}
              </button>
              {canEdit && (
                <button type="button" onClick={handleSave} disabled={saving} className="btn-primary">
                  {saving ? 'Saving...' : editId ? 'Update' : 'Create'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
