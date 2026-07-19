import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  BarChart3,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  DollarSign,
  Eye,
  FileText,
  FolderKanban,
  GitBranch,
  Leaf,
  Loader2,
  MapPin,
  MessageSquare,
  Package,
  PackageCheck,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Shield,
  Trash2,
  Truck,
  Upload,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { API_URL, apiRequest } from '../lib/api';
import { useAuthStore } from '../stores/authStore';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

type ProjectStatus = 'draft' | 'assessment' | 'in-progress' | 'on-hold' | 'completed' | 'cancelled';
type WorkflowStatus = 'not_started' | 'in_progress' | 'completed' | 'blocked';
type TabKey = 'overview' | 'workflow' | 'equipment' | 'logistics' | 'financials' | 'evidence' | 'comments' | 'reports' | 'members';

interface Project {
  id: string;
  tenant_id?: string | null;
  company_id?: string | null;
  tenant_name?: string | null;
  company_name?: string | null;
  name: string;
  description?: string | null;
  internal_reference?: string | null;
  operator?: string | null;
  region?: string | null;
  country?: string | null;
  site_name?: string | null;
  site_id?: string | null;
  location_type?: string | null;
  source_warehouse_id?: string | null;
  location_address?: string | null;
  requires_dismantling?: number | boolean | null;
  timeframe_start?: string | null;
  timeframe_end?: string | null;
  currency?: string | null;
  esg_methodology_version?: string | null;
  compliance_regime?: string | null;
  contains_sensitive_data?: number | boolean | null;
  contains_restricted_goods?: number | boolean | null;
  compliance_notes?: string | null;
  status: ProjectStatus;
  budget_total?: number | null;
  created_by?: string | null;
  created_by_name?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  equipment_count?: number | null;
  co2_avoided_kg?: number | null;
  reuse_value?: number | null;
  vendor_names?: string | null;
  technology_names?: string | null;
}

interface VendorLookup {
  id: string;
  name: string;
  category?: string | null;
  region?: string | null;
}

interface TechnologyLookup {
  id: string;
  name: string;
  generation?: string | null;
  description?: string | null;
}

interface WorkflowStage {
  id: string;
  project_id: string;
  stage: string;
  label: string;
  status: WorkflowStatus;
  sort_order: number;
  completed_at?: string | null;
}

interface WorkflowTask {
  id: string;
  stage_id: string;
  title: string;
  status: 'open' | 'done';
  due_date?: string | null;
}

interface ProjectEquipment {
  id: string;
  part_id?: string | null;
  part_number?: string | null;
  manufacturer_part_number?: string | null;
  catalog_model_name?: string | null;
  catalog_technology_type?: string | null;
  catalog_weight_kg?: number | null;
  catalog_emission_factor_kg?: number | null;
  catalog_description?: string | null;
  item_name: string;
  asset_tag?: string | null;
  serial_number?: string | null;
  vendor?: string | null;
  category?: string | null;
  quantity: number;
  condition: string;
  current_stage: string;
  weight_kg?: number | null;
  estimated_reuse_value?: number | null;
  co2_avoided_kg?: number | null;
  notes?: string | null;
  source?: 'manual' | 'transaction' | 'matched';
  read_only?: boolean;
  transaction_ids?: string[];
  inventory_sync_statuses?: string[];
}

interface PartOption {
  id: string;
  part_number: string;
  manufacturer_part_number?: string | null;
  model_name?: string | null;
  vendor?: string | null;
  technology_type?: string | null;
  weight_kg?: number | null;
  emission_factor_kg?: number | null;
  category?: string | null;
  subcategory?: string | null;
  description?: string | null;
}

interface ProjectFinancial {
  id: string;
  type: 'cost' | 'revenue' | 'credit';
  category: string;
  description?: string | null;
  amount: number;
  currency: string;
  stage?: string | null;
  incurred_at?: string | null;
  created_at?: string | null;
  source?: 'manual' | 'transaction' | 'matched';
  read_only?: boolean;
  transaction_id?: string;
  movement_type?: string;
}

interface ProjectedEquipment {
  id: string;
  projectId: string;
  partId: string;
  partNumber?: string | null;
  itemName: string;
  vendor?: string | null;
  category?: string | null;
  serialNumber?: string | null;
  condition: string;
  quantity: number;
  currentStage: string;
  weightKg?: number | null;
  estimatedReuseValue: number;
  transactionValue: number;
  co2AvoidedKg?: number | null;
  source: 'transaction';
  readOnly: true;
  transactionIds: string[];
  inventorySyncStatuses: string[];
}

interface ProjectedFinancial {
  id: string;
  transactionId: string;
  movementType: string;
  type: 'cost' | 'revenue' | 'credit';
  category: string;
  description: string;
  amount: number;
  currency: string;
  stage: string;
  incurredAt: string;
  source: 'transaction';
  readOnly: true;
}

interface ProjectTransactionProjection {
  projectedEquipment: ProjectedEquipment[];
  projectedFinancials: ProjectedFinancial[];
  transactionSummary: {
    transactionCount: number;
    lineCount: number;
    totalTransactionValue: number;
    purchaseCost: number;
    salesRevenue: number;
    redeploymentCredit: number;
    recyclingRevenue: number;
    projectedCo2AvoidedKg: number;
  };
  matchedEquipmentProjectionIds?: string[];
  matchedFinancialTransactionIds?: string[];
  reconciliationWarnings: Array<{
    code: string;
    message: string;
    transactionId: string;
    transactionItemId?: string | null;
    partId?: string | null;
  }>;
}

interface ProjectLogistics {
  id: string;
  shipment_type: string;
  status: string;
  carrier?: string | null;
  origin?: string | null;
  destination?: string | null;
  scheduled_date?: string | null;
  tracking_reference?: string | null;
  estimated_cost?: number | null;
  notes?: string | null;
}

interface ProjectEvidence {
  id: string;
  title: string;
  evidence_type: string;
  stage?: string | null;
  file_url?: string | null;
  file_name?: string | null;
  file_size?: number | null;
  content_type?: string | null;
  r2_key?: string | null;
  notes?: string | null;
  uploaded_by_name?: string | null;
  uploaded_at?: string | null;
}

interface ProjectComment {
  id: string;
  body: string;
  user_name?: string | null;
  user_email?: string | null;
  created_at: string;
}

interface ProjectActivity {
  id: string;
  action: string;
  entity_type?: string | null;
  details?: string | null;
  user_name?: string | null;
  created_at: string;
}

interface ProjectMember {
  id: string;
  name: string;
  email: string;
  role: string;
  tenant_name?: string | null;
  is_owner?: number | boolean | null;
}

interface ProjectKpis {
  equipment_count: number;
  co2_avoided_kg: number;
  reuse_value: number;
  revenue_credits?: number;
  costs?: number;
  net_financial: number;
}

interface ProjectBundle {
  project: Project;
  vendors: VendorLookup[];
  technologies: TechnologyLookup[];
  stages: WorkflowStage[];
  tasks: WorkflowTask[];
  equipment: ProjectEquipment[];
  financials: ProjectFinancial[];
  logistics: ProjectLogistics[];
  evidence: ProjectEvidence[];
  comments: ProjectComment[];
  recentActivity: ProjectActivity[];
  transactionProjection?: ProjectTransactionProjection;
  kpis: ProjectKpis;
}

interface CreateProjectData {
  name: string;
  description: string;
  internal_reference: string;
  operator: string;
  region: string;
  country: string;
  site_name: string;
  site_id: string;
  location_type: string;
  location_address: string;
  requires_dismantling: boolean;
  timeframe_start: string;
  timeframe_end: string;
  currency: string;
  esg_methodology_version: string;
  compliance_regime: string;
  contains_sensitive_data: boolean;
  contains_restricted_goods: boolean;
  compliance_notes: string;
  budget_total: string;
  vendor_ids: string[];
  technology_ids: string[];
}

interface EquipmentForm {
  part_id: string;
  item_name: string;
  asset_tag: string;
  serial_number: string;
  vendor: string;
  category: string;
  quantity: string;
  condition: string;
  current_stage: string;
  weight_kg: string;
  estimated_reuse_value: string;
  co2_avoided_kg: string;
  notes: string;
}

interface EquipmentImportPayload {
  part_id?: string | null;
  part_number?: string | null;
  item_name?: string | null;
  asset_tag?: string | null;
  serial_number?: string | null;
  vendor?: string | null;
  category?: string | null;
  quantity?: number | null;
  condition?: string | null;
  current_stage?: string | null;
  weight_kg?: number | null;
  estimated_reuse_value?: number | null;
  co2_avoided_kg?: number | null;
  notes?: string | null;
}

interface EquipmentImportIssue {
  row: number;
  part_number?: string;
  error: string;
}

interface EquipmentImportSummary {
  created: number;
  linked: number;
  skipped: number;
  total: number;
}

interface FinancialForm {
  type: 'cost' | 'revenue' | 'credit';
  category: string;
  description: string;
  amount: string;
  stage: string;
  incurred_at: string;
}

interface LogisticsForm {
  shipment_type: string;
  status: string;
  carrier: string;
  origin: string;
  destination: string;
  scheduled_date: string;
  tracking_reference: string;
  estimated_cost: string;
  notes: string;
}

interface EvidenceForm {
  title: string;
  evidence_type: string;
  stage: string;
  notes: string;
}

const STATUS_CONFIG: Record<ProjectStatus, { label: string; color: string; bg: string; border: string }> = {
  draft: { label: 'Draft', color: 'text-gray-600', bg: 'bg-gray-100', border: 'border-gray-200' },
  assessment: { label: 'Assessment', color: 'text-signal-teal', bg: 'bg-signal-teal/10', border: 'border-signal-teal/20' },
  'in-progress': { label: 'In Progress', color: 'text-deep-teal', bg: 'bg-deep-teal/10', border: 'border-deep-teal/20' },
  'on-hold': { label: 'On Hold', color: 'text-brand-700', bg: 'bg-brand-50', border: 'border-brand-100' },
  completed: { label: 'Completed', color: 'text-verified-green', bg: 'bg-verified-green/10', border: 'border-verified-green/20' },
  cancelled: { label: 'Cancelled', color: 'text-gray-500', bg: 'bg-gray-50', border: 'border-gray-200' },
};

const WORKFLOW_STATUS_CONFIG: Record<WorkflowStatus, { label: string; color: string; bg: string }> = {
  not_started: { label: 'Not Started', color: 'text-gray-500', bg: 'bg-gray-100' },
  in_progress: { label: 'In Progress', color: 'text-signal-teal', bg: 'bg-signal-teal/10' },
  completed: { label: 'Completed', color: 'text-verified-green', bg: 'bg-verified-green/10' },
  blocked: { label: 'Blocked', color: 'text-deep-teal', bg: 'bg-deep-teal/10' },
};

const TABS: Array<{ key: TabKey; label: string; icon: LucideIcon }> = [
  { key: 'overview', label: 'Overview', icon: FolderKanban },
  { key: 'workflow', label: 'Workflow', icon: GitBranch },
  { key: 'equipment', label: 'Materials & Assets', icon: Package },
  { key: 'logistics', label: 'Logistics', icon: Truck },
  { key: 'financials', label: 'Financials', icon: DollarSign },
  { key: 'evidence', label: 'Evidence', icon: Shield },
  { key: 'comments', label: 'Discussion', icon: MessageSquare },
  { key: 'reports', label: 'Reports', icon: FileText },
  { key: 'members', label: 'Members', icon: Users },
];

const createProjectDefaults: CreateProjectData = {
  name: '',
  description: '',
  internal_reference: '',
  operator: '',
  region: '',
  country: '',
  site_name: '',
  site_id: '',
  location_type: 'on_site',
  location_address: '',
  requires_dismantling: true,
  timeframe_start: '',
  timeframe_end: '',
  currency: 'USD',
  esg_methodology_version: '',
  compliance_regime: '',
  contains_sensitive_data: false,
  contains_restricted_goods: false,
  compliance_notes: '',
  budget_total: '',
  vendor_ids: [],
  technology_ids: [],
};

const equipmentDefaults: EquipmentForm = {
  part_id: '',
  item_name: '',
  asset_tag: '',
  serial_number: '',
  vendor: '',
  category: '',
  quantity: '1',
  condition: 'Used',
  current_stage: 'assessment',
  weight_kg: '',
  estimated_reuse_value: '',
  co2_avoided_kg: '',
  notes: '',
};

const financialDefaults: FinancialForm = {
  type: 'cost',
  category: '',
  description: '',
  amount: '',
  stage: '',
  incurred_at: '',
};

const logisticsDefaults: LogisticsForm = {
  shipment_type: 'collection',
  status: 'planned',
  carrier: '',
  origin: '',
  destination: '',
  scheduled_date: '',
  tracking_reference: '',
  estimated_cost: '',
  notes: '',
};

const evidenceDefaults: EvidenceForm = {
  title: '',
  evidence_type: 'document',
  stage: '',
  notes: '',
};

const EQUIPMENT_IMPORT_LIMIT = 1000;
const EQUIPMENT_IMPORT_HEADER_MAP: Record<string, keyof EquipmentImportPayload> = {
  partid: 'part_id',
  catalogpartid: 'part_id',
  partnumber: 'part_number',
  partno: 'part_number',
  part: 'part_number',
  sku: 'part_number',
  itemnumber: 'part_number',
  itemname: 'item_name',
  assetname: 'item_name',
  material: 'item_name',
  materialname: 'item_name',
  name: 'item_name',
  assettag: 'asset_tag',
  tag: 'asset_tag',
  serialnumber: 'serial_number',
  serial: 'serial_number',
  vendor: 'vendor',
  supplier: 'vendor',
  manufacturer: 'vendor',
  category: 'category',
  quantity: 'quantity',
  qty: 'quantity',
  condition: 'condition',
  stage: 'current_stage',
  currentstage: 'current_stage',
  workflowstage: 'current_stage',
  weight: 'weight_kg',
  weightkg: 'weight_kg',
  reusevalue: 'estimated_reuse_value',
  estimatedreusevalue: 'estimated_reuse_value',
  value: 'estimated_reuse_value',
  co2avoided: 'co2_avoided_kg',
  co2avoidedkg: 'co2_avoided_kg',
  co2eavoided: 'co2_avoided_kg',
  co2eavoidedkg: 'co2_avoided_kg',
  notes: 'notes',
  note: 'notes',
};

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function formatDate(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatFileSize(value?: number | null) {
  if (!value || value <= 0) return '-';
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function evidenceHref(fileUrl?: string | null) {
  if (!fileUrl) return null;
  if (/^https?:\/\//i.test(fileUrl)) return fileUrl;
  return `${API_URL}${fileUrl.startsWith('/') ? fileUrl : `/${fileUrl}`}`;
}

function formatCurrency(value?: number | null, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function formatNumber(value?: number | null) {
  return Number(value || 0).toLocaleString();
}

function normalizeMaterialToken(value?: string | null) {
  return (value || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
}

function projectedEquipmentRow(item: ProjectedEquipment): ProjectEquipment {
  return {
    id: item.id,
    part_id: item.partId,
    part_number: item.partNumber,
    item_name: item.itemName,
    serial_number: item.serialNumber,
    vendor: item.vendor,
    category: item.category,
    quantity: item.quantity,
    condition: item.condition,
    current_stage: item.currentStage,
    weight_kg: item.weightKg,
    estimated_reuse_value: item.estimatedReuseValue,
    co2_avoided_kg: item.co2AvoidedKg,
    source: 'transaction',
    read_only: true,
    transaction_ids: item.transactionIds,
    inventory_sync_statuses: item.inventorySyncStatuses,
  };
}

function isTransactionMirror(manual: ProjectEquipment, projected: ProjectEquipment) {
  if (!manual.part_id || manual.part_id !== projected.part_id) return false;
  if (Number(manual.quantity) !== Number(projected.quantity)) return false;
  if (normalizeMaterialToken(manual.condition) !== normalizeMaterialToken(projected.condition)) return false;
  if (normalizeMaterialToken(manual.current_stage) !== normalizeMaterialToken(projected.current_stage)) return false;

  const manualSerial = normalizeMaterialToken(manual.serial_number);
  const projectedSerial = normalizeMaterialToken(projected.serial_number);
  return !manualSerial || !projectedSerial || manualSerial === projectedSerial;
}

function projectMaterialRows(bundle: ProjectBundle): ProjectEquipment[] {
  const matchedIds = new Set(bundle.transactionProjection?.matchedEquipmentProjectionIds || []);
  const projected = (bundle.transactionProjection?.projectedEquipment || []).map((item) => {
    const row = projectedEquipmentRow(item);
    return { ...row, source: matchedIds.has(item.id) ? 'matched' as const : 'transaction' as const };
  });
  const matchedProjected = projected.filter((item) => item.source === 'matched');
  const manual = bundle.equipment
    .filter((item) => !matchedProjected.some((candidate) => isTransactionMirror(item, candidate)))
    .map((item) => ({ ...item, source: 'manual' as const, read_only: false }));
  return [...projected, ...manual];
}

function projectMaterialKpis(bundle: ProjectBundle) {
  return {
    equipmentCount: Number(bundle.kpis.equipment_count || 0),
    co2AvoidedKg: Number(bundle.kpis.co2_avoided_kg || 0),
    reuseValue: Number(bundle.kpis.reuse_value || 0),
  };
}

function projectedFinancialRow(item: ProjectedFinancial): ProjectFinancial {
  return {
    id: item.id,
    type: item.type,
    category: item.category,
    description: item.description,
    amount: item.amount,
    currency: item.currency,
    stage: item.stage,
    incurred_at: item.incurredAt,
    source: 'transaction',
    read_only: true,
    transaction_id: item.transactionId,
    movement_type: item.movementType,
  };
}

function isTransactionFinancialMirror(manual: ProjectFinancial, projected: ProjectFinancial) {
  return manual.type === projected.type
    && Number(manual.amount) === Number(projected.amount)
    && normalizeMaterialToken(manual.currency) === normalizeMaterialToken(projected.currency)
    && normalizeMaterialToken(manual.category) === normalizeMaterialToken(projected.category)
    && normalizeMaterialToken(manual.stage) === normalizeMaterialToken(projected.stage)
    && (manual.incurred_at || '').slice(0, 10) === (projected.incurred_at || '').slice(0, 10);
}

function projectFinancialRows(bundle: ProjectBundle): ProjectFinancial[] {
  const matchedIds = new Set(bundle.transactionProjection?.matchedFinancialTransactionIds || []);
  const projected = (bundle.transactionProjection?.projectedFinancials || []).map((item) => {
    const row = projectedFinancialRow(item);
    return { ...row, source: matchedIds.has(item.transactionId) ? 'matched' as const : 'transaction' as const };
  });
  const matchedProjected = projected.filter((item) => item.source === 'matched');
  const manual = bundle.financials
    .filter((item) => !matchedProjected.some((candidate) => isTransactionFinancialMirror(item, candidate)))
    .map((item) => ({ ...item, source: 'manual' as const, read_only: false }));
  return [...projected, ...manual];
}

function projectFinancialTotals(bundle: ProjectBundle) {
  return {
    rows: projectFinancialRows(bundle),
    revenue: Number(bundle.kpis.revenue_credits || 0),
    cost: Number(bundle.kpis.costs || 0),
    net: Number(bundle.kpis.net_financial || 0),
  };
}

function projectionSourceLabel(source?: ProjectEquipment['source']) {
  if (source === 'matched') return 'Matched';
  if (source === 'transaction') return 'Transaction';
  return 'Manual';
}

function projectionSourceClass(source?: ProjectEquipment['source']) {
  if (source === 'matched') return 'border-deep-teal/20 bg-deep-teal/10 text-deep-teal';
  if (source === 'transaction') return 'border-signal-teal/20 bg-signal-teal/10 text-signal-teal';
  return 'border-gray-200 bg-gray-50 text-gray-600';
}
function normalizeSearch(value?: string | null) {
  return (value || '').toLowerCase().trim();
}

function isTruthy(value: unknown) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function statusConfig(status?: string | null) {
  return STATUS_CONFIG[(status as ProjectStatus) || 'draft'] || STATUS_CONFIG.draft;
}

function workflowConfig(status?: string | null) {
  return WORKFLOW_STATUS_CONFIG[(status as WorkflowStatus) || 'not_started'] || WORKFLOW_STATUS_CONFIG.not_started;
}

async function fetchProjects() {
  const response = await apiRequest<{ projects?: Project[]; items?: Project[] }>('/api/projects');
  return response.projects || response.items || [];
}

async function fetchLookups() {
  const [vendors, technologies] = await Promise.all([
    apiRequest<{ vendors: VendorLookup[] }>('/api/projects/lookups/vendors'),
    apiRequest<{ technologies: TechnologyLookup[] }>('/api/projects/lookups/technologies'),
  ]);
  return {
    vendors: vendors.vendors || [],
    technologies: technologies.technologies || [],
  };
}

async function fetchProjectPartOptions(search = '') {
  const response = await apiRequest<{ parts: PartOption[] }>('/api/parts', {
    params: { search, limit: 10 },
  });
  return response.parts || [];
}

function catalogPartLabel(part: PartOption) {
  return part.model_name || part.part_number;
}

function normalizeEquipmentImportHeader(value: unknown) {
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

function importPositiveInteger(value: unknown): number | null {
  const parsed = importNumber(value);
  return parsed === null ? null : Math.max(1, Math.trunc(parsed));
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

function parseEquipmentImportRows(rows: unknown[][]): { equipment: EquipmentImportPayload[]; issues: EquipmentImportIssue[] } {
  const headerIndex = rows.findIndex((row) => row.some((cell) => !isBlankImportCell(cell)));
  if (headerIndex === -1) {
    return { equipment: [], issues: [{ row: 1, error: 'The file is empty' }] };
  }

  const headers = rows[headerIndex].map((header) => EQUIPMENT_IMPORT_HEADER_MAP[normalizeEquipmentImportHeader(header)] || null);
  if (!headers.includes('item_name') && !headers.includes('part_number') && !headers.includes('part_id')) {
    return { equipment: [], issues: [{ row: headerIndex + 1, error: 'Use at least one Item Name, Part Number, or Part ID column' }] };
  }

  const equipment: EquipmentImportPayload[] = [];
  const issues: EquipmentImportIssue[] = [];

  for (const [rowOffset, row] of rows.slice(headerIndex + 1).entries()) {
    const rowNumber = headerIndex + rowOffset + 2;
    if (!row.some((cell) => !isBlankImportCell(cell))) continue;

    const item: EquipmentImportPayload = {};
    headers.forEach((field, columnIndex) => {
      if (!field) return;
      const value = row[columnIndex];
      if (field === 'quantity') {
        if (!isBlankImportCell(value)) item.quantity = importPositiveInteger(value);
        return;
      }
      if (field === 'weight_kg' || field === 'estimated_reuse_value' || field === 'co2_avoided_kg') {
        if (!isBlankImportCell(value)) item[field] = importNumber(value);
        return;
      }
      if (!isBlankImportCell(value)) item[field] = importText(value, field === 'notes' ? 1000 : 500);
    });

    if (!item.item_name && !item.part_number && !item.part_id) {
      issues.push({ row: rowNumber, error: 'Item Name, Part Number, or Part ID is required' });
      continue;
    }
    equipment.push(item);
  }

  if (equipment.length > EQUIPMENT_IMPORT_LIMIT) {
    issues.push({ row: EQUIPMENT_IMPORT_LIMIT + 2, error: `Only the first ${EQUIPMENT_IMPORT_LIMIT} valid rows will be imported` });
    return { equipment: equipment.slice(0, EQUIPMENT_IMPORT_LIMIT), issues };
  }

  return { equipment, issues };
}

async function fetchProjectBundle(projectId: string) {
  return apiRequest<ProjectBundle>(`/api/projects/${projectId}`);
}

function StatCard({ icon: Icon, label, value, detail }: { icon: LucideIcon; label: string; value: string; detail: string }) {
  return (
    <div className="bg-white rounded-apple-md p-4 border border-gray-100">
      <div className="flex items-center justify-between">
        <div className="h-10 w-10 rounded-apple-md bg-signal-teal/10 text-signal-teal flex items-center justify-center">
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <p className="mt-3 text-micro text-gray-500 font-medium">{label}</p>
      <p className="mt-1 text-tile font-semibold text-gray-900">{value}</p>
      <p className="mt-1 text-micro text-gray-400">{detail}</p>
    </div>
  );
}

function Badge({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center rounded-pill border px-2.5 py-1 text-micro font-semibold ${className}`}>
      {children}
    </span>
  );
}

function SpinnerBlock({ label = 'Loading projects...' }: { label?: string }) {
  return (
    <div className="flex min-h-[320px] flex-col items-center justify-center rounded-apple-lg border border-gray-100 bg-white">
      <Loader2 className="h-7 w-7 animate-spin text-signal-teal" />
      <p className="mt-3 text-caption text-gray-500">{label}</p>
    </div>
  );
}

function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-apple-lg border border-signal-teal/20 bg-signal-teal/5 p-4 text-caption text-deep-teal">
      <div className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{message}</span>
      </div>
      {onRetry && (
        <button type="button" onClick={onRetry} className="font-semibold text-signal-teal hover:text-deep-teal">
          Retry
        </button>
      )}
    </div>
  );
}

function Field({ label, required = false, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-micro font-semibold uppercase tracking-wider text-gray-500">
        {label}{required && <span className="text-signal-teal"> *</span>}
      </span>
      {children}
    </label>
  );
}

function inputClass(extra = '') {
  return `input-base ${extra}`;
}

export function ProjectsPage() {
  const { projectId } = useParams<{ projectId?: string }>();
  return projectId ? <ProjectDetailView projectId={projectId} /> : <ProjectsListView />;
}

function ProjectsListView() {
  const navigate = useNavigate();
  const { selectedTenantId, currentCompanyId, user } = useAuthStore();
  const canManage = user?.role === 'Admin' || user?.role === 'User';
  const [projects, setProjects] = useState<Project[]>([]);
  const [vendors, setVendors] = useState<VendorLookup[]>([]);
  const [technologies, setTechnologies] = useState<TechnologyLookup[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showWizard, setShowWizard] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const [projectRows, lookupRows] = await Promise.all([fetchProjects(), fetchLookups()]);
      setProjects(projectRows);
      setVendors(lookupRows.vendors);
      setTechnologies(lookupRows.technologies);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load projects'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, selectedTenantId, currentCompanyId]);

  const filtered = useMemo(() => {
    const search = normalizeSearch(searchTerm);
    return projects
      .filter((project) => !statusFilter || project.status === statusFilter)
      .filter((project) => {
        if (!search) return true;
        const haystack = [
          project.name,
          project.operator,
          project.region,
          project.country,
          project.site_name,
          project.vendor_names,
          project.technology_names,
          project.internal_reference,
        ].filter(Boolean).join(' ').toLowerCase();
        return haystack.includes(search);
      })
      .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  }, [projects, searchTerm, statusFilter]);

  const stats = useMemo(() => ({
    total: projects.length,
    active: projects.filter((project) => ['assessment', 'in-progress'].includes(project.status)).length,
    completed: projects.filter((project) => project.status === 'completed').length,
    draft: projects.filter((project) => project.status === 'draft').length,
  }), [projects]);

  const handleDelete = async (project: Project) => {
    if (!window.confirm(`Delete project "${project.name}"? This cannot be undone.`)) return;
    try {
      await apiRequest(`/api/projects/${project.id}`, { method: 'DELETE' });
      setProjects((current) => current.filter((item) => item.id !== project.id));
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to delete project'));
    }
  };

  if (loading) return <SpinnerBlock />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-tile font-semibold text-gray-900 flex items-center gap-2">
            <FolderKanban className="h-7 w-7 text-signal-teal" />
            Projects
          </h1>
          <p className="mt-1 text-caption text-gray-500">Telecom decommissioning, circularity, and ESG projects</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load(true)}
            className="rounded-apple p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
            title="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
          {canManage && (
            <button
              type="button"
              onClick={() => setShowWizard(true)}
              className="btn-primary"
            >
              <Plus className="h-4 w-4" />
              New Project
            </button>
          )}
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={() => void load(true)} />}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard icon={FolderKanban} label="Total Projects" value={String(stats.total)} detail="All project records" />
        <StatCard icon={Clock} label="Active" value={String(stats.active)} detail="Assessment or in progress" />
        <StatCard icon={Check} label="Completed" value={String(stats.completed)} detail="Closed execution work" />
        <StatCard icon={FileText} label="Draft" value={String(stats.draft)} detail="Awaiting setup" />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search projects..."
            className="input-base pl-9"
          />
        </div>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="input-base sm:w-52">
          <option value="">All Statuses</option>
          {Object.entries(STATUS_CONFIG).map(([key, value]) => (
            <option key={key} value={key}>{value.label}</option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-apple-md border border-gray-100 bg-white py-16 text-center">
          <FolderKanban className="mx-auto mb-3 h-12 w-12 text-gray-300" />
          <h3 className="text-lg font-semibold text-gray-900">No projects yet</h3>
          <p className="mx-auto mt-1 max-w-md text-caption text-gray-400">
            {canManage ? 'Create your first circular economy project with the Cirtell project workflow.' : 'No assigned projects are available for your current scope.'}
          </p>
          {canManage && (
            <button type="button" onClick={() => setShowWizard(true)} className="btn-primary mt-4">
              <Plus className="h-4 w-4" />
              Create Your First Project
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((project) => {
            const st = statusConfig(project.status);
            return (
              <button
                key={project.id}
                type="button"
                onClick={() => navigate(`/projects/${project.id}`)}
                className="group rounded-apple-md border border-gray-100 bg-white p-5 text-left transition-all hover:border-signal-teal/30 hover:shadow-apple-sm"
              >
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-caption font-semibold text-gray-900 transition-colors group-hover:text-signal-teal">
                      {project.name}
                    </h3>
                    {project.operator && <p className="mt-0.5 truncate text-micro text-gray-500">{project.operator}</p>}
                  </div>
                  <Badge className={`${st.bg} ${st.color} ${st.border}`}>{st.label}</Badge>
                </div>

                {(project.region || project.country || project.site_name) && (
                  <div className="mb-3 flex items-center gap-1 text-micro text-gray-500">
                    <MapPin className="h-3 w-3 shrink-0" />
                    <span className="truncate">{[project.site_name, project.region, project.country].filter(Boolean).join(', ')}</span>
                  </div>
                )}

                <div className="mb-3 flex flex-wrap items-center gap-2 text-micro text-gray-500">
                  <span className="inline-flex items-center gap-1">
                    <Package className="h-3 w-3" />
                    {project.equipment_count || 0} items
                  </span>
                  {project.technology_names?.split(', ').slice(0, 2).map((technology) => (
                    <span key={technology} className="rounded bg-deep-teal/10 px-1.5 py-0.5 text-[10px] font-medium text-deep-teal">
                      {technology}
                    </span>
                  ))}
                </div>

                <div className="mb-3 rounded-apple bg-signal-teal/5 p-3 text-micro text-deep-teal">
                  {project.status === 'draft' ? 'Add equipment to begin assessment' : project.status === 'assessment' ? 'Complete site assessment' : 'Continue project execution'}
                </div>

                <div className="flex items-center justify-between border-t border-gray-50 pt-3">
                  <span className="text-[10px] text-gray-400">Updated {formatDate(project.updated_at)}</span>
                  <div className="flex items-center gap-2">
                    {canManage && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleDelete(project);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            event.stopPropagation();
                            void handleDelete(project);
                          }
                        }}
                        className="rounded p-1 text-gray-300 opacity-0 transition-colors hover:bg-gray-50 hover:text-gray-500 group-hover:opacity-100"
                        title="Delete project"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </span>
                    )}
                    <ChevronRight className="h-4 w-4 text-gray-300 transition-colors group-hover:text-signal-teal" />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {showWizard && (
        <ProjectCreateWizard
          vendors={vendors}
          technologies={technologies}
          onClose={() => setShowWizard(false)}
          onCreated={(id) => {
            setShowWizard(false);
            navigate(`/projects/${id}`);
          }}
        />
      )}
    </div>
  );
}

function ProjectCreateWizard({
  vendors,
  technologies,
  onClose,
  onCreated,
}: {
  vendors: VendorLookup[];
  technologies: TechnologyLookup[];
  onClose: () => void;
  onCreated: (projectId: string) => void;
}) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<CreateProjectData>(createProjectDefaults);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const steps = [
    { key: 'basics', label: 'Project Basics', icon: FolderKanban },
    { key: 'location', label: 'Location & Timing', icon: MapPin },
    { key: 'scope', label: 'Technology Scope', icon: Settings },
    { key: 'compliance', label: 'Compliance', icon: Shield },
    { key: 'review', label: 'Review & Create', icon: Eye },
  ];

  const update = <K extends keyof CreateProjectData>(key: K, value: CreateProjectData[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const toggleArray = (key: 'vendor_ids' | 'technology_ids', id: string) => {
    setForm((current) => {
      const set = new Set(current[key]);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      return { ...current, [key]: Array.from(set) };
    });
  };

  const canGoNext = step > 0 || form.name.trim().length > 0;

  const createProject = async () => {
    if (!form.name.trim()) {
      setError('Project name is required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = {
        ...form,
        budget_total: form.budget_total ? Number(form.budget_total) : 0,
      };
      const response = await apiRequest<{ id: string }>('/api/projects', { method: 'POST', body: payload });
      onCreated(response.id);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to create project'));
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-apple-lg bg-white shadow-apple" onClick={(event) => event.stopPropagation()}>
        <div className="border-b border-gray-100 px-6 pb-4 pt-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-bold text-gray-900">
                <PackageCheck className="h-5 w-5 text-signal-teal" />
                Create New Project
              </h2>
              <p className="mt-0.5 text-micro text-gray-500">Step {step + 1} of {steps.length}</p>
            </div>
            <button type="button" onClick={onClose} className="rounded-apple p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="flex items-center gap-1">
            {steps.map((item, index) => {
              const Icon = item.icon;
              const active = index === step;
              const complete = index < step;
              return (
                <div key={item.key} className="flex flex-1 items-center">
                  <button
                    type="button"
                    onClick={() => index < step && setStep(index)}
                    disabled={index > step}
                    className={`flex w-full items-center gap-1.5 rounded-apple-sm px-2 py-1 text-[10px] font-medium transition-all ${
                      active ? 'bg-signal-teal/10 text-signal-teal' : complete ? 'bg-verified-green/10 text-verified-green' : 'text-gray-400'
                    }`}
                  >
                    {complete ? <Check className="h-3 w-3" /> : <Icon className="h-3 w-3" />}
                    <span className="hidden truncate sm:inline">{item.label}</span>
                  </button>
                  {index < steps.length - 1 && <div className={`mx-0.5 h-0.5 w-2 rounded ${complete ? 'bg-verified-green' : 'bg-gray-200'}`} />}
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {error && <ErrorBanner message={error} />}
          {step === 0 && <StepBasics form={form} update={update} />}
          {step === 1 && <StepLocation form={form} update={update} />}
          {step === 2 && <StepScope form={form} vendors={vendors} technologies={technologies} toggleArray={toggleArray} />}
          {step === 3 && <StepCompliance form={form} update={update} />}
          {step === 4 && <StepReview form={form} vendors={vendors} technologies={technologies} />}
        </div>

        <div className="flex items-center justify-between border-t border-gray-100 px-6 py-4">
          <button
            type="button"
            onClick={() => step > 0 ? setStep((current) => current - 1) : onClose()}
            className="btn-secondary"
            disabled={saving}
          >
            <ChevronLeft className="h-4 w-4" />
            {step === 0 ? 'Cancel' : 'Back'}
          </button>

          {step < steps.length - 1 ? (
            <button type="button" onClick={() => setStep((current) => current + 1)} disabled={!canGoNext} className="btn-primary">
              Next
              <ChevronRight className="h-4 w-4" />
            </button>
          ) : (
            <button type="button" onClick={() => void createProject()} disabled={saving || !form.name.trim()} className="btn-primary">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {saving ? 'Creating...' : 'Create Project'}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function StepBasics({ form, update }: { form: CreateProjectData; update: <K extends keyof CreateProjectData>(key: K, value: CreateProjectData[K]) => void }) {
  return (
    <div className="space-y-5">
      <div className="rounded-apple-md border border-signal-teal/20 bg-signal-teal/10 p-4">
        <p className="text-caption font-medium text-signal-teal">Set up the project foundation.</p>
        <p className="mt-1 text-micro text-signal-teal/80">Project details can be edited after creation.</p>
      </div>
      <Field label="Project Name" required>
        <input value={form.name} onChange={(event) => update('name', event.target.value)} autoFocus className={inputClass()} placeholder="e.g. Lagos 2G Decommission Phase 1" />
      </Field>
      <Field label="Internal Reference">
        <input value={form.internal_reference} onChange={(event) => update('internal_reference', event.target.value)} className={inputClass()} placeholder="e.g. INT-2026-042" />
      </Field>
      <Field label="Description">
        <textarea value={form.description} onChange={(event) => update('description', event.target.value)} rows={3} className={inputClass('resize-none')} />
      </Field>
      <Field label="Operator / Client">
        <input value={form.operator} onChange={(event) => update('operator', event.target.value)} className={inputClass()} placeholder="e.g. MTN Nigeria, Vodafone UK" />
      </Field>
    </div>
  );
}

function StepLocation({ form, update }: { form: CreateProjectData; update: <K extends keyof CreateProjectData>(key: K, value: CreateProjectData[K]) => void }) {
  const locationOptions = [
    { value: 'on_site', label: 'On Site', description: 'Equipment is still at a field site or customer location.' },
    { value: 'local_warehouse', label: 'Local Warehouse', description: 'Equipment is already in a tenant warehouse.' },
    { value: 'regional_warehouse', label: 'Regional Warehouse', description: 'Equipment is staged in a regional consolidation warehouse.' },
  ];
  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-3">
        {locationOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => update('location_type', option.value)}
            className={`rounded-apple-md border p-4 text-left transition-colors ${
              form.location_type === option.value ? 'border-signal-teal bg-signal-teal/10 text-deep-teal' : 'border-gray-100 bg-white hover:border-signal-teal/30'
            }`}
          >
            <p className="text-caption font-semibold">{option.label}</p>
            <p className="mt-1 text-micro text-gray-500">{option.description}</p>
          </button>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Region">
          <input value={form.region} onChange={(event) => update('region', event.target.value)} className={inputClass()} />
        </Field>
        <Field label="Country">
          <input value={form.country} onChange={(event) => update('country', event.target.value)} className={inputClass()} />
        </Field>
        <Field label="Site / Warehouse Name">
          <input value={form.site_name} onChange={(event) => update('site_name', event.target.value)} className={inputClass()} />
        </Field>
        <Field label="Site ID">
          <input value={form.site_id} onChange={(event) => update('site_id', event.target.value)} className={inputClass()} />
        </Field>
        <Field label="Start Date">
          <input type="date" value={form.timeframe_start} onChange={(event) => update('timeframe_start', event.target.value)} className={inputClass()} />
        </Field>
        <Field label="End Date">
          <input type="date" value={form.timeframe_end} onChange={(event) => update('timeframe_end', event.target.value)} className={inputClass()} />
        </Field>
      </div>
      <Field label="Address">
        <textarea value={form.location_address} onChange={(event) => update('location_address', event.target.value)} rows={2} className={inputClass('resize-none')} />
      </Field>
      {form.location_type === 'on_site' && (
        <label className="flex items-start gap-3 rounded-apple-md border border-signal-teal/20 bg-signal-teal/5 p-4">
          <input type="checkbox" checked={form.requires_dismantling} onChange={(event) => update('requires_dismantling', event.target.checked)} className="mt-0.5 h-4 w-4 accent-signal-teal" />
          <span>
            <span className="block text-caption font-semibold text-gray-900">Dismantling required</span>
            <span className="block text-micro text-gray-500">Recycler access and workflow controls will include on-site handling.</span>
          </span>
        </label>
      )}
    </div>
  );
}

function StepScope({
  form,
  vendors,
  technologies,
  toggleArray,
}: {
  form: CreateProjectData;
  vendors: VendorLookup[];
  technologies: TechnologyLookup[];
  toggleArray: (key: 'vendor_ids' | 'technology_ids', id: string) => void;
}) {
  return (
    <div className="space-y-5">
      <SelectionGrid title="Technologies" rows={technologies} selected={form.technology_ids} onToggle={(id) => toggleArray('technology_ids', id)} />
      <SelectionGrid title="Approved Vendors" rows={vendors} selected={form.vendor_ids} onToggle={(id) => toggleArray('vendor_ids', id)} />
    </div>
  );
}

function SelectionGrid({
  title,
  rows,
  selected,
  onToggle,
}: {
  title: string;
  rows: Array<{ id: string; name: string; category?: string | null; generation?: string | null; description?: string | null }>;
  selected: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div>
      <h3 className="mb-3 text-caption font-semibold text-gray-900">{title}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {rows.map((row) => {
          const active = selected.includes(row.id);
          return (
            <button
              key={row.id}
              type="button"
              onClick={() => onToggle(row.id)}
              className={`rounded-apple-md border p-3 text-left transition-colors ${
                active ? 'border-signal-teal bg-signal-teal/10' : 'border-gray-100 bg-white hover:border-signal-teal/30'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-caption font-semibold text-gray-900">{row.name}</p>
                  <p className="mt-0.5 text-micro text-gray-500">{row.category || row.generation || row.description || 'Project scope item'}</p>
                </div>
                {active && <Check className="h-4 w-4 text-signal-teal" />}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StepCompliance({ form, update }: { form: CreateProjectData; update: <K extends keyof CreateProjectData>(key: K, value: CreateProjectData[K]) => void }) {
  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Compliance Regime">
          <input value={form.compliance_regime} onChange={(event) => update('compliance_regime', event.target.value)} className={inputClass()} placeholder="e.g. WEEE, ISO 14001" />
        </Field>
        <Field label="ESG Methodology Version">
          <input value={form.esg_methodology_version} onChange={(event) => update('esg_methodology_version', event.target.value)} className={inputClass()} placeholder="e.g. GRI 2021, SASB" />
        </Field>
        <Field label="Currency">
          <input value={form.currency} onChange={(event) => update('currency', event.target.value.toUpperCase())} className={inputClass()} maxLength={3} />
        </Field>
        <Field label="Budget Total">
          <input type="number" min="0" value={form.budget_total} onChange={(event) => update('budget_total', event.target.value)} className={inputClass()} />
        </Field>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex items-start gap-3 rounded-apple-md border border-gray-200 bg-white p-3">
          <input type="checkbox" checked={form.contains_sensitive_data} onChange={(event) => update('contains_sensitive_data', event.target.checked)} className="mt-0.5 h-4 w-4 accent-signal-teal" />
          <span>
            <span className="block text-caption font-medium text-gray-800">Contains sensitive data</span>
            <span className="block text-micro text-gray-500">Customer, network, operational, or commercially sensitive material.</span>
          </span>
        </label>
        <label className="flex items-start gap-3 rounded-apple-md border border-gray-200 bg-white p-3">
          <input type="checkbox" checked={form.contains_restricted_goods} onChange={(event) => update('contains_restricted_goods', event.target.checked)} className="mt-0.5 h-4 w-4 accent-signal-teal" />
          <span>
            <span className="block text-caption font-medium text-gray-800">Contains controlled goods</span>
            <span className="block text-micro text-gray-500">Items needing special handling, movement, export, or disposal controls.</span>
          </span>
        </label>
      </div>
      <Field label="Additional Compliance Information">
        <textarea value={form.compliance_notes} onChange={(event) => update('compliance_notes', event.target.value)} rows={3} className={inputClass('resize-none')} />
      </Field>
    </div>
  );
}

function StepReview({ form, vendors, technologies }: { form: CreateProjectData; vendors: VendorLookup[]; technologies: TechnologyLookup[] }) {
  const selectedVendors = vendors.filter((vendor) => form.vendor_ids.includes(vendor.id));
  const selectedTechs = technologies.filter((technology) => form.technology_ids.includes(technology.id));
  const rows = [
    ['Name', form.name],
    ['Reference', form.internal_reference || '-'],
    ['Operator', form.operator || '-'],
    ['Location', [form.site_name, form.region, form.country].filter(Boolean).join(', ') || '-'],
    ['Timeframe', [form.timeframe_start, form.timeframe_end].filter(Boolean).join(' to ') || '-'],
    ['Compliance', form.compliance_regime || '-'],
  ];
  return (
    <div className="space-y-5">
      <div className="rounded-apple-md border border-signal-teal/20 bg-signal-teal/10 p-4">
        <p className="text-caption font-medium text-signal-teal">Ready to create your project.</p>
        <p className="mt-1 text-micro text-signal-teal/80">A six-stage Cirtell workflow will be created automatically.</p>
      </div>
      <div className="rounded-apple-md bg-gray-50 p-4">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-4 border-b border-white py-2 last:border-0">
            <span className="text-caption text-gray-500">{label}</span>
            <span className="max-w-[60%] truncate text-right text-caption font-medium text-gray-900">{value}</span>
          </div>
        ))}
      </div>
      {(selectedTechs.length > 0 || selectedVendors.length > 0) && (
        <div className="space-y-3">
          <ChipRow label="Technologies" items={selectedTechs.map((item) => item.name)} />
          <ChipRow label="Vendors" items={selectedVendors.map((item) => item.name)} />
        </div>
      )}
    </div>
  );
}

function ChipRow({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="mb-2 text-micro font-semibold uppercase tracking-wider text-gray-500">{label}</p>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => (
          <span key={item} className="rounded-pill bg-signal-teal/10 px-2.5 py-1 text-micro font-semibold text-signal-teal">
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

function ProjectDetailView({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const canManage = user?.role === 'Admin' || user?.role === 'User';
  const [bundle, setBundle] = useState<ProjectBundle | null>(null);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [statusOpen, setStatusOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [projectData, memberData] = await Promise.all([
        fetchProjectBundle(projectId),
        apiRequest<{ members: ProjectMember[] }>(`/api/projects/${projectId}/members`).catch(() => ({ members: [] })),
      ]);
      setBundle(projectData);
      setMembers(memberData.members || []);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load project'));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = () => void load();

  const updateStatus = async (status: ProjectStatus) => {
    if (!bundle) return;
    try {
      await apiRequest(`/api/projects/${projectId}`, { method: 'PUT', body: { status } });
      setBundle((current) => current ? { ...current, project: { ...current.project, status } } : current);
      setStatusOpen(false);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to update status'));
    }
  };

  if (loading) return <SpinnerBlock label="Loading project..." />;

  if (error || !bundle) {
    return (
      <div className="space-y-4">
        <button type="button" onClick={() => navigate('/projects')} className="btn-secondary">
          <ArrowLeft className="h-4 w-4" />
          Back to projects
        </button>
        <ErrorBanner message={error || 'Project not found'} onRetry={refresh} />
      </div>
    );
  }

  const project = bundle.project;
  const st = statusConfig(project.status);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <button type="button" onClick={() => navigate('/projects')} className="rounded-apple p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="truncate text-sub-heading font-bold text-gray-900">{project.name}</h1>
              <div className="relative">
                <button
                  type="button"
                  disabled={!canManage}
                  onClick={() => setStatusOpen((value) => !value)}
                  className={`inline-flex items-center gap-1 rounded-pill border px-2.5 py-1 text-micro font-semibold ${st.bg} ${st.color} ${st.border}`}
                >
                  {st.label}
                  {canManage && <ChevronRight className={`h-3 w-3 transition-transform ${statusOpen ? 'rotate-90' : ''}`} />}
                </button>
                {statusOpen && (
                  <div className="absolute left-0 top-full z-20 mt-1 min-w-40 rounded-apple border border-gray-100 bg-white py-1 shadow-apple-sm">
                    {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => void updateStatus(key as ProjectStatus)}
                        className={`w-full px-3 py-1.5 text-left text-micro font-medium transition-colors hover:bg-gray-50 ${cfg.color}`}
                      >
                        {cfg.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {project.description && <p className="mt-1 line-clamp-1 text-caption text-gray-500">{project.description}</p>}
            <div className="mt-1 flex flex-wrap items-center gap-4 text-micro text-gray-500">
              {project.operator && <span className="flex items-center gap-1"><Settings className="h-3 w-3" />{project.operator}</span>}
              {(project.region || project.country) && <span>{[project.region, project.country].filter(Boolean).join(', ')}</span>}
              {project.currency && <span>{project.currency}</span>}
              {project.company_name && <span>{project.company_name}</span>}
            </div>
          </div>
        </div>

        <div className="border-b border-gray-200">
          <nav className="-mb-px flex gap-0 overflow-x-auto">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-caption font-medium transition-colors ${
                    active ? 'border-signal-teal text-signal-teal' : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      {activeTab === 'overview' && <ProjectOverviewTab bundle={bundle} onNavigateTab={setActiveTab} />}
      {activeTab === 'workflow' && <WorkflowTab bundle={bundle} canManage={canManage} onRefresh={refresh} />}
      {activeTab === 'equipment' && <EquipmentTab bundle={bundle} canManage={canManage} onRefresh={refresh} />}
      {activeTab === 'logistics' && <LogisticsTab bundle={bundle} canManage={canManage} onRefresh={refresh} />}
      {activeTab === 'financials' && <FinancialsTab bundle={bundle} canManage={canManage} onRefresh={refresh} />}
      {activeTab === 'evidence' && <EvidenceTab bundle={bundle} canManage={canManage} onRefresh={refresh} />}
      {activeTab === 'comments' && <CommentsTab bundle={bundle} onRefresh={refresh} />}
      {activeTab === 'reports' && <ReportsTab bundle={bundle} />}
      {activeTab === 'members' && <MembersTab members={members} project={project} />}
    </div>
  );
}

function ProjectOverviewTab({ bundle, onNavigateTab }: { bundle: ProjectBundle; onNavigateTab: (tab: TabKey) => void }) {
  const project = bundle.project;
  const completedStages = bundle.stages.filter((stage) => stage.status === 'completed').length;
  const progress = bundle.stages.length > 0 ? Math.round((completedStages / bundle.stages.length) * 100) : 0;
  const materialKpis = projectMaterialKpis(bundle);
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard icon={Package} label="Materials" value={formatNumber(materialKpis.equipmentCount)} detail="Total units" />
        <StatCard icon={Shield} label="CO2e Avoided" value={`${formatNumber(materialKpis.co2AvoidedKg)} kg`} detail="Estimated impact" />
        <StatCard icon={DollarSign} label="Reuse Value" value={formatCurrency(materialKpis.reuseValue, project.currency || 'USD')} detail="Recovered value" />
        <StatCard icon={GitBranch} label="Workflow" value={`${progress}%`} detail={`${completedStages} of ${bundle.stages.length} stages`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-apple-lg border border-gray-100 bg-white p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-sub-heading font-semibold text-gray-900">Project Information</h2>
              <p className="text-caption text-gray-500">Scope, location, compliance, and ownership</p>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <DetailItem label="Internal Reference" value={project.internal_reference} />
            <DetailItem label="Operator" value={project.operator} />
            <DetailItem label="Location" value={[project.site_name, project.region, project.country].filter(Boolean).join(', ')} />
            <DetailItem label="Timeframe" value={[formatDate(project.timeframe_start), formatDate(project.timeframe_end)].filter((value) => value !== '-').join(' to ')} />
            <DetailItem label="ESG Methodology" value={project.esg_methodology_version} />
            <DetailItem label="Compliance Regime" value={project.compliance_regime} />
          </div>
          {(isTruthy(project.contains_sensitive_data) || isTruthy(project.contains_restricted_goods)) && (
            <div className="mt-4 rounded-apple-md border border-signal-teal/20 bg-signal-teal/5 p-4">
              <p className="text-caption font-semibold text-deep-teal">Handling controls active</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {isTruthy(project.contains_sensitive_data) && <Badge className="border-signal-teal/20 bg-signal-teal/10 text-signal-teal">Sensitive data</Badge>}
                {isTruthy(project.contains_restricted_goods) && <Badge className="border-deep-teal/20 bg-deep-teal/10 text-deep-teal">Controlled goods</Badge>}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <button type="button" onClick={() => onNavigateTab('workflow')} className="w-full rounded-apple-lg border border-gray-100 bg-white p-5 text-left transition-colors hover:border-signal-teal/30">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-caption font-semibold text-gray-900">Workflow Progress</h2>
              <span className="text-micro font-semibold text-signal-teal">{progress}%</span>
            </div>
            <div className="h-2 rounded-pill bg-gray-100">
              <div className="h-full rounded-pill bg-signal-teal" style={{ width: `${progress}%` }} />
            </div>
            <div className="mt-3 space-y-2">
              {bundle.stages.slice(0, 4).map((stage) => {
                const cfg = workflowConfig(stage.status);
                return (
                  <div key={stage.id} className="flex items-center justify-between text-micro">
                    <span className="font-medium text-gray-700">{stage.label}</span>
                    <span className={`${cfg.color}`}>{cfg.label}</span>
                  </div>
                );
              })}
            </div>
          </button>

          <div className="rounded-apple-lg border border-gray-100 bg-white p-5">
            <h2 className="mb-3 text-caption font-semibold text-gray-900">Recent Activity</h2>
            {bundle.recentActivity.length === 0 ? (
              <p className="text-caption text-gray-400">No activity yet</p>
            ) : (
              <div className="space-y-3">
                {bundle.recentActivity.slice(0, 5).map((activity) => (
                  <div key={activity.id} className="flex gap-3">
                    <div className="mt-1 h-2 w-2 rounded-full bg-signal-teal" />
                    <div className="min-w-0">
                      <p className="text-caption font-medium text-gray-800">{activity.action.replaceAll('_', ' ')}</p>
                      <p className="text-micro text-gray-400">{activity.user_name || 'System'} - {formatDate(activity.created_at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <TagPanel title="Technologies" items={bundle.technologies.map((item) => item.name)} />
        <TagPanel title="Approved Vendors" items={bundle.vendors.map((item) => item.name)} />
      </div>
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="rounded-apple bg-gray-50 p-3">
      <p className="text-micro font-semibold uppercase tracking-wider text-gray-500">{label}</p>
      <p className="mt-1 truncate text-caption font-medium text-gray-900">{value || '-'}</p>
    </div>
  );
}

function TagPanel({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-apple-lg border border-gray-100 bg-white p-5">
      <h2 className="mb-3 text-caption font-semibold text-gray-900">{title}</h2>
      {items.length === 0 ? (
        <p className="text-caption text-gray-400">No items selected</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {items.map((item) => <Badge key={item} className="border-signal-teal/20 bg-signal-teal/10 text-signal-teal">{item}</Badge>)}
        </div>
      )}
    </div>
  );
}

function WorkflowTab({ bundle, canManage, onRefresh }: { bundle: ProjectBundle; canManage: boolean; onRefresh: () => void }) {
  const [taskTitle, setTaskTitle] = useState('');
  const [taskStage, setTaskStage] = useState(bundle.stages[0]?.id || '');
  const [saving, setSaving] = useState(false);

  const updateStage = async (stageId: string, status: WorkflowStatus) => {
    setSaving(true);
    try {
      await apiRequest(`/api/projects/${bundle.project.id}/workflow/stages/${stageId}`, { method: 'PUT', body: { status } });
      onRefresh();
    } finally {
      setSaving(false);
    }
  };

  const addTask = async (event: FormEvent) => {
    event.preventDefault();
    if (!taskTitle.trim() || !taskStage) return;
    setSaving(true);
    try {
      await apiRequest(`/api/projects/${bundle.project.id}/workflow/tasks`, { method: 'POST', body: { title: taskTitle, stage_id: taskStage } });
      setTaskTitle('');
      onRefresh();
    } finally {
      setSaving(false);
    }
  };

  const toggleTask = async (task: WorkflowTask) => {
    setSaving(true);
    try {
      await apiRequest(`/api/projects/${bundle.project.id}/workflow/tasks/${task.id}`, {
        method: 'PUT',
        body: { status: task.status === 'done' ? 'open' : 'done' },
      });
      onRefresh();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        {bundle.stages.map((stage, index) => {
          const cfg = workflowConfig(stage.status);
          const tasks = bundle.tasks.filter((task) => task.stage_id === stage.id);
          return (
            <div key={stage.id} className="rounded-apple-lg border border-gray-100 bg-white p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-apple-md bg-signal-teal/10 text-caption font-bold text-signal-teal">
                    {index + 1}
                  </div>
                  <div>
                    <h3 className="text-caption font-semibold text-gray-900">{stage.label}</h3>
                    <p className="mt-1 text-micro text-gray-500">{tasks.length} checklist item{tasks.length === 1 ? '' : 's'}</p>
                  </div>
                </div>
                <Badge className={`${cfg.bg} ${cfg.color} border-transparent`}>{cfg.label}</Badge>
              </div>
              {canManage && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {Object.entries(WORKFLOW_STATUS_CONFIG).map(([status, value]) => (
                    <button
                      key={status}
                      type="button"
                      disabled={saving}
                      onClick={() => void updateStage(stage.id, status as WorkflowStatus)}
                      className={`rounded-apple px-3 py-1.5 text-micro font-semibold transition-colors ${
                        stage.status === status ? 'bg-signal-teal text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {value.label}
                    </button>
                  ))}
                </div>
              )}
              {tasks.length > 0 && (
                <div className="mt-4 divide-y divide-gray-50 rounded-apple border border-gray-100">
                  {tasks.map((task) => (
                    <button
                      key={task.id}
                      type="button"
                      disabled={!canManage || saving}
                      onClick={() => void toggleTask(task)}
                      className="flex w-full items-center gap-3 px-3 py-2 text-left text-caption hover:bg-gray-50"
                    >
                      <span className={`flex h-5 w-5 items-center justify-center rounded border ${task.status === 'done' ? 'border-signal-teal bg-signal-teal text-white' : 'border-gray-300'}`}>
                        {task.status === 'done' && <Check className="h-3.5 w-3.5" />}
                      </span>
                      <span className={task.status === 'done' ? 'text-gray-400 line-through' : 'text-gray-700'}>{task.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="rounded-apple-lg border border-gray-100 bg-white p-5">
        <h2 className="text-caption font-semibold text-gray-900">Workflow Checklist</h2>
        <p className="mt-1 text-micro text-gray-500">Add task-level controls to any stage.</p>
        {canManage && (
          <form onSubmit={(event) => void addTask(event)} className="mt-4 space-y-3">
            <Field label="Stage">
              <select value={taskStage} onChange={(event) => setTaskStage(event.target.value)} className={inputClass()}>
                {bundle.stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.label}</option>)}
              </select>
            </Field>
            <Field label="Task">
              <input value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} className={inputClass()} placeholder="Add checklist item" />
            </Field>
            <button type="submit" disabled={saving || !taskTitle.trim()} className="btn-primary w-full">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Add Task
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function TransactionLinkButton({ transactionId }: { transactionId: string }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      title="Open source transaction"
      onClick={() => navigate('/transactions?transaction_id=' + encodeURIComponent(transactionId))}
      className="rounded p-1.5 text-signal-teal hover:bg-signal-teal/10 hover:text-deep-teal"
    >
      <Eye className="h-4 w-4" />
    </button>
  );
}

function ProjectionWarnings({ warnings }: { warnings: ProjectTransactionProjection['reconciliationWarnings'] }) {
  if (warnings.length === 0) return null;
  return (
    <div className="rounded-apple-lg border border-signal-teal/20 bg-signal-teal/5 p-4 text-caption text-deep-teal">
      <div className="mb-2 flex items-center gap-2 font-semibold">
        <AlertCircle className="h-4 w-4 shrink-0" />
        {warnings.length} transaction line{warnings.length === 1 ? '' : 's'} need review
      </div>
      <div className="space-y-2">
        {warnings.map((warning, index) => (
          <div key={warning.code + '-' + warning.transactionId + '-' + (warning.transactionItemId || index)} className="flex items-center justify-between gap-3">
            <span>{warning.message}</span>
            <TransactionLinkButton transactionId={warning.transactionId} />
          </div>
        ))}
      </div>
    </div>
  );
}
function EquipmentTab({ bundle, canManage, onRefresh }: { bundle: ProjectBundle; canManage: boolean; onRefresh: () => void }) {
  const equipmentRows = useMemo(() => projectMaterialRows(bundle), [bundle]);
  const projectionWarnings = bundle.transactionProjection?.reconciliationWarnings || [];

  const importInputRef = useRef<HTMLInputElement>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<EquipmentForm>(equipmentDefaults);
  const [partSearchText, setPartSearchText] = useState('');
  const [partOptions, setPartOptions] = useState<PartOption[]>([]);
  const [partSearching, setPartSearching] = useState(false);
  const [showPartSuggestions, setShowPartSuggestions] = useState(false);
  const [selectedCatalogPart, setSelectedCatalogPart] = useState<PartOption | null>(null);
  const [importing, setImporting] = useState(false);
  const [importSummary, setImportSummary] = useState<EquipmentImportSummary | null>(null);
  const [importIssues, setImportIssues] = useState<EquipmentImportIssue[]>([]);
  const [importError, setImportError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!formOpen) return;
    const query = partSearchText.trim();
    if (!query) {
      setPartOptions([]);
      setPartSearching(false);
      return;
    }

    let cancelled = false;
    const handle = window.setTimeout(async () => {
      setPartSearching(true);
      try {
        const options = await fetchProjectPartOptions(query);
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
  }, [formOpen, partSearchText]);

  const openForm = () => {
    setForm(equipmentDefaults);
    setPartSearchText('');
    setPartOptions([]);
    setShowPartSuggestions(false);
    setSelectedCatalogPart(null);
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setPartSearchText('');
    setPartOptions([]);
    setShowPartSuggestions(false);
    setSelectedCatalogPart(null);
  };

  const fillFromCatalogPart = (part: PartOption) => {
    const quantity = Number(form.quantity || 1) || 1;
    const label = catalogPartLabel(part);
    setSelectedCatalogPart(part);
    setPartSearchText(label);
    setShowPartSuggestions(false);
    setForm((current) => ({
      ...current,
      part_id: part.id,
      item_name: label,
      vendor: part.vendor || '',
      category: part.category || part.subcategory || '',
      weight_kg: part.weight_kg != null ? String(part.weight_kg) : '',
      co2_avoided_kg: part.emission_factor_kg != null ? String(part.emission_factor_kg * quantity) : '',
      notes: current.notes || part.description || '',
    }));
  };

  const updateQuantity = (value: string) => {
    setForm((current) => ({
      ...current,
      quantity: value,
      co2_avoided_kg: selectedCatalogPart?.emission_factor_kg != null && value
        ? String(selectedCatalogPart.emission_factor_kg * (Number(value) || 1))
        : current.co2_avoided_kg,
    }));
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.item_name.trim()) return;
    setSaving(true);
    try {
      await apiRequest(`/api/projects/${bundle.project.id}/equipment`, {
        method: 'POST',
        body: {
          ...form,
          part_id: form.part_id || null,
          quantity: Number(form.quantity || 1),
          weight_kg: form.weight_kg ? Number(form.weight_kg) : null,
          estimated_reuse_value: form.estimated_reuse_value ? Number(form.estimated_reuse_value) : 0,
          co2_avoided_kg: form.co2_avoided_kg ? Number(form.co2_avoided_kg) : 0,
        },
      });
      setForm(equipmentDefaults);
      closeForm();
      onRefresh();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (equipmentId: string) => {
    if (!window.confirm('Delete this equipment entry?')) return;
    await apiRequest(`/api/projects/${bundle.project.id}/equipment/${equipmentId}`, { method: 'DELETE' });
    onRefresh();
  };

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setImporting(true);
    setImportSummary(null);
    setImportIssues([]);
    setImportError('');

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

      const parsed = parseEquipmentImportRows(rows);
      if (parsed.equipment.length === 0) {
        setImportIssues(parsed.issues);
        throw new Error(parsed.issues[0]?.error || 'No importable rows found');
      }

      const response = await apiRequest<{ success: boolean; summary: EquipmentImportSummary; issues?: EquipmentImportIssue[] }>(
        `/api/projects/${bundle.project.id}/equipment/import`,
        { method: 'POST', body: { equipment: parsed.equipment } },
      );
      setImportSummary(response.summary);
      setImportIssues([...parsed.issues, ...(response.issues || [])]);
      onRefresh();
    } catch (err) {
      setImportError(getErrorMessage(err, 'Failed to import materials and assets'));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Materials & Assets"
        subtitle="Validated equipment, reusable material, and recovery values"
        action={canManage ? (
          <div className="flex flex-wrap gap-2">
            <input
              ref={importInputRef}
              type="file"
              accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              onChange={(event) => void handleImportFile(event)}
              className="hidden"
            />
            <button type="button" onClick={() => importInputRef.current?.click()} disabled={importing} className="btn-secondary">
              {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {importing ? 'Importing...' : 'Import Excel'}
            </button>
            <button type="button" onClick={openForm} className="btn-primary"><Plus className="h-4 w-4" />Add Equipment</button>
          </div>
        ) : null}
      />
      {importError && <ErrorBanner message={importError} />}
      <ProjectionWarnings warnings={projectionWarnings} />
      {(importSummary || importIssues.length > 0) && (
        <div className="rounded-apple-lg border border-signal-teal/20 bg-signal-teal/5 p-4">
          {importSummary && (
            <p className="text-caption font-medium text-deep-teal">
              Import complete: {importSummary.created} added, {importSummary.linked} linked to catalog, {importSummary.skipped} skipped.
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
      <DataTable
        emptyIcon={Package}
        emptyText="No equipment entries yet"
        headers={['Item', 'Vendor', 'Qty', 'Condition', 'Stage', 'CO2e Avoided', 'Value', 'Source', '']}
      >
        {equipmentRows.map((item) => (
          <tr key={item.id} className="hover:bg-gray-50">
            <td className="px-4 py-3">
              <p className="font-medium text-gray-900">{item.item_name}</p>
              <p className="text-micro text-gray-400">
                {item.part_number ? `Catalog: ${item.part_number}` : item.asset_tag || item.serial_number || '-'}
              </p>
            </td>
            <td className="px-4 py-3 text-gray-600">{item.vendor || '-'}</td>
            <td className="px-4 py-3 font-semibold">{item.quantity}</td>
            <td className="px-4 py-3"><Badge className="border-signal-teal/20 bg-signal-teal/10 text-signal-teal">{item.condition}</Badge></td>
            <td className="px-4 py-3 text-gray-600">{item.current_stage.replaceAll('_', ' ')}</td>
            <td className="px-4 py-3 text-gray-600">{item.co2_avoided_kg == null ? '-' : formatNumber(item.co2_avoided_kg) + ' kg'}</td>
            <td className="px-4 py-3 font-medium">{formatCurrency(item.estimated_reuse_value, bundle.project.currency || 'USD')}</td>
            <td className="px-4 py-3">
              <div className="flex flex-col items-start gap-1">
                <Badge className={projectionSourceClass(item.source)}>{projectionSourceLabel(item.source)}</Badge>
                {item.inventory_sync_statuses?.some((status) => status === 'not_ready') && (
                  <span className="text-[10px] font-medium text-gray-500">Inventory not ready</span>
                )}
              </div>
            </td>
            <td className="px-4 py-3 text-right">
              <div className="flex justify-end gap-1">
                {item.transaction_ids?.[0] && <TransactionLinkButton transactionId={item.transaction_ids[0]} />}
                {canManage && !item.read_only && (
                  <button type="button" title="Delete project equipment" onClick={() => void remove(item.id)} className="rounded p-1.5 text-gray-400 hover:bg-gray-50 hover:text-gray-600">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </td>
          </tr>
        ))}
      </DataTable>
      {formOpen && (
        <SimpleModal title="Add Equipment" onClose={closeForm}>
          <form onSubmit={(event) => void save(event)} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Item Name" required>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input
                    value={partSearchText}
                    onChange={(event) => {
                      const value = event.target.value;
                      setPartSearchText(value);
                      setShowPartSuggestions(true);
                      setSelectedCatalogPart(null);
                      setForm((current) => ({ ...current, part_id: '', item_name: value }));
                    }}
                    onFocus={() => setShowPartSuggestions(true)}
                    className={`${inputClass('pl-10 pr-10')}`}
                    placeholder="Search parts catalog by name or part number"
                  />
                  {partSearching && <RefreshCw className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-gray-400" />}
                  {form.part_id && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCatalogPart(null);
                        setForm((current) => ({ ...current, part_id: '' }));
                      }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 hover:bg-gray-50 hover:text-gray-600"
                      title="Clear catalog link"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {showPartSuggestions && partSearchText.trim().length > 0 && (
                    <div className="absolute left-0 right-0 z-50 mt-1 overflow-hidden rounded-apple-md border border-gray-200 bg-white shadow-apple">
                      <div className="max-h-64 overflow-y-auto">
                        {partOptions.length > 0 ? (
                          partOptions.map((part) => (
                            <button
                              key={part.id}
                              type="button"
                              onClick={() => fillFromCatalogPart(part)}
                              className="w-full border-b border-gray-50 px-4 py-3 text-left transition-colors last:border-0 hover:bg-signal-teal/5"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <span className="truncate font-medium text-gray-900">{catalogPartLabel(part)}</span>
                                <span className="shrink-0 font-mono text-micro text-signal-teal">{part.part_number}</span>
                              </div>
                              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-micro text-gray-500">
                                {part.vendor && <span>{part.vendor}</span>}
                                {part.category && <span>{part.category}</span>}
                                {part.technology_type && <span>{part.technology_type}</span>}
                              </div>
                            </button>
                          ))
                        ) : !partSearching ? (
                          <div className="px-4 py-3 text-caption text-gray-500">No matching catalog parts found</div>
                        ) : null}
                      </div>
                    </div>
                  )}
                </div>
                {form.part_id && (
                  <div className="mt-2 rounded-apple-md border border-signal-teal/20 bg-signal-teal/5 px-3 py-2 text-micro text-signal-teal">
                    Linked to parts catalog{selectedCatalogPart?.part_number ? `: ${selectedCatalogPart.part_number}` : ''}
                  </div>
                )}
              </Field>
              <Field label="Asset Tag"><input value={form.asset_tag} onChange={(event) => setForm({ ...form, asset_tag: event.target.value })} className={inputClass()} /></Field>
              <Field label="Vendor"><input value={form.vendor} onChange={(event) => setForm({ ...form, vendor: event.target.value })} className={inputClass()} /></Field>
              <Field label="Category"><input value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} className={inputClass()} /></Field>
              <Field label="Quantity"><input type="number" min="1" value={form.quantity} onChange={(event) => updateQuantity(event.target.value)} className={inputClass()} /></Field>
              <Field label="Condition"><input value={form.condition} onChange={(event) => setForm({ ...form, condition: event.target.value })} className={inputClass()} /></Field>
              <Field label="Weight kg"><input type="number" step="0.01" value={form.weight_kg} onChange={(event) => setForm({ ...form, weight_kg: event.target.value })} className={inputClass()} /></Field>
              <Field label="CO2e Avoided kg"><input type="number" step="0.01" value={form.co2_avoided_kg} onChange={(event) => setForm({ ...form, co2_avoided_kg: event.target.value })} className={inputClass()} /></Field>
              <Field label="Reuse Value"><input type="number" step="0.01" value={form.estimated_reuse_value} onChange={(event) => setForm({ ...form, estimated_reuse_value: event.target.value })} className={inputClass()} /></Field>
              <Field label="Current Stage"><StageSelect value={form.current_stage} stages={bundle.stages} onChange={(value) => setForm({ ...form, current_stage: value })} /></Field>
            </div>
            <Field label="Notes"><textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} rows={2} className={inputClass('resize-none')} /></Field>
            <ModalActions saving={saving} onClose={closeForm} />
          </form>
        </SimpleModal>
      )}
    </div>
  );
}

function FinancialsTab({ bundle, canManage, onRefresh }: { bundle: ProjectBundle; canManage: boolean; onRefresh: () => void }) {
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FinancialForm>(financialDefaults);
  const [saving, setSaving] = useState(false);
  const { rows: financialRows, revenue, cost, net } = useMemo(() => projectFinancialTotals(bundle), [bundle]);
  const currency = bundle.project.currency || 'USD';

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.category.trim()) return;
    setSaving(true);
    try {
      await apiRequest(`/api/projects/${bundle.project.id}/financials`, { method: 'POST', body: { ...form, amount: Number(form.amount || 0), currency } });
      setForm(financialDefaults);
      setFormOpen(false);
      onRefresh();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    await apiRequest(`/api/projects/${bundle.project.id}/financials/${id}`, { method: 'DELETE' });
    onRefresh();
  };

  return (
    <div className="space-y-4">
      <SectionHeader title="Financials" subtitle="Costs, revenue, credits, and net project value" action={canManage ? <button type="button" onClick={() => setFormOpen(true)} className="btn-primary"><Plus className="h-4 w-4" />Add Entry</button> : null} />
      <ProjectionWarnings warnings={bundle.transactionProjection?.reconciliationWarnings || []} />
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard icon={DollarSign} label="Revenue / Credits" value={formatCurrency(revenue, currency)} detail="Positive value" />
        <StatCard icon={DollarSign} label="Costs" value={formatCurrency(cost, currency)} detail="Project spend" />
        <StatCard icon={DollarSign} label="Net" value={formatCurrency(net, currency)} detail="Revenue less cost" />
      </div>
      <DataTable emptyIcon={DollarSign} emptyText="No financial entries yet" headers={['Type', 'Category', 'Description', 'Stage', 'Date', 'Amount', 'Source', '']}>
        {financialRows.map((item) => (
          <tr key={item.id} className="hover:bg-gray-50">
            <td className="px-4 py-3"><Badge className="border-signal-teal/20 bg-signal-teal/10 text-signal-teal">{item.type}</Badge></td>
            <td className="px-4 py-3 font-medium text-gray-900">{item.category}</td>
            <td className="px-4 py-3 text-gray-500">{item.description || '-'}</td>
            <td className="px-4 py-3 text-gray-500">{item.stage || '-'}</td>
            <td className="px-4 py-3 text-gray-500">{formatDate(item.incurred_at || item.created_at)}</td>
            <td className="px-4 py-3 font-semibold">{formatCurrency(item.amount, item.currency || currency)}</td>
            <td className="px-4 py-3">
              <Badge className={projectionSourceClass(item.source)}>{projectionSourceLabel(item.source)}</Badge>
            </td>
            <td className="px-4 py-3 text-right">
              <div className="flex justify-end gap-1">
                {item.transaction_id && <TransactionLinkButton transactionId={item.transaction_id} />}
                {canManage && !item.read_only && <DeleteButton onClick={() => void remove(item.id)} />}
              </div>
            </td>
          </tr>
        ))}
      </DataTable>
      {formOpen && (
        <SimpleModal title="Add Financial Entry" onClose={() => setFormOpen(false)}>
          <form onSubmit={(event) => void save(event)} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Type"><select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as FinancialForm['type'] })} className={inputClass()}><option value="cost">Cost</option><option value="revenue">Revenue</option><option value="credit">Credit</option></select></Field>
              <Field label="Category" required><input value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} className={inputClass()} /></Field>
              <Field label="Amount"><input type="number" step="0.01" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} className={inputClass()} /></Field>
              <Field label="Date"><input type="date" value={form.incurred_at} onChange={(event) => setForm({ ...form, incurred_at: event.target.value })} className={inputClass()} /></Field>
              <Field label="Stage"><StageSelect value={form.stage} stages={bundle.stages} onChange={(value) => setForm({ ...form, stage: value })} /></Field>
            </div>
            <Field label="Description"><input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} className={inputClass()} /></Field>
            <ModalActions saving={saving} onClose={() => setFormOpen(false)} />
          </form>
        </SimpleModal>
      )}
    </div>
  );
}

function LogisticsTab({ bundle, canManage, onRefresh }: { bundle: ProjectBundle; canManage: boolean; onRefresh: () => void }) {
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<LogisticsForm>(logisticsDefaults);
  const [saving, setSaving] = useState(false);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await apiRequest(`/api/projects/${bundle.project.id}/logistics`, { method: 'POST', body: { ...form, estimated_cost: Number(form.estimated_cost || 0) } });
      setForm(logisticsDefaults);
      setFormOpen(false);
      onRefresh();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    await apiRequest(`/api/projects/${bundle.project.id}/logistics/${id}`, { method: 'DELETE' });
    onRefresh();
  };

  return (
    <div className="space-y-4">
      <SectionHeader title="Logistics" subtitle="Collection, transportation, consolidation, and delivery records" action={canManage ? <button type="button" onClick={() => setFormOpen(true)} className="btn-primary"><Plus className="h-4 w-4" />Add Shipment</button> : null} />
      <DataTable emptyIcon={Truck} emptyText="No logistics entries yet" headers={['Type', 'Status', 'Carrier', 'Route', 'Date', 'Cost', '']}>
        {bundle.logistics.map((item) => (
          <tr key={item.id} className="hover:bg-gray-50">
            <td className="px-4 py-3 font-medium text-gray-900">{item.shipment_type}</td>
            <td className="px-4 py-3"><Badge className="border-signal-teal/20 bg-signal-teal/10 text-signal-teal">{item.status}</Badge></td>
            <td className="px-4 py-3 text-gray-500">{item.carrier || '-'}</td>
            <td className="px-4 py-3 text-gray-500">{[item.origin, item.destination].filter(Boolean).join(' to ') || '-'}</td>
            <td className="px-4 py-3 text-gray-500">{formatDate(item.scheduled_date)}</td>
            <td className="px-4 py-3 font-semibold">{formatCurrency(item.estimated_cost, bundle.project.currency || 'USD')}</td>
            <td className="px-4 py-3 text-right">{canManage && <DeleteButton onClick={() => void remove(item.id)} />}</td>
          </tr>
        ))}
      </DataTable>
      {formOpen && (
        <SimpleModal title="Add Logistics Entry" onClose={() => setFormOpen(false)}>
          <form onSubmit={(event) => void save(event)} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Shipment Type"><input value={form.shipment_type} onChange={(event) => setForm({ ...form, shipment_type: event.target.value })} className={inputClass()} /></Field>
              <Field label="Status"><input value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })} className={inputClass()} /></Field>
              <Field label="Carrier"><input value={form.carrier} onChange={(event) => setForm({ ...form, carrier: event.target.value })} className={inputClass()} /></Field>
              <Field label="Scheduled Date"><input type="date" value={form.scheduled_date} onChange={(event) => setForm({ ...form, scheduled_date: event.target.value })} className={inputClass()} /></Field>
              <Field label="Origin"><input value={form.origin} onChange={(event) => setForm({ ...form, origin: event.target.value })} className={inputClass()} /></Field>
              <Field label="Destination"><input value={form.destination} onChange={(event) => setForm({ ...form, destination: event.target.value })} className={inputClass()} /></Field>
              <Field label="Tracking Reference"><input value={form.tracking_reference} onChange={(event) => setForm({ ...form, tracking_reference: event.target.value })} className={inputClass()} /></Field>
              <Field label="Estimated Cost"><input type="number" step="0.01" value={form.estimated_cost} onChange={(event) => setForm({ ...form, estimated_cost: event.target.value })} className={inputClass()} /></Field>
            </div>
            <Field label="Notes"><textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} rows={2} className={inputClass('resize-none')} /></Field>
            <ModalActions saving={saving} onClose={() => setFormOpen(false)} />
          </form>
        </SimpleModal>
      )}
    </div>
  );
}

function EvidenceTab({ bundle, canManage, onRefresh }: { bundle: ProjectBundle; canManage: boolean; onRefresh: () => void }) {
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<EvidenceForm>(evidenceDefaults);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.title.trim()) {
      setError('Evidence title is required');
      return;
    }
    if (!selectedFile) {
      setError('Evidence file is required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = new FormData();
      payload.set('title', form.title.trim());
      payload.set('evidence_type', form.evidence_type.trim() || 'document');
      if (form.stage) payload.set('stage', form.stage);
      if (form.notes.trim()) payload.set('notes', form.notes.trim());
      payload.set('file', selectedFile);
      await apiRequest(`/api/projects/${bundle.project.id}/evidence`, { method: 'POST', body: payload });
      setForm(evidenceDefaults);
      setSelectedFile(null);
      setFormOpen(false);
      onRefresh();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to add evidence'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    await apiRequest(`/api/projects/${bundle.project.id}/evidence/${id}`, { method: 'DELETE' });
    onRefresh();
  };

  return (
    <div className="space-y-4">
      <SectionHeader title="Evidence" subtitle="Documents, photos, certificates, and audit proof" action={canManage ? <button type="button" onClick={() => setFormOpen(true)} className="btn-primary"><Plus className="h-4 w-4" />Add Evidence</button> : null} />
      <DataTable emptyIcon={Shield} emptyText="No evidence yet" headers={['Title', 'Type', 'Stage', 'File', 'Uploaded By', 'Date', 'Link', '']}>
        {bundle.evidence.map((item) => {
          const link = evidenceHref(item.file_url);
          return (
            <tr key={item.id} className="hover:bg-gray-50">
              <td className="px-4 py-3 font-medium text-gray-900">{item.title}</td>
              <td className="px-4 py-3"><Badge className="border-signal-teal/20 bg-signal-teal/10 text-signal-teal">{item.evidence_type}</Badge></td>
              <td className="px-4 py-3 text-gray-500">{item.stage || '-'}</td>
              <td className="px-4 py-3 text-gray-500">
                <p className="max-w-[220px] truncate text-gray-700">{item.file_name || '-'}</p>
                <p className="text-micro text-gray-400">{formatFileSize(item.file_size)}</p>
              </td>
              <td className="px-4 py-3 text-gray-500">{item.uploaded_by_name || '-'}</td>
              <td className="px-4 py-3 text-gray-500">{formatDate(item.uploaded_at)}</td>
              <td className="px-4 py-3">{link ? <a href={link} target="_blank" rel="noreferrer" className="text-signal-teal hover:text-deep-teal">Open</a> : '-'}</td>
              <td className="px-4 py-3 text-right">{canManage && <DeleteButton onClick={() => void remove(item.id)} />}</td>
            </tr>
          );
        })}
      </DataTable>
      {formOpen && (
        <SimpleModal title="Add Evidence" onClose={() => {
          setFormOpen(false);
          setError('');
          setSelectedFile(null);
        }}>
          <form onSubmit={(event) => void save(event)} className="space-y-4">
            {error && <ErrorBanner message={error} />}
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Title" required><input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} className={inputClass()} /></Field>
              <Field label="Type"><input value={form.evidence_type} onChange={(event) => setForm({ ...form, evidence_type: event.target.value })} className={inputClass()} /></Field>
              <Field label="Stage"><StageSelect value={form.stage} stages={bundle.stages} onChange={(value) => setForm({ ...form, stage: value })} /></Field>
            </div>
            <Field label="Evidence File" required>
              <label className="flex cursor-pointer items-center gap-3 rounded-apple-md border border-dashed border-signal-teal/30 bg-signal-teal/5 px-4 py-5 transition-colors hover:border-signal-teal hover:bg-signal-teal/10">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-apple bg-signal-teal text-white">
                  <Upload className="h-5 w-5" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-caption font-semibold text-gray-900">
                    {selectedFile ? selectedFile.name : 'Choose an evidence file'}
                  </span>
                  <span className="block text-micro text-gray-500">
                    {selectedFile ? formatFileSize(selectedFile.size) : 'PDF, image, text, CSV, Word, Excel, or PowerPoint. Max 25 MB.'}
                  </span>
                </span>
                <input
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
                  onChange={(event) => {
                    setSelectedFile(event.target.files?.[0] || null);
                    setError('');
                  }}
                  className="sr-only"
                />
              </label>
            </Field>
            <Field label="Notes"><textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} rows={2} className={inputClass('resize-none')} /></Field>
            <ModalActions saving={saving} onClose={() => {
              setFormOpen(false);
              setError('');
              setSelectedFile(null);
            }} />
          </form>
        </SimpleModal>
      )}
    </div>
  );
}

function CommentsTab({ bundle, onRefresh }: { bundle: ProjectBundle; onRefresh: () => void }) {
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!comment.trim()) return;
    setSaving(true);
    try {
      await apiRequest(`/api/projects/${bundle.project.id}/comments`, { method: 'POST', body: { body: comment } });
      setComment('');
      onRefresh();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="space-y-3">
        {bundle.comments.length === 0 ? (
          <div className="rounded-apple-lg border border-gray-100 bg-white py-14 text-center">
            <MessageSquare className="mx-auto mb-3 h-10 w-10 text-gray-300" />
            <p className="text-caption text-gray-500">No discussion yet</p>
          </div>
        ) : (
          bundle.comments.map((item) => (
            <div key={item.id} className="rounded-apple-lg border border-gray-100 bg-white p-4">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-caption font-semibold text-gray-900">{item.user_name || item.user_email || 'User'}</p>
                <span className="text-micro text-gray-400">{formatDate(item.created_at)}</span>
              </div>
              <p className="whitespace-pre-wrap text-caption leading-relaxed text-gray-600">{item.body}</p>
            </div>
          ))
        )}
      </div>
      <form onSubmit={(event) => void save(event)} className="h-fit rounded-apple-lg border border-gray-100 bg-white p-5">
        <h2 className="text-caption font-semibold text-gray-900">Add Comment</h2>
        <textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={5} className={`${inputClass('mt-3 resize-none')}`} />
        <button type="submit" disabled={saving || !comment.trim()} className="btn-primary mt-3 w-full">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquare className="h-4 w-4" />}
          Post Comment
        </button>
      </form>
    </div>
  );
}

const REPORT_COLORS = ['#0f766e', '#10b981', '#2dd4bf', '#115e59', '#6ee7b7', '#64748b'];
const REPORT_TOOLTIP_STYLE = {
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  backgroundColor: '#ffffff',
  boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)',
  fontSize: 12,
};

function reportLabel(value?: string | null) {
  if (!value) return 'Unspecified';
  return value
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function shortReportLabel(value: string, max = 17) {
  return value.length > max ? value.slice(0, max - 3) + '...' : value;
}

function ReportChart({
  title,
  subtitle,
  empty,
  children,
  className = '',
}: {
  title: string;
  subtitle: string;
  empty: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={'min-w-0 rounded-apple-lg border border-gray-100 bg-white p-5 ' + className}>
      <div className="mb-5">
        <h3 className="text-caption font-semibold text-gray-900">{title}</h3>
        <p className="mt-0.5 text-micro text-gray-500">{subtitle}</p>
      </div>
      {empty ? (
        <div className="flex h-[260px] items-center justify-center rounded-apple bg-gray-50 text-caption text-gray-400">
          No report data yet
        </div>
      ) : children}
    </section>
  );
}

function ReportsTab({ bundle }: { bundle: ProjectBundle }) {
  const project = bundle.project;
  const currency = project.currency || 'USD';
  const materialKpis = projectMaterialKpis(bundle);
  const financialTotals = projectFinancialTotals(bundle);
  const equipmentRows = useMemo(() => projectMaterialRows(bundle), [bundle]);

  const stageData = useMemo(() => {
    const totals = new Map<string, number>();
    for (const item of equipmentRows) {
      const label = reportLabel(item.current_stage);
      totals.set(label, (totals.get(label) || 0) + Number(item.quantity || 0));
    }
    return [...totals.entries()]
      .map(([fullName, units]) => ({ name: shortReportLabel(fullName), fullName, units }))
      .sort((left, right) => right.units - left.units);
  }, [equipmentRows]);

  const conditionData = useMemo(() => {
    const totals = new Map<string, number>();
    for (const item of equipmentRows) {
      const label = reportLabel(item.condition);
      totals.set(label, (totals.get(label) || 0) + Number(item.quantity || 0));
    }
    return [...totals.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((left, right) => right.value - left.value);
  }, [equipmentRows]);

  const financialData = useMemo(() => {
    const totals = { revenue: 0, credit: 0, cost: 0 };
    for (const row of financialTotals.rows) {
      totals[row.type] += Number(row.amount || 0);
    }
    return [
      { name: 'Revenue', value: totals.revenue, fill: REPORT_COLORS[0] },
      { name: 'Credits', value: totals.credit, fill: REPORT_COLORS[1] },
      { name: 'Costs', value: totals.cost, fill: REPORT_COLORS[5] },
    ];
  }, [financialTotals.rows]);

  const workflowData = useMemo(() => bundle.stages.map((stage) => {
    const tasks = bundle.tasks.filter((task) => task.stage_id === stage.id);
    const completedTasks = tasks.filter((task) => task.status === 'done').length;
    const fallbackProgress = stage.status === 'completed' ? 100 : stage.status === 'in_progress' ? 50 : 0;
    return {
      name: shortReportLabel(stage.label || reportLabel(stage.stage), 19),
      fullName: stage.label || reportLabel(stage.stage),
      progress: tasks.length > 0 ? Math.round((completedTasks / tasks.length) * 100) : fallbackProgress,
      tasks: tasks.length,
    };
  }), [bundle.stages, bundle.tasks]);

  const impactData = useMemo(() => {
    const totals = new Map<string, { units: number; avoided: number; reuse: number }>();
    for (const item of equipmentRows) {
      const category = reportLabel(item.category);
      const current = totals.get(category) || { units: 0, avoided: 0, reuse: 0 };
      current.units += Number(item.quantity || 0);
      current.avoided += Number(item.co2_avoided_kg || 0);
      current.reuse += Number(item.estimated_reuse_value || 0);
      totals.set(category, current);
    }
    return [...totals.entries()]
      .map(([fullName, totalsByCategory]) => ({
        name: shortReportLabel(fullName, 16),
        fullName,
        ...totalsByCategory,
      }))
      .sort((left, right) => right.units - left.units)
      .slice(0, 8);
  }, [equipmentRows]);

  const completedStages = bundle.stages.filter((stage) => stage.status === 'completed').length;
  const transactionCount = Number(bundle.transactionProjection?.transactionSummary.transactionCount || 0);
  const sourceCounts = equipmentRows.reduce<Record<string, number>>((totals, item) => {
    const label = projectionSourceLabel(item.source);
    totals[label] = (totals[label] || 0) + Number(item.quantity || 0);
    return totals;
  }, {});

  const rows = [
    ['Project', project.name],
    ['Status', statusConfig(project.status).label],
    ['Materials', formatNumber(materialKpis.equipmentCount)],
    ['CO2e Avoided', formatNumber(materialKpis.co2AvoidedKg) + ' kg'],
    ['Reuse Value', formatCurrency(materialKpis.reuseValue, currency)],
    ['Net Financial', formatCurrency(financialTotals.net, currency)],
  ];

  const exportReport = () => {
    const text = rows.map(([label, value]) => label + ',' + String(value).replaceAll(',', ' ')).join('\n');
    const blob = new Blob(['Metric,Value\n' + text], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = project.name.replace(/[^\w-]+/g, '-').toLowerCase() + '-project-report.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };
  const kpis: Array<{ label: string; value: string; detail: string; icon: LucideIcon; tone: string }> = [
    {
      label: 'Assets in scope',
      value: formatNumber(materialKpis.equipmentCount),
      detail: Object.entries(sourceCounts).map(([source, count]) => source + ' ' + formatNumber(count)).join(' · ') || 'No linked assets',
      icon: Package,
      tone: 'bg-signal-teal/10 text-signal-teal',
    },
    {
      label: 'Avoided CO2e',
      value: formatNumber(materialKpis.co2AvoidedKg) + ' kg',
      detail: 'Calculated circularity impact',
      icon: Leaf,
      tone: 'bg-verified-green/10 text-verified-green',
    },
    {
      label: 'Reuse value',
      value: formatCurrency(materialKpis.reuseValue, currency),
      detail: 'Recoverable asset value',
      icon: DollarSign,
      tone: 'bg-deep-teal/10 text-deep-teal',
    },
    {
      label: 'Net financial',
      value: formatCurrency(financialTotals.net, currency),
      detail: formatCurrency(financialTotals.revenue, currency) + ' credits less ' + formatCurrency(financialTotals.cost, currency) + ' costs',
      icon: BarChart3,
      tone: 'bg-gray-100 text-gray-600',
    },
  ];

  return (
    <div className="space-y-5 pb-6">
      <header className="flex flex-col gap-4 border-b border-gray-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge className="border-signal-teal/20 bg-signal-teal/10 text-signal-teal">
              {statusConfig(project.status).label}
            </Badge>
            <span className="text-micro text-gray-400">
              {project.timeframe_start ? formatDate(project.timeframe_start) : 'No start date'}
              {' to '}
              {project.timeframe_end ? formatDate(project.timeframe_end) : 'Open ended'}
            </span>
          </div>
          <h2 className="text-sub-heading font-semibold text-gray-900">Project performance report</h2>
          <p className="mt-1 text-caption text-gray-500">
            Material recovery, financial outcome, workflow progress, and environmental impact.
          </p>
        </div>
        <button type="button" onClick={exportReport} className="btn-primary shrink-0">
          <FileText className="h-4 w-4" />
          Export CSV
        </button>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map(({ label, value, detail, icon: Icon, tone }) => (
          <section key={label} className="rounded-apple-lg border border-gray-100 bg-white p-4">
            <div className="mb-4 flex items-start justify-between gap-3">
              <p className="text-micro font-semibold uppercase tracking-wider text-gray-500">{label}</p>
              <span className={'flex h-9 w-9 shrink-0 items-center justify-center rounded-apple ' + tone}>
                <Icon className="h-4 w-4" />
              </span>
            </div>
            <p className="font-display text-xl font-semibold text-gray-900">{value}</p>
            <p className="mt-1 min-h-8 text-micro leading-relaxed text-gray-400">{detail}</p>
          </section>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-apple-lg border border-deep-teal/10 bg-deep-teal/[0.04] px-5 py-3 text-micro">
        <span className="font-semibold text-deep-teal">{transactionCount} linked transactions</span>
        <span className="text-gray-500">{completedStages} of {bundle.stages.length} workflow stages complete</span>
        <span className="text-gray-500">{bundle.evidence.length} evidence files</span>
        <span className="text-gray-500">{bundle.logistics.length} logistics records</span>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <ReportChart
          title="Assets by lifecycle stage"
          subtitle="Units currently assigned to each project stage"
          empty={stageData.length === 0}
        >
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stageData} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
                <CartesianGrid stroke="#eef2f1" strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" width={112} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={REPORT_TOOLTIP_STYLE} cursor={{ fill: '#f0fdfa' }} />
                <Bar dataKey="units" name="Units" fill={REPORT_COLORS[0]} radius={[0, 5, 5, 0]} maxBarSize={24} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ReportChart>

        <ReportChart
          title="Condition mix"
          subtitle="Physical condition across all project assets"
          empty={conditionData.length === 0}
        >
          <div className="grid min-h-[280px] grid-cols-[minmax(0,1fr)_150px] items-center gap-2">
            <div className="h-[260px] min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={conditionData} dataKey="value" nameKey="name" innerRadius={62} outerRadius={94} paddingAngle={3} stroke="none">
                    {conditionData.map((entry, index) => <Cell key={entry.name} fill={REPORT_COLORS[index % REPORT_COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={REPORT_TOOLTIP_STYLE} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-2">
              {conditionData.map((entry, index) => (
                <div key={entry.name} className="flex items-center justify-between gap-3 text-micro">
                  <span className="flex min-w-0 items-center gap-2 text-gray-500">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: REPORT_COLORS[index % REPORT_COLORS.length] }} />
                    <span className="truncate">{entry.name}</span>
                  </span>
                  <span className="font-semibold text-gray-900">{formatNumber(entry.value)}</span>
                </div>
              ))}
            </div>
          </div>
        </ReportChart>

        <ReportChart
          title="Financial composition"
          subtitle="Revenue, circularity credits, and project costs"
          empty={financialTotals.rows.length === 0}
        >
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={financialData} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
                <CartesianGrid stroke="#eef2f1" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(value) => Number(value).toLocaleString()} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} width={72} />
                <Tooltip formatter={(value) => formatCurrency(Number(value || 0), currency)} contentStyle={REPORT_TOOLTIP_STYLE} cursor={{ fill: '#f8fafc' }} />
                <Bar dataKey="value" name="Amount" radius={[5, 5, 0, 0]} maxBarSize={52}>
                  {financialData.map((entry) => <Cell key={entry.name} fill={entry.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ReportChart>

        <ReportChart
          title="Workflow completion"
          subtitle="Task completion within each configured stage"
          empty={workflowData.length === 0}
        >
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={workflowData} layout="vertical" margin={{ top: 4, right: 20, left: 4, bottom: 4 }}>
                <CartesianGrid stroke="#eef2f1" strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" domain={[0, 100]} tickFormatter={(value) => value + '%'} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(value) => Number(value || 0) + '%'} contentStyle={REPORT_TOOLTIP_STYLE} cursor={{ fill: '#f0fdfa' }} />
                <Bar dataKey="progress" name="Complete" fill={REPORT_COLORS[1]} radius={[0, 5, 5, 0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ReportChart>

        <ReportChart
          title="Impact by equipment category"
          subtitle="Avoided emissions and recoverable value for the largest material groups"
          empty={impactData.length === 0}
          className="xl:col-span-2"
        >
          <div className="mb-3 flex flex-wrap gap-4 text-micro text-gray-500">
            <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm bg-verified-green" />Avoided kg CO2e</span>
            <span className="flex items-center gap-2"><span className="h-0.5 w-4 bg-deep-teal" />Reuse value ({currency})</span>
          </div>
          <div className="h-[320px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={impactData} margin={{ top: 8, right: 12, left: 4, bottom: 8 }}>
                <CartesianGrid stroke="#eef2f1" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} interval={0} />
                <YAxis yAxisId="carbon" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} width={64} />
                <YAxis yAxisId="value" orientation="right" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} width={72} />
                <Tooltip
                  formatter={(value, name) => name === 'Reuse value' ? formatCurrency(Number(value || 0), currency) : formatNumber(Number(value || 0)) + ' kg'}
                  contentStyle={REPORT_TOOLTIP_STYLE}
                />
                <Bar yAxisId="carbon" dataKey="avoided" name="Avoided CO2e" fill={REPORT_COLORS[1]} radius={[5, 5, 0, 0]} maxBarSize={48} />
                <Line yAxisId="value" type="monotone" dataKey="reuse" name="Reuse value" stroke={REPORT_COLORS[0]} strokeWidth={2.5} dot={{ r: 3, fill: REPORT_COLORS[0] }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </ReportChart>
      </div>
    </div>
  );
}
function MembersTab({ members, project }: { members: ProjectMember[]; project: Project }) {
  return (
    <div className="space-y-4">
      <SectionHeader title="Members" subtitle="Tenant users with project workspace visibility" />
      <DataTable emptyIcon={Users} emptyText="No members found" headers={['Name', 'Email', 'Role', 'Tenant', 'Access']}>
        {members.map((member) => (
          <tr key={member.id} className="hover:bg-gray-50">
            <td className="px-4 py-3 font-medium text-gray-900">{member.name}</td>
            <td className="px-4 py-3 text-gray-500">{member.email}</td>
            <td className="px-4 py-3"><Badge className="border-signal-teal/20 bg-signal-teal/10 text-signal-teal">{member.role}</Badge></td>
            <td className="px-4 py-3 text-gray-500">{member.tenant_name || project.tenant_name || '-'}</td>
            <td className="px-4 py-3 text-gray-500">{isTruthy(member.is_owner) ? 'Owner' : 'Tenant member'}</td>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}

function SectionHeader({ title, subtitle, action }: { title: string; subtitle: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="text-sub-heading font-semibold text-gray-900">{title}</h2>
        <p className="text-caption text-gray-500">{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

function DataTable({
  headers,
  children,
  emptyIcon: EmptyIcon,
  emptyText,
}: {
  headers: string[];
  children: ReactNode;
  emptyIcon: LucideIcon;
  emptyText: string;
}) {
  const hasRows = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <div className="overflow-hidden rounded-apple-lg border border-gray-100 bg-white">
      {!hasRows ? (
        <div className="py-14 text-center">
          <EmptyIcon className="mx-auto mb-3 h-10 w-10 text-gray-300" />
          <p className="text-caption text-gray-500">{emptyText}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-100 text-sm">
            <thead className="bg-gray-50">
              <tr>
                {headers.map((header) => (
                  <th key={header} className="px-4 py-3 text-left text-micro font-semibold uppercase tracking-wider text-gray-500">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">{children}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SimpleModal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-apple-lg bg-white shadow-apple" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-apple p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

function ModalActions({ saving, onClose }: { saving: boolean; onClose: () => void }) {
  return (
    <div className="flex justify-end gap-3 border-t border-gray-100 pt-4">
      <button type="button" onClick={onClose} className="btn-secondary" disabled={saving}>Cancel</button>
      <button type="submit" className="btn-primary" disabled={saving}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        Save
      </button>
    </div>
  );
}

function StageSelect({ value, stages, onChange }: { value: string; stages: WorkflowStage[]; onChange: (value: string) => void }) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)} className={inputClass()}>
      <option value="">No stage</option>
      {stages.map((stage) => <option key={stage.id} value={stage.stage}>{stage.label}</option>)}
    </select>
  );
}

function DeleteButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="rounded p-1.5 text-gray-400 hover:bg-gray-50 hover:text-gray-600">
      <Trash2 className="h-4 w-4" />
    </button>
  );
}
