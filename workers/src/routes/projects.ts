/**
 * Projects routes - Cirtell project workspace.
 * Tenant/company scoped, with list/detail tabs for workflow, materials,
 * logistics, financials, evidence, comments, reports, and members.
 */

import { Hono, type Context } from 'hono';
import type { Env } from '../index';
import { authMiddleware, logAudit, type User } from '../middleware/auth';
import { Permission, requirePermission } from '../middleware/permissions';
import { appendScopeCondition, resolveTenantScope, scopedWhere, type TenantScope } from '../middleware/tenantScope';
import {
  buildProjectTransactionProjection,
  type ProjectedEquipment,
  type ProjectedFinancial,
  type ProjectProjectionScope,
  type ProjectTransactionProjection,
} from '../services/projectTransactionProjection';

type Variables = { user: User };
type SQLValue = string | number | null;
type IncomingBody = Record<string, unknown>;
type ProjectContext = Context<{ Bindings: Env; Variables: Variables }>;

interface ProjectScopeRow {
  id: string;
  tenant_id: string | null;
  company_id: string | null;
  status?: string | null;
  currency?: string | null;
}

interface ProjectDetailRow extends ProjectScopeRow {
  name: string;
}

interface CountRow {
  count: number;
}

interface ProjectEquipmentKpiRow {
  id: string;
  part_id: string | null;
  serial_number: string | null;
  condition: string;
  quantity: number;
  current_stage: string;
  estimated_reuse_value: number | null;
  co2_avoided_kg: number | null;
}

interface ProjectFinancialKpiRow {
  id: string;
  type: 'cost' | 'revenue' | 'credit';
  category: string;
  amount: number;
  currency: string;
  stage: string | null;
  incurred_at: string | null;
  created_at: string | null;
}
interface ProjectListRow {
  id: string;
  tenant_id: string | null;
  company_id: string | null;
  equipment_count: number;
  co2_avoided_kg: number;
  reuse_value: number;
  transaction_count: number;
}

interface ReconciledProjectProjection extends ProjectTransactionProjection {
  matchedEquipmentProjectionIds: string[];
  matchedFinancialTransactionIds: string[];
}

interface EvidenceRow {
  id: string;
  project_id: string;
  r2_key?: string | null;
  file_name?: string | null;
  content_type?: string | null;
  file_size?: number | null;
  file_url?: string | null;
}

interface CatalogPartRow {
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

function projectionToken(value?: string | null) {
  return (value || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
}

function matchesProjectedEquipment(manual: ProjectEquipmentKpiRow, projected: ProjectedEquipment) {
  if (!manual.part_id || manual.part_id !== projected.partId) return false;
  if (Number(manual.quantity) !== Number(projected.quantity)) return false;
  if (projectionToken(manual.condition) !== projectionToken(projected.condition)) return false;
  if (projectionToken(manual.current_stage) !== projectionToken(projected.currentStage)) return false;

  const manualSerial = projectionToken(manual.serial_number);
  const projectedSerial = projectionToken(projected.serialNumber);
  return !manualSerial || !projectedSerial || manualSerial === projectedSerial;
}

function matchesProjectedFinancial(manual: ProjectFinancialKpiRow, projected: ProjectedFinancial) {
  return manual.type === projected.type
    && Number(manual.amount) === Number(projected.amount)
    && projectionToken(manual.currency) === projectionToken(projected.currency)
    && projectionToken(manual.category) === projectionToken(projected.category)
    && projectionToken(manual.stage) === projectionToken(projected.stage)
    && (manual.incurred_at || manual.created_at || '').slice(0, 10) === projected.incurredAt.slice(0, 10);
}

function reconcileProjectProjection(
  equipment: ProjectEquipmentKpiRow[],
  financials: ProjectFinancialKpiRow[],
  projection: ProjectTransactionProjection,
) {
  const matchedEquipmentProjectionIds = projection.projectedEquipment
    .filter((projected) => equipment.some((manual) => matchesProjectedEquipment(manual, projected)))
    .map((projected) => projected.id);
  const matchedFinancialTransactionIds = projection.projectedFinancials
    .filter((projected) => financials.some((manual) => matchesProjectedFinancial(manual, projected)))
    .map((projected) => projected.transactionId);

  const visibleManualEquipment = equipment.filter(
    (manual) => !projection.projectedEquipment.some((projected) => matchesProjectedEquipment(manual, projected)),
  );
  const visibleManualFinancials = financials.filter(
    (manual) => !projection.projectedFinancials.some((projected) => matchesProjectedFinancial(manual, projected)),
  );

  const equipmentCount = [...projection.projectedEquipment, ...visibleManualEquipment]
    .reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const co2Avoided = projection.transactionSummary.projectedCo2AvoidedKg
    + visibleManualEquipment.reduce((sum, item) => sum + Number(item.co2_avoided_kg || 0), 0);
  const reuseValue = projection.transactionSummary.redeploymentCredit
    + visibleManualEquipment
      .filter((item) => projectionToken(item.current_stage) === 'redeployment')
      .reduce((sum, item) => sum + Number(item.estimated_reuse_value || 0), 0);
  const transactionRevenueCredits = projection.transactionSummary.salesRevenue
    + projection.transactionSummary.redeploymentCredit
    + projection.transactionSummary.recyclingRevenue;
  const manualRevenueCredits = visibleManualFinancials
    .filter((item) => item.type !== 'cost')
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const costs = projection.transactionSummary.purchaseCost
    + visibleManualFinancials
      .filter((item) => item.type === 'cost')
      .reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const revenueCredits = transactionRevenueCredits + manualRevenueCredits;

  const transactionProjection: ReconciledProjectProjection = {
    ...projection,
    matchedEquipmentProjectionIds,
    matchedFinancialTransactionIds,
  };

  return {
    transactionProjection,
    kpis: {
      equipment_count: equipmentCount,
      co2_avoided_kg: co2Avoided,
      reuse_value: reuseValue,
      revenue_credits: revenueCredits,
      costs,
      net_financial: revenueCredits - costs,
    },
  };
}
class ProjectValidationError extends Error {
  constructor(
    message: string,
    readonly code = 'INVALID_PROJECT_REFERENCE',
    readonly status = 400,
  ) {
    super(message);
    this.name = 'ProjectValidationError';
  }
}

type ImportedEquipmentRow = Record<string, unknown> & {
  part_id?: unknown;
  partId?: unknown;
  part_number?: unknown;
  partNumber?: unknown;
  item_name?: unknown;
  itemName?: unknown;
  asset_tag?: unknown;
  assetTag?: unknown;
  serial_number?: unknown;
  serialNumber?: unknown;
  vendor?: unknown;
  category?: unknown;
  quantity?: unknown;
  condition?: unknown;
  current_stage?: unknown;
  currentStage?: unknown;
  stage?: unknown;
  weight_kg?: unknown;
  weightKg?: unknown;
  estimated_reuse_value?: unknown;
  estimatedReuseValue?: unknown;
  reuse_value?: unknown;
  reuseValue?: unknown;
  co2_avoided_kg?: unknown;
  co2AvoidedKg?: unknown;
  notes?: unknown;
};

interface EquipmentImportIssue {
  row: number;
  part_number?: string;
  error: string;
}

const validStatuses = ['draft', 'assessment', 'in-progress', 'on-hold', 'completed', 'cancelled'];
const validLocationTypes = ['on_site', 'local_warehouse', 'regional_warehouse'];
const validStageStatuses = ['not_started', 'in_progress', 'completed', 'blocked'];
const maxEvidenceFileBytes = 25 * 1024 * 1024;
const allowedEvidenceTypes = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/csv',
  'text/plain',
]);

const workflowStages = [
  ['assessment', 'Assessment'],
  ['dismantling', 'Dismantling'],
  ['transportation', 'Transportation'],
  ['labelling', 'Labelling'],
  ['trading', 'Trading'],
  ['esg_reporting', 'ESG Reporting'],
] as const;

const projectUpdateFields = [
  'name',
  'description',
  'internal_reference',
  'operator',
  'region',
  'country',
  'site_name',
  'site_id',
  'location_address',
  'timeframe_start',
  'timeframe_end',
  'currency',
  'esg_methodology_version',
  'compliance_regime',
  'compliance_notes',
  'status',
  'budget_total',
] as const;

export const projectRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

projectRoutes.use('*', authMiddleware);
projectRoutes.use('*', requirePermission(Permission.VIEW_PROJECTS));
projectRoutes.use('*', async (c, next) => {
  if (c.req.method === 'GET') return next();
  if (c.req.method === 'POST' && /\/projects\/[^/]+\/comments$/.test(c.req.path)) return next();
  return requirePermission(Permission.MANAGE_PROJECTS)(c, next);
});

function normalizeText(value: unknown, maxLength = 500): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, maxLength) : null;
}

function fileField(value: unknown): File | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate instanceof File && candidate.size > 0 ? candidate : null;
}

function textField(value: unknown, maxLength = 500): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return typeof candidate === 'string' ? normalizeText(candidate, maxLength) : null;
}

function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() || 'evidence-file';
  return base.replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, '_').slice(0, 180) || 'evidence-file';
}

function contentDispositionFileName(name: string): string {
  return safeFileName(name).replace(/"/g, '');
}

function evidenceDownloadPath(projectId: string, entryId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/evidence/${encodeURIComponent(entryId)}/download`;
}

function evidenceR2Key(project: ProjectScopeRow, projectId: string, entryId: string, fileName: string): string {
  const tenant = project.tenant_id || 'platform';
  return [
    'project-evidence',
    tenant,
    projectId,
    `${entryId}-${safeFileName(fileName)}`,
  ].join('/');
}

function validateEvidenceFile(file: File): string | null {
  if (file.size > maxEvidenceFileBytes) return 'Evidence file must be 25 MB or smaller';
  if (!allowedEvidenceTypes.has(file.type)) {
    return 'Unsupported evidence file type. Upload PDF, image, text, CSV, Word, Excel, or PowerPoint files.';
  }
  return null;
}

function parseNumber(value: unknown, fallback: number | null = null): number | null {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parsePositiveInteger(value: unknown, fallback = 1): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBooleanFlag(value: unknown, fallback = 0): number {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return value === 1 ? 1 : 0;
  const normalized = String(value).trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized) ? 1 : 0;
}

function normalizeStatus(value: unknown, fallback = 'draft'): string {
  const status = normalizeText(value, 40);
  return status && validStatuses.includes(status) ? status : fallback;
}

function normalizeLocationType(value: unknown): string {
  const locationType = normalizeText(value, 40)?.replace(/[\s-]+/g, '_') || 'on_site';
  return validLocationTypes.includes(locationType) ? locationType : 'on_site';
}

function normalizeStageStatus(value: unknown): string {
  const status = normalizeText(value, 40);
  return status && validStageStatuses.includes(status) ? status : 'not_started';
}

function idArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeText(item, 160))
    .filter((item): item is string => Boolean(item));
}

function ownershipFromProject(project: ProjectScopeRow, user: User): { tenantId: string | null; companyId: string | null } {
  return {
    tenantId: project.tenant_id || user.tenant_id || null,
    companyId: project.company_id || user.company_id || null,
  };
}

function ownershipFromScope(scope: TenantScope, user: User): { tenantId: string | null; companyId: string | null } {
  return {
    tenantId: scope.tenantId || user.tenant_id || null,
    companyId: scope.companyId || user.company_id || null,
  };
}

function scopeFromOwnership(owner: { tenantId: string | null; companyId: string | null }): TenantScope {
  return {
    tenantId: owner.tenantId,
    companyId: owner.companyId,
    isSuperAdmin: false,
    isCrossTenant: !owner.tenantId && !owner.companyId,
  };
}

async function findCatalogPartForProject(
  db: D1Database,
  partId: string | null,
  owner: { tenantId: string | null; companyId: string | null },
): Promise<CatalogPartRow | null> {
  if (!partId) return null;

  const scopeWhere = scopedWhere(scopeFromOwnership(owner), 'p.tenant_id', 'p.company_id');
  return db.prepare(`
    SELECT
      p.id, p.part_number, p.manufacturer_part_number, p.model_name,
      COALESCE(v.vendor_name, p.vendor_id) AS vendor,
      p.technology_type, p.weight_kg, p.emission_factor_kg,
      p.category, p.subcategory, p.description
    FROM parts p
    LEFT JOIN vendors v ON v.id = p.vendor_id
    WHERE p.id = ? AND ${scopeWhere.clause}
  `).bind(partId, ...scopeWhere.params).first<CatalogPartRow>();
}

async function findCatalogPartByNumberForProject(
  db: D1Database,
  partNumber: string | null,
  owner: { tenantId: string | null; companyId: string | null },
): Promise<CatalogPartRow | null> {
  if (!partNumber) return null;

  const scopeWhere = scopedWhere(scopeFromOwnership(owner), 'p.tenant_id', 'p.company_id');
  return db.prepare(`
    SELECT
      p.id, p.part_number, p.manufacturer_part_number, p.model_name,
      COALESCE(v.vendor_name, p.vendor_id) AS vendor,
      p.technology_type, p.weight_kg, p.emission_factor_kg,
      p.category, p.subcategory, p.description
    FROM parts p
    LEFT JOIN vendors v ON v.id = p.vendor_id
    WHERE LOWER(p.part_number) = LOWER(?) AND ${scopeWhere.clause}
  `).bind(partNumber, ...scopeWhere.params).first<CatalogPartRow>();
}

function lookupScope(scope: TenantScope): { clause: string; params: SQLValue[] } {
  if (scope.companyId) {
    return {
      clause: '(company_id IS NULL OR company_id = ? OR tenant_id = ?)',
      params: [scope.companyId, scope.tenantId],
    };
  }
  if (scope.tenantId) {
    return { clause: '(tenant_id IS NULL OR tenant_id = ?)', params: [scope.tenantId] };
  }
  return { clause: '1=1', params: [] };
}

async function validateProjectWarehouse(
  db: D1Database,
  value: unknown,
  owner: { tenantId: string | null; companyId: string | null },
): Promise<string | null> {
  const id = normalizeText(value, 160);
  if (!id) return null;

  const scopeWhere = scopedWhere(scopeFromOwnership(owner), 'tenant_id', 'company_id');
  const row = await db.prepare(`SELECT id FROM warehouses WHERE id = ? AND ${scopeWhere.clause}`)
    .bind(id, ...scopeWhere.params)
    .first<{ id: string }>();
  if (!row) throw new ProjectValidationError('Source warehouse not found in current scope', 'WAREHOUSE_NOT_FOUND', 400);
  return id;
}

async function validateProjectLookupIds(
  db: D1Database,
  table: 'telecom_vendors' | 'telecom_technologies',
  ids: string[],
  label: 'Vendor' | 'Technology',
  owner: { tenantId: string | null; companyId: string | null },
): Promise<string[]> {
  if (ids.length === 0) return [];

  const lookup = lookupScope(scopeFromOwnership(owner));
  for (const id of ids) {
    const row = await db.prepare(`SELECT id FROM ${table} WHERE id = ? AND ${lookup.clause}`)
      .bind(id, ...lookup.params)
      .first<{ id: string }>();
    if (!row) {
      throw new ProjectValidationError(`${label} not found in current scope`, `${label.toUpperCase()}_NOT_FOUND`, 400);
    }
  }
  return ids;
}

async function getProject(c: ProjectContext, projectId: string) {
  const scope = await resolveTenantScope(c);
  const where = scopedWhere(scope, 'p.tenant_id', 'p.company_id');
  const project = await c.env.DB.prepare(`
    SELECT p.*, u.name AS created_by_name, co.name AS company_name, t.name AS tenant_name
    FROM projects p
    LEFT JOIN users u ON u.id = p.created_by
    LEFT JOIN companies co ON co.id = p.company_id
    LEFT JOIN tenants t ON t.id = p.tenant_id
    WHERE p.id = ? AND ${where.clause}
  `).bind(projectId, ...where.params).first<ProjectDetailRow & Record<string, unknown>>();
  return { project: project || null, scope };
}

async function ensureWorkflowStages(db: D1Database, projectId: string): Promise<void> {
  const existing = await db.prepare('SELECT COUNT(*) AS count FROM project_workflow_stages WHERE project_id = ?')
    .bind(projectId)
    .first<CountRow>();
  if ((existing?.count || 0) > 0) return;

  await db.batch(workflowStages.map(([stage, label], index) => db.prepare(`
    INSERT INTO project_workflow_stages (id, project_id, stage, label, status, sort_order)
    VALUES (?, ?, ?, ?, 'not_started', ?)
  `).bind(crypto.randomUUID(), projectId, stage, label, index + 1)));
}

async function insertActivity(
  db: D1Database,
  projectId: string,
  user: User,
  action: string,
  entityType = 'project',
  entityId: string | null = null,
  details: string | null = null,
) {
  await db.prepare(`
    INSERT INTO project_activity (id, project_id, user_id, user_name, action, entity_type, entity_id, details)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(crypto.randomUUID(), projectId, user.id, user.name, action, entityType, entityId || projectId, details).run();
}

async function replaceProjectLinks(db: D1Database, projectId: string, table: string, column: string, values: string[]) {
  await db.prepare(`DELETE FROM ${table} WHERE project_id = ?`).bind(projectId).run();
  for (const value of values) {
    await db.prepare(`INSERT OR IGNORE INTO ${table} (project_id, ${column}) VALUES (?, ?)`)
      .bind(projectId, value)
      .run();
  }
}

async function readProjectBundle(
  db: D1Database,
  projectId: string,
  projectionScope: ProjectProjectionScope,
) {
  const [
    vendors,
    technologies,
    stages,
    tasks,
    equipment,
    financials,
    logistics,
    evidence,
    comments,
    recentActivity,
  ] = await Promise.all([
    db.prepare(`
      SELECT tv.*
      FROM project_vendors pv
      JOIN telecom_vendors tv ON tv.id = pv.vendor_id
      WHERE pv.project_id = ?
      ORDER BY tv.name
    `).bind(projectId).all(),
    db.prepare(`
      SELECT tt.*
      FROM project_technologies pt
      JOIN telecom_technologies tt ON tt.id = pt.technology_id
      WHERE pt.project_id = ?
      ORDER BY tt.name
    `).bind(projectId).all(),
    db.prepare('SELECT * FROM project_workflow_stages WHERE project_id = ? ORDER BY sort_order, label')
      .bind(projectId)
      .all(),
    db.prepare('SELECT * FROM project_workflow_tasks WHERE project_id = ? ORDER BY due_date IS NULL, due_date, created_at')
      .bind(projectId)
      .all(),
    db.prepare(`
      SELECT
        pe.*,
        p.part_number,
        p.manufacturer_part_number,
        p.model_name AS catalog_model_name,
        p.technology_type AS catalog_technology_type,
        p.weight_kg AS catalog_weight_kg,
        p.emission_factor_kg AS catalog_emission_factor_kg,
        p.description AS catalog_description
      FROM project_equipment pe
      LEFT JOIN parts p ON p.id = pe.part_id
      WHERE pe.project_id = ?
      ORDER BY pe.created_at DESC
    `).bind(projectId).all(),
    db.prepare('SELECT * FROM project_financials WHERE project_id = ? ORDER BY created_at DESC')
      .bind(projectId)
      .all(),
    db.prepare('SELECT * FROM project_logistics WHERE project_id = ? ORDER BY scheduled_date IS NULL, scheduled_date DESC, created_at DESC')
      .bind(projectId)
      .all(),
    db.prepare(`
      SELECT pe.*, u.name AS uploaded_by_name
      FROM project_evidence pe
      LEFT JOIN users u ON u.id = pe.uploaded_by
      WHERE pe.project_id = ?
      ORDER BY pe.uploaded_at DESC
    `).bind(projectId).all(),
    db.prepare(`
      SELECT pc.*, u.name AS user_name, u.email AS user_email
      FROM project_comments pc
      LEFT JOIN users u ON u.id = pc.user_id
      WHERE pc.project_id = ?
      ORDER BY pc.created_at DESC
    `).bind(projectId).all(),
    db.prepare('SELECT * FROM project_activity WHERE project_id = ? ORDER BY created_at DESC LIMIT 20')
      .bind(projectId)
      .all(),
  ]);

  const transactionProjection = await buildProjectTransactionProjection({
    db,
    projectId,
    scope: projectionScope,
  });

  const reconciled = reconcileProjectProjection(
    (equipment.results || []) as unknown as ProjectEquipmentKpiRow[],
    (financials.results || []) as unknown as ProjectFinancialKpiRow[],
    transactionProjection,
  );
  return {
    vendors: vendors.results || [],
    technologies: technologies.results || [],
    stages: stages.results || [],
    tasks: tasks.results || [],
    equipment: equipment.results || [],
    financials: financials.results || [],
    logistics: logistics.results || [],
    evidence: evidence.results || [],
    comments: comments.results || [],
    recentActivity: recentActivity.results || [],
    transactionProjection: reconciled.transactionProjection,
    kpis: reconciled.kpis,
  };
}

// ============================================================================
// Lookups
// ============================================================================
projectRoutes.get('/lookups/vendors', async (c) => {
  const scope = await resolveTenantScope(c);
  const lookup = lookupScope(scope);
  const { results } = await c.env.DB.prepare(`
    SELECT id, name, category, region, is_active
    FROM telecom_vendors
    WHERE COALESCE(is_active, 1) = 1 AND ${lookup.clause}
    ORDER BY name
  `).bind(...lookup.params).all();
  return c.json({ success: true, vendors: results || [] });
});

projectRoutes.get('/lookups/technologies', async (c) => {
  const scope = await resolveTenantScope(c);
  const lookup = lookupScope(scope);
  const { results } = await c.env.DB.prepare(`
    SELECT id, name, generation, description, is_active
    FROM telecom_technologies
    WHERE COALESCE(is_active, 1) = 1 AND ${lookup.clause}
    ORDER BY name
  `).bind(...lookup.params).all();
  return c.json({ success: true, technologies: results || [] });
});

// ============================================================================
// Project list and CRUD
// ============================================================================
projectRoutes.get('/', async (c) => {
  try {
    const scope = await resolveTenantScope(c);
    const search = c.req.query('search')?.trim();
    const status = c.req.query('status')?.trim();
    const params: SQLValue[] = [];
    const conditions: string[] = [];
    appendScopeCondition(conditions, params, scope, 'p.tenant_id', 'p.company_id');

    if (status) {
      conditions.push('p.status = ?');
      params.push(status);
    }
    if (search) {
      conditions.push(`(
        p.name LIKE ? OR p.operator LIKE ? OR p.region LIKE ? OR p.country LIKE ?
        OR p.site_name LIKE ? OR p.internal_reference LIKE ?
      )`);
      const term = `%${search}%`;
      params.push(term, term, term, term, term, term);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;
    const { results } = await c.env.DB.prepare(`
      SELECT p.*,
        u.name AS created_by_name,
        co.name AS company_name,
        t.name AS tenant_name,
        COALESCE(eq.equipment_count, 0) AS equipment_count,
        COALESCE(eq.co2_avoided_kg, 0) AS co2_avoided_kg,
        COALESCE(eq.reuse_value, 0) AS reuse_value,
        COALESCE(tx.transaction_count, 0) AS transaction_count,
        pv.vendor_names,
        pt.technology_names
      FROM projects p
      LEFT JOIN users u ON u.id = p.created_by
      LEFT JOIN companies co ON co.id = p.company_id
      LEFT JOIN tenants t ON t.id = p.tenant_id
      LEFT JOIN (
        SELECT project_id,
          SUM(quantity) AS equipment_count,
          SUM(co2_avoided_kg) AS co2_avoided_kg,
          SUM(estimated_reuse_value) AS reuse_value
        FROM project_equipment
        GROUP BY project_id
      ) eq ON eq.project_id = p.id
      LEFT JOIN (
        SELECT project_id, COUNT(*) AS transaction_count
        FROM transactions
        WHERE project_id IS NOT NULL AND voided_at IS NULL
        GROUP BY project_id
      ) tx ON tx.project_id = p.id
      LEFT JOIN (
        SELECT pvn.project_id, GROUP_CONCAT(tv.name, ', ') AS vendor_names
        FROM project_vendors pvn
        JOIN telecom_vendors tv ON tv.id = pvn.vendor_id
        GROUP BY pvn.project_id
      ) pv ON pv.project_id = p.id
      LEFT JOIN (
        SELECT ptn.project_id, GROUP_CONCAT(tt.name, ', ') AS technology_names
        FROM project_technologies ptn
        JOIN telecom_technologies tt ON tt.id = ptn.technology_id
        GROUP BY ptn.project_id
      ) pt ON pt.project_id = p.id
      ${whereClause}
      ORDER BY p.updated_at DESC
      LIMIT 500
    `).bind(...params).all();

    const projects = (results || []) as unknown as ProjectListRow[];
    const reconciledProjects = await Promise.all(projects.map(async (project) => {
      if (Number(project.transaction_count || 0) === 0) return project;

      const [equipment, projection] = await Promise.all([
        c.env.DB.prepare(`
          SELECT id, part_id, serial_number, condition, quantity, current_stage,
                 estimated_reuse_value, co2_avoided_kg
          FROM project_equipment
          WHERE project_id = ?
        `).bind(project.id).all<ProjectEquipmentKpiRow>(),
        buildProjectTransactionProjection({
          db: c.env.DB,
          projectId: project.id,
          scope: {
            tenantId: project.tenant_id,
            companyId: project.company_id,
          },
        }),
      ]);
      const reconciled = reconcileProjectProjection(
        equipment.results || [],
        [],
        projection,
      );

      return {
        ...project,
        equipment_count: reconciled.kpis.equipment_count,
        co2_avoided_kg: reconciled.kpis.co2_avoided_kg,
        reuse_value: reconciled.kpis.reuse_value,
      };
    }));

    return c.json({ success: true, projects: reconciledProjects, items: reconciledProjects });
  } catch (err) {
    console.error('GET /projects error:', err);
    return c.json({ success: false, error: 'Failed to fetch projects' }, 500);
  }
});

projectRoutes.post('/', async (c) => {
  try {
    const user = c.get('user');
    const scope = await resolveTenantScope(c);
    const body = await c.req.json<IncomingBody>();
    const name = normalizeText(body.name, 200);
    if (!name) return c.json({ success: false, error: 'Project name is required' }, 400);

    const tenantId = scope.tenantId || user.tenant_id || null;
    const companyId = scope.companyId || user.company_id || null;
    const ownership = ownershipFromScope(scope, user);
    const locationType = normalizeLocationType(body.location_type);
    const sourceWarehouseId = locationType === 'on_site'
      ? null
      : await validateProjectWarehouse(c.env.DB, body.source_warehouse_id, ownership);
    const vendorIds = await validateProjectLookupIds(
      c.env.DB,
      'telecom_vendors',
      idArray(body.vendor_ids),
      'Vendor',
      ownership,
    );
    const technologyIds = await validateProjectLookupIds(
      c.env.DB,
      'telecom_technologies',
      idArray(body.technology_ids),
      'Technology',
      ownership,
    );
    const projectId = crypto.randomUUID();
    const now = new Date().toISOString();

    await c.env.DB.batch([
      c.env.DB.prepare(`
        INSERT INTO projects (
          id, tenant_id, company_id, name, description, internal_reference, operator, region, country,
          site_name, site_id, location_type, source_warehouse_id, location_address, requires_dismantling,
          timeframe_start, timeframe_end, currency, esg_methodology_version, compliance_regime,
          contains_sensitive_data, contains_restricted_goods, compliance_notes, status, budget_total,
          created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        projectId,
        tenantId,
        companyId,
        name,
        normalizeText(body.description, 4000),
        normalizeText(body.internal_reference, 120),
        normalizeText(body.operator, 200),
        normalizeText(body.region, 120),
        normalizeText(body.country, 120),
        normalizeText(body.site_name, 200),
        normalizeText(body.site_id, 120),
        locationType,
        sourceWarehouseId,
        normalizeText(body.location_address, 500),
        locationType === 'on_site' ? parseBooleanFlag(body.requires_dismantling, 1) : 0,
        normalizeText(body.timeframe_start, 32),
        normalizeText(body.timeframe_end, 32),
        normalizeText(body.currency, 12) || 'USD',
        normalizeText(body.esg_methodology_version, 120),
        normalizeText(body.compliance_regime, 120),
        parseBooleanFlag(body.contains_sensitive_data),
        parseBooleanFlag(body.contains_restricted_goods),
        normalizeText(body.compliance_notes, 2000),
        normalizeStatus(body.status),
        parseNumber(body.budget_total, 0),
        user.id,
        now,
        now,
      ),
      ...workflowStages.map(([stage, label], index) => c.env.DB.prepare(`
        INSERT INTO project_workflow_stages (id, project_id, stage, label, status, sort_order)
        VALUES (?, ?, ?, ?, 'not_started', ?)
      `).bind(crypto.randomUUID(), projectId, stage, label, index + 1)),
      c.env.DB.prepare(`
        INSERT INTO project_activity (id, project_id, user_id, user_name, action, entity_type, entity_id)
        VALUES (?, ?, ?, ?, 'created', 'project', ?)
      `).bind(crypto.randomUUID(), projectId, user.id, user.name, projectId),
    ]);

    await replaceProjectLinks(c.env.DB, projectId, 'project_vendors', 'vendor_id', vendorIds);
    await replaceProjectLinks(c.env.DB, projectId, 'project_technologies', 'technology_id', technologyIds);
    await logAudit(c.env.DB, user.id, 'CREATE_PROJECT', 'projects', projectId, name);
    return c.json({ success: true, id: projectId }, 201);
  } catch (err) {
    if (err instanceof ProjectValidationError) {
      return c.json({ success: false, error: err.message, code: err.code }, err.status as 400);
    }
    console.error('POST /projects error:', err);
    return c.json({ success: false, error: 'Failed to create project' }, 500);
  }
});

projectRoutes.get('/:id', async (c) => {
  try {
    const projectId = c.req.param('id');
    const { project } = await getProject(c, projectId);
    if (!project) return c.json({ success: false, error: 'Project not found' }, 404);
    await ensureWorkflowStages(c.env.DB, projectId);
    const bundle = await readProjectBundle(c.env.DB, projectId, {
      tenantId: project.tenant_id,
      companyId: project.company_id,
    });
    return c.json({ success: true, project, ...bundle });
  } catch (err) {
    console.error('GET /projects/:id error:', err);
    return c.json({ success: false, error: 'Failed to fetch project' }, 500);
  }
});

projectRoutes.put('/:id', async (c) => {
  try {
    const user = c.get('user');
    const projectId = c.req.param('id');
    const { project, scope } = await getProject(c, projectId);
    if (!project) return c.json({ success: false, error: 'Project not found' }, 404);

    const body = await c.req.json<IncomingBody>();
    const ownership = ownershipFromProject(project, user);
    const vendorIds = Object.prototype.hasOwnProperty.call(body, 'vendor_ids')
      ? await validateProjectLookupIds(c.env.DB, 'telecom_vendors', idArray(body.vendor_ids), 'Vendor', ownership)
      : null;
    const technologyIds = Object.prototype.hasOwnProperty.call(body, 'technology_ids')
      ? await validateProjectLookupIds(c.env.DB, 'telecom_technologies', idArray(body.technology_ids), 'Technology', ownership)
      : null;
    const fields: string[] = [];
    const params: SQLValue[] = [];

    for (const field of projectUpdateFields) {
      if (Object.prototype.hasOwnProperty.call(body, field)) {
        if (field === 'status') {
          fields.push('status = ?');
          params.push(normalizeStatus(body[field], String(project.status || 'draft')));
        } else if (field === 'budget_total') {
          fields.push('budget_total = ?');
          params.push(parseNumber(body[field], 0));
        } else if (field === 'name') {
          const name = normalizeText(body[field], 200);
          if (!name) return c.json({ success: false, error: 'Project name is required' }, 400);
          fields.push('name = ?');
          params.push(name);
        } else {
          fields.push(`${field} = ?`);
          params.push(normalizeText(body[field], field === 'description' ? 4000 : 500));
        }
      }
    }

    if (Object.prototype.hasOwnProperty.call(body, 'location_type')) {
      fields.push('location_type = ?');
      params.push(normalizeLocationType(body.location_type));
    }
    if (Object.prototype.hasOwnProperty.call(body, 'source_warehouse_id')) {
      const sourceWarehouseId = await validateProjectWarehouse(c.env.DB, body.source_warehouse_id, ownership);
      fields.push('source_warehouse_id = ?');
      params.push(sourceWarehouseId);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'requires_dismantling')) {
      fields.push('requires_dismantling = ?');
      params.push(parseBooleanFlag(body.requires_dismantling, 1));
    }
    if (Object.prototype.hasOwnProperty.call(body, 'contains_sensitive_data')) {
      fields.push('contains_sensitive_data = ?');
      params.push(parseBooleanFlag(body.contains_sensitive_data));
    }
    if (Object.prototype.hasOwnProperty.call(body, 'contains_restricted_goods')) {
      fields.push('contains_restricted_goods = ?');
      params.push(parseBooleanFlag(body.contains_restricted_goods));
    }

    if (fields.length > 0) {
      fields.push('updated_at = ?');
      params.push(new Date().toISOString());
      const where = scopedWhere(scope, 'tenant_id', 'company_id');
      await c.env.DB.prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id = ? AND ${where.clause}`)
        .bind(...params, projectId, ...where.params)
        .run();
    }

    if (vendorIds) {
      await replaceProjectLinks(c.env.DB, projectId, 'project_vendors', 'vendor_id', vendorIds);
    }
    if (technologyIds) {
      await replaceProjectLinks(c.env.DB, projectId, 'project_technologies', 'technology_id', technologyIds);
    }

    await insertActivity(c.env.DB, projectId, user, 'updated');
    await logAudit(c.env.DB, user.id, 'UPDATE_PROJECT', 'projects', projectId);
    return c.json({ success: true });
  } catch (err) {
    if (err instanceof ProjectValidationError) {
      return c.json({ success: false, error: err.message, code: err.code }, err.status as 400);
    }
    console.error('PUT /projects/:id error:', err);
    return c.json({ success: false, error: 'Failed to update project' }, 500);
  }
});

projectRoutes.delete('/:id', async (c) => {
  try {
    const user = c.get('user');
    const projectId = c.req.param('id');
    const { project, scope } = await getProject(c, projectId);
    if (!project) return c.json({ success: true, deleted: false, already_deleted: true });
    const where = scopedWhere(scope, 'tenant_id', 'company_id');
    await c.env.DB.prepare(`DELETE FROM projects WHERE id = ? AND ${where.clause}`)
      .bind(projectId, ...where.params)
      .run();
    await c.env.DB.prepare('UPDATE transactions SET project_id = NULL WHERE project_id = ?').bind(projectId).run();
    await logAudit(c.env.DB, user.id, 'DELETE_PROJECT', 'projects', projectId);
    return c.json({ success: true, deleted: true });
  } catch (err) {
    console.error('DELETE /projects/:id error:', err);
    return c.json({ success: false, error: 'Failed to delete project' }, 500);
  }
});

// ============================================================================
// Materials & assets
// ============================================================================
projectRoutes.post('/:id/equipment/import', async (c) => {
  try {
    const user = c.get('user');
    const projectId = c.req.param('id');
    const { project } = await getProject(c, projectId);
    if (!project) return c.json({ success: false, error: 'Project not found' }, 404);

    const body = await c.req.json<{ equipment?: ImportedEquipmentRow[] }>();
    const rows = Array.isArray(body.equipment) ? body.equipment.slice(0, 1000) : [];
    if (rows.length === 0) return c.json({ success: false, error: 'No materials or assets were provided for import' }, 400);

    const owner = ownershipFromProject(project, user);
    const issues: EquipmentImportIssue[] = [];
    let created = 0;
    let linked = 0;
    let skipped = 0;

    for (const [index, row] of rows.entries()) {
      const rowNumber = index + 2;
      const explicitPartId = normalizeText(row.part_id ?? row.partId, 160);
      const partNumber = normalizeText(row.part_number ?? row.partNumber, 160);

      try {
        let catalogPart = await findCatalogPartForProject(c.env.DB, explicitPartId, owner);
        if (!catalogPart) {
          catalogPart = await findCatalogPartByNumberForProject(c.env.DB, partNumber, owner);
        }

        if ((explicitPartId || partNumber) && !catalogPart) {
          issues.push({
            row: rowNumber,
            part_number: partNumber || undefined,
            error: 'Catalog part was not found; imported without a catalog link',
          });
        }

        const quantity = parsePositiveInteger(row.quantity);
        const itemName = normalizeText(row.item_name ?? row.itemName, 200)
          || catalogPart?.model_name
          || catalogPart?.part_number
          || partNumber
          || null;

        if (!itemName) {
          skipped += 1;
          issues.push({ row: rowNumber, part_number: partNumber || undefined, error: 'Item Name or Part Number is required' });
          continue;
        }

        const id = crypto.randomUUID();
        await c.env.DB.prepare(`
          INSERT INTO project_equipment (
            id, project_id, tenant_id, company_id, part_id, item_name, asset_tag, serial_number, vendor,
            category, quantity, condition, current_stage, weight_kg, estimated_reuse_value,
            co2_avoided_kg, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          id,
          projectId,
          owner.tenantId,
          owner.companyId,
          catalogPart?.id || null,
          itemName,
          normalizeText(row.asset_tag ?? row.assetTag, 120),
          normalizeText(row.serial_number ?? row.serialNumber, 120),
          normalizeText(row.vendor, 160) || catalogPart?.vendor || null,
          normalizeText(row.category, 160) || catalogPart?.category || catalogPart?.subcategory || null,
          quantity,
          normalizeText(row.condition, 80) || 'Used',
          normalizeText(row.current_stage ?? row.currentStage ?? row.stage, 80) || 'assessment',
          parseNumber(row.weight_kg ?? row.weightKg, catalogPart?.weight_kg ?? null),
          parseNumber(row.estimated_reuse_value ?? row.estimatedReuseValue ?? row.reuse_value ?? row.reuseValue, 0),
          parseNumber(row.co2_avoided_kg ?? row.co2AvoidedKg, catalogPart?.emission_factor_kg ? catalogPart.emission_factor_kg * quantity : 0),
          normalizeText(row.notes, 1000),
        ).run();
        await insertActivity(c.env.DB, projectId, user, 'equipment_added', 'equipment', id, itemName);
        created += 1;
        if (catalogPart) linked += 1;
      } catch (rowError) {
        skipped += 1;
        issues.push({
          row: rowNumber,
          part_number: partNumber || undefined,
          error: rowError instanceof Error ? rowError.message : 'Failed to import row',
        });
      }
    }

    await insertActivity(
      c.env.DB,
      projectId,
      user,
      'equipment_imported',
      'equipment',
      projectId,
      JSON.stringify({ created, linked, skipped, total: rows.length }),
    );
    await logAudit(c.env.DB, user.id, 'IMPORT_PROJECT_EQUIPMENT', 'projects', projectId);

    return c.json({
      success: true,
      summary: { created, linked, skipped, total: rows.length },
      issues,
    });
  } catch (err) {
    console.error('POST /projects/:id/equipment/import error:', err);
    return c.json({ success: false, error: 'Failed to import materials and assets' }, 500);
  }
});

projectRoutes.post('/:id/equipment', async (c) => {
  try {
    const user = c.get('user');
    const projectId = c.req.param('id');
    const { project } = await getProject(c, projectId);
    if (!project) return c.json({ success: false, error: 'Project not found' }, 404);
    const body = await c.req.json<IncomingBody>();
    const owner = ownershipFromProject(project, user);
    const partId = normalizeText(body.part_id ?? body.partId, 160);
    const catalogPart = await findCatalogPartForProject(c.env.DB, partId, owner);
    if (partId && !catalogPart) return c.json({ success: false, error: 'Selected catalog part was not found' }, 400);

    const quantity = parsePositiveInteger(body.quantity);
    const itemName = normalizeText(body.item_name ?? body.itemName, 200)
      || catalogPart?.model_name
      || catalogPart?.part_number
      || null;
    if (!itemName) return c.json({ success: false, error: 'Item name is required' }, 400);
    const id = crypto.randomUUID();
    await c.env.DB.prepare(`
      INSERT INTO project_equipment (
        id, project_id, tenant_id, company_id, part_id, item_name, asset_tag, serial_number, vendor,
        category, quantity, condition, current_stage, weight_kg, estimated_reuse_value,
        co2_avoided_kg, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      projectId,
      owner.tenantId,
      owner.companyId,
      catalogPart?.id || null,
      itemName,
      normalizeText(body.asset_tag ?? body.assetTag, 120),
      normalizeText(body.serial_number ?? body.serialNumber, 120),
      normalizeText(body.vendor, 160) || catalogPart?.vendor || null,
      normalizeText(body.category, 160) || catalogPart?.category || catalogPart?.subcategory || null,
      quantity,
      normalizeText(body.condition, 80) || 'Used',
      normalizeText(body.current_stage ?? body.currentStage, 80) || 'assessment',
      parseNumber(body.weight_kg ?? body.weightKg, catalogPart?.weight_kg ?? null),
      parseNumber(body.estimated_reuse_value ?? body.estimatedReuseValue, 0),
      parseNumber(body.co2_avoided_kg ?? body.co2AvoidedKg, catalogPart?.emission_factor_kg ? catalogPart.emission_factor_kg * quantity : 0),
      normalizeText(body.notes, 1000),
    ).run();
    await insertActivity(c.env.DB, projectId, user, 'equipment_added', 'equipment', id, itemName);
    return c.json({ success: true, id }, 201);
  } catch (err) {
    console.error('POST /projects/:id/equipment error:', err);
    return c.json({ success: false, error: 'Failed to add equipment' }, 500);
  }
});

projectRoutes.put('/:id/equipment/:equipmentId', async (c) => {
  try {
    const user = c.get('user');
    const projectId = c.req.param('id');
    const equipmentId = c.req.param('equipmentId');
    const { project } = await getProject(c, projectId);
    if (!project) return c.json({ success: false, error: 'Project not found' }, 404);
    const body = await c.req.json<IncomingBody>();
    const owner = ownershipFromProject(project, user);
    const partIdWasProvided = body.part_id !== undefined || body.partId !== undefined;
    const partId = partIdWasProvided ? normalizeText(body.part_id ?? body.partId, 160) : null;
    const catalogPart = await findCatalogPartForProject(c.env.DB, partId, owner);
    if (partId && !catalogPart) return c.json({ success: false, error: 'Selected catalog part was not found' }, 400);

    const fields = [
      ['item_name', body.item_name ?? body.itemName, 200],
      ['asset_tag', body.asset_tag ?? body.assetTag, 120],
      ['serial_number', body.serial_number ?? body.serialNumber, 120],
      ['vendor', body.vendor, 160],
      ['category', body.category, 160],
      ['condition', body.condition, 80],
      ['current_stage', body.current_stage ?? body.currentStage, 80],
      ['notes', body.notes, 1000],
    ] as const;
    const sets: string[] = [];
    const params: SQLValue[] = [];
    if (partIdWasProvided) {
      sets.push('part_id = ?');
      params.push(catalogPart?.id || null);
    }
    for (const [column, value, maxLength] of fields) {
      if (value !== undefined) {
        sets.push(`${column} = ?`);
        params.push(normalizeText(value, maxLength));
      }
    }
    if (partIdWasProvided && catalogPart) {
      if (body.item_name === undefined && body.itemName === undefined) {
        sets.push('item_name = ?');
        params.push(catalogPart.model_name || catalogPart.part_number);
      }
      if (body.vendor === undefined) {
        sets.push('vendor = ?');
        params.push(catalogPart.vendor || null);
      }
      if (body.category === undefined) {
        sets.push('category = ?');
        params.push(catalogPart.category || catalogPart.subcategory || null);
      }
    }
    if (body.quantity !== undefined) {
      sets.push('quantity = ?');
      params.push(parsePositiveInteger(body.quantity));
    }
    for (const [column, value] of [
      ['weight_kg', body.weight_kg ?? body.weightKg],
      ['estimated_reuse_value', body.estimated_reuse_value ?? body.estimatedReuseValue],
      ['co2_avoided_kg', body.co2_avoided_kg ?? body.co2AvoidedKg],
    ] as const) {
      if (value !== undefined) {
        sets.push(`${column} = ?`);
        params.push(parseNumber(value, 0));
      }
    }
    if (partIdWasProvided && catalogPart && body.weight_kg === undefined && body.weightKg === undefined) {
      sets.push('weight_kg = ?');
      params.push(catalogPart.weight_kg ?? null);
    }
    if (partIdWasProvided && catalogPart && body.co2_avoided_kg === undefined && body.co2AvoidedKg === undefined) {
      sets.push('co2_avoided_kg = ?');
      params.push(catalogPart.emission_factor_kg ? catalogPart.emission_factor_kg * parsePositiveInteger(body.quantity) : 0);
    }
    if (sets.length === 0) return c.json({ success: false, error: 'No fields to update' }, 400);
    sets.push('updated_at = ?');
    params.push(new Date().toISOString(), projectId, equipmentId);
    await c.env.DB.prepare(`UPDATE project_equipment SET ${sets.join(', ')} WHERE project_id = ? AND id = ?`)
      .bind(...params)
      .run();
    await insertActivity(c.env.DB, projectId, user, 'equipment_updated', 'equipment', equipmentId);
    return c.json({ success: true });
  } catch (err) {
    console.error('PUT /projects/:id/equipment/:equipmentId error:', err);
    return c.json({ success: false, error: 'Failed to update equipment' }, 500);
  }
});

projectRoutes.delete('/:id/equipment/:equipmentId', async (c) => {
  try {
    const user = c.get('user');
    const projectId = c.req.param('id');
    const equipmentId = c.req.param('equipmentId');
    const { project } = await getProject(c, projectId);
    if (!project) return c.json({ success: false, error: 'Project not found' }, 404);
    await c.env.DB.prepare('DELETE FROM project_equipment WHERE project_id = ? AND id = ?')
      .bind(projectId, equipmentId)
      .run();
    await insertActivity(c.env.DB, projectId, user, 'equipment_deleted', 'equipment', equipmentId);
    return c.json({ success: true });
  } catch (err) {
    console.error('DELETE /projects/:id/equipment/:equipmentId error:', err);
    return c.json({ success: false, error: 'Failed to delete equipment' }, 500);
  }
});

// ============================================================================
// Workflow
// ============================================================================
projectRoutes.put('/:id/workflow/stages/:stageId', async (c) => {
  try {
    const user = c.get('user');
    const projectId = c.req.param('id');
    const stageId = c.req.param('stageId');
    const { project } = await getProject(c, projectId);
    if (!project) return c.json({ success: false, error: 'Project not found' }, 404);
    const body = await c.req.json<IncomingBody>();
    const status = normalizeStageStatus(body.status);
    await c.env.DB.prepare(`
      UPDATE project_workflow_stages
      SET status = ?, completed_at = CASE WHEN ? = 'completed' THEN datetime('now') ELSE NULL END, updated_at = datetime('now')
      WHERE project_id = ? AND id = ?
    `).bind(status, status, projectId, stageId).run();
    await insertActivity(c.env.DB, projectId, user, 'workflow_updated', 'workflow', stageId, status);
    return c.json({ success: true });
  } catch (err) {
    console.error('PUT /projects/:id/workflow/stages/:stageId error:', err);
    return c.json({ success: false, error: 'Failed to update workflow stage' }, 500);
  }
});

projectRoutes.post('/:id/workflow/tasks', async (c) => {
  try {
    const user = c.get('user');
    const projectId = c.req.param('id');
    const { project } = await getProject(c, projectId);
    if (!project) return c.json({ success: false, error: 'Project not found' }, 404);
    const body = await c.req.json<IncomingBody>();
    const title = normalizeText(body.title, 240);
    const stageId = normalizeText(body.stage_id ?? body.stageId, 160);
    if (!title || !stageId) return c.json({ success: false, error: 'Task title and stage are required' }, 400);
    const id = crypto.randomUUID();
    await c.env.DB.prepare(`
      INSERT INTO project_workflow_tasks (id, project_id, stage_id, title, due_date)
      VALUES (?, ?, ?, ?, ?)
    `).bind(id, projectId, stageId, title, normalizeText(body.due_date ?? body.dueDate, 32)).run();
    await insertActivity(c.env.DB, projectId, user, 'task_added', 'task', id, title);
    return c.json({ success: true, id }, 201);
  } catch (err) {
    console.error('POST /projects/:id/workflow/tasks error:', err);
    return c.json({ success: false, error: 'Failed to add task' }, 500);
  }
});

projectRoutes.put('/:id/workflow/tasks/:taskId', async (c) => {
  try {
    const user = c.get('user');
    const projectId = c.req.param('id');
    const taskId = c.req.param('taskId');
    const { project } = await getProject(c, projectId);
    if (!project) return c.json({ success: false, error: 'Project not found' }, 404);
    const body = await c.req.json<IncomingBody>();
    const status = normalizeText(body.status, 20) === 'done' ? 'done' : 'open';
    await c.env.DB.prepare('UPDATE project_workflow_tasks SET status = ?, updated_at = datetime(\'now\') WHERE project_id = ? AND id = ?')
      .bind(status, projectId, taskId)
      .run();
    await insertActivity(c.env.DB, projectId, user, 'task_updated', 'task', taskId, status);
    return c.json({ success: true });
  } catch (err) {
    console.error('PUT /projects/:id/workflow/tasks/:taskId error:', err);
    return c.json({ success: false, error: 'Failed to update task' }, 500);
  }
});

// ============================================================================
// Generic tab entries
// ============================================================================
projectRoutes.post('/:id/financials', async (c) => {
  try {
    const user = c.get('user');
    const projectId = c.req.param('id');
    const { project } = await getProject(c, projectId);
    if (!project) return c.json({ success: false, error: 'Project not found' }, 404);
    const body = await c.req.json<IncomingBody>();
    const category = normalizeText(body.category, 160);
    if (!category) return c.json({ success: false, error: 'Category is required' }, 400);
    const owner = ownershipFromProject(project, user);
    const id = crypto.randomUUID();
    const type = normalizeText(body.type, 20);
    await c.env.DB.prepare(`
      INSERT INTO project_financials (id, project_id, tenant_id, company_id, type, category, description, amount, currency, stage, incurred_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      projectId,
      owner.tenantId,
      owner.companyId,
      ['revenue', 'credit'].includes(type || '') ? type : 'cost',
      category,
      normalizeText(body.description, 500),
      parseNumber(body.amount, 0),
      normalizeText(body.currency, 12) || project.currency || 'USD',
      normalizeText(body.stage, 80),
      normalizeText(body.incurred_at ?? body.incurredAt, 32),
    ).run();
    await insertActivity(c.env.DB, projectId, user, 'financial_added', 'financial', id, category);
    return c.json({ success: true, id }, 201);
  } catch (err) {
    console.error('POST /projects/:id/financials error:', err);
    return c.json({ success: false, error: 'Failed to add financial entry' }, 500);
  }
});

projectRoutes.delete('/:id/financials/:entryId', async (c) => {
  const projectId = c.req.param('id');
  const entryId = c.req.param('entryId');
  const { project } = await getProject(c, projectId);
  if (!project) return c.json({ success: false, error: 'Project not found' }, 404);
  await c.env.DB.prepare('DELETE FROM project_financials WHERE project_id = ? AND id = ?').bind(projectId, entryId).run();
  return c.json({ success: true });
});

projectRoutes.post('/:id/logistics', async (c) => {
  try {
    const user = c.get('user');
    const projectId = c.req.param('id');
    const { project } = await getProject(c, projectId);
    if (!project) return c.json({ success: false, error: 'Project not found' }, 404);
    const body = await c.req.json<IncomingBody>();
    const owner = ownershipFromProject(project, user);
    const id = crypto.randomUUID();
    await c.env.DB.prepare(`
      INSERT INTO project_logistics (
        id, project_id, tenant_id, company_id, shipment_type, status, carrier,
        origin, destination, scheduled_date, tracking_reference, estimated_cost, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      projectId,
      owner.tenantId,
      owner.companyId,
      normalizeText(body.shipment_type ?? body.shipmentType, 80) || 'collection',
      normalizeText(body.status, 80) || 'planned',
      normalizeText(body.carrier, 160),
      normalizeText(body.origin, 240),
      normalizeText(body.destination, 240),
      normalizeText(body.scheduled_date ?? body.scheduledDate, 32),
      normalizeText(body.tracking_reference ?? body.trackingReference, 160),
      parseNumber(body.estimated_cost ?? body.estimatedCost, 0),
      normalizeText(body.notes, 1000),
    ).run();
    await insertActivity(c.env.DB, projectId, user, 'logistics_added', 'logistics', id);
    return c.json({ success: true, id }, 201);
  } catch (err) {
    console.error('POST /projects/:id/logistics error:', err);
    return c.json({ success: false, error: 'Failed to add logistics entry' }, 500);
  }
});

projectRoutes.delete('/:id/logistics/:entryId', async (c) => {
  const projectId = c.req.param('id');
  const entryId = c.req.param('entryId');
  const { project } = await getProject(c, projectId);
  if (!project) return c.json({ success: false, error: 'Project not found' }, 404);
  await c.env.DB.prepare('DELETE FROM project_logistics WHERE project_id = ? AND id = ?').bind(projectId, entryId).run();
  return c.json({ success: true });
});

projectRoutes.post('/:id/evidence', async (c) => {
  try {
    const user = c.get('user');
    const projectId = c.req.param('id');
    const { project } = await getProject(c, projectId);
    if (!project) return c.json({ success: false, error: 'Project not found' }, 404);

    const contentType = c.req.header('Content-Type') || '';
    const isMultipart = contentType.toLowerCase().includes('multipart/form-data');
    const body = isMultipart ? await c.req.parseBody() : await c.req.json<IncomingBody>();
    const title = isMultipart
      ? textField(body.title, 200)
      : normalizeText((body as IncomingBody).title, 200);
    if (!title) return c.json({ success: false, error: 'Evidence title is required' }, 400);

    const owner = ownershipFromProject(project, user);
    const id = crypto.randomUUID();
    let fileUrl: string | null = null;
    let r2Key: string | null = null;
    let fileName: string | null = null;
    let fileSize: number | null = null;
    let uploadedContentType: string | null = null;

    if (isMultipart) {
      const file = fileField(body.file);
      if (!file) return c.json({ success: false, error: 'Evidence file is required' }, 400);

      const validationError = validateEvidenceFile(file);
      if (validationError) return c.json({ success: false, error: validationError }, 400);

      fileName = safeFileName(file.name || title);
      fileSize = file.size;
      uploadedContentType = file.type || 'application/octet-stream';
      r2Key = evidenceR2Key(project, projectId, id, fileName);
      await c.env.EVIDENCE_BUCKET.put(r2Key, file.stream(), {
        httpMetadata: {
          contentType: uploadedContentType,
          contentDisposition: `inline; filename="${contentDispositionFileName(fileName)}"`,
        },
        customMetadata: {
          projectId,
          evidenceId: id,
          uploadedBy: user.id,
        },
      });
      fileUrl = evidenceDownloadPath(projectId, id);
    } else {
      const jsonBody = body as IncomingBody;
      fileUrl = normalizeText(jsonBody.file_url ?? jsonBody.fileUrl, 1000);
    }

    await c.env.DB.prepare(`
      INSERT INTO project_evidence (
        id, project_id, tenant_id, company_id, title, evidence_type, stage, file_url,
        r2_key, file_name, file_size, content_type, notes, uploaded_by
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      projectId,
      owner.tenantId,
      owner.companyId,
      title,
      isMultipart
        ? textField(body.evidence_type ?? body.evidenceType, 80) || 'document'
        : normalizeText((body as IncomingBody).evidence_type ?? (body as IncomingBody).evidenceType, 80) || 'document',
      isMultipart ? textField(body.stage, 80) : normalizeText((body as IncomingBody).stage, 80),
      fileUrl,
      r2Key,
      fileName,
      fileSize,
      uploadedContentType,
      isMultipart ? textField(body.notes, 1000) : normalizeText((body as IncomingBody).notes, 1000),
      user.id,
    ).run();
    await insertActivity(c.env.DB, projectId, user, 'evidence_added', 'evidence', id, title);
    return c.json({ success: true, id }, 201);
  } catch (err) {
    console.error('POST /projects/:id/evidence error:', err);
    return c.json({ success: false, error: 'Failed to add evidence' }, 500);
  }
});

projectRoutes.get('/:id/evidence/:entryId/download', async (c) => {
  const projectId = c.req.param('id');
  const entryId = c.req.param('entryId');
  const { project } = await getProject(c, projectId);
  if (!project) return c.json({ success: false, error: 'Project not found' }, 404);

  const evidence = await c.env.DB.prepare(`
    SELECT id, project_id, r2_key, file_name, content_type, file_size, file_url
    FROM project_evidence
    WHERE project_id = ? AND id = ?
  `).bind(projectId, entryId).first<EvidenceRow>();
  if (!evidence) return c.json({ success: false, error: 'Evidence not found' }, 404);

  if (!evidence.r2_key) {
    return c.json({ success: false, error: 'Evidence file is not stored in R2' }, 404);
  }

  const object = await c.env.EVIDENCE_BUCKET.get(evidence.r2_key);
  if (!object) return c.json({ success: false, error: 'Evidence file not found' }, 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Content-Type', evidence.content_type || headers.get('Content-Type') || 'application/octet-stream');
  headers.set('Content-Disposition', `inline; filename="${contentDispositionFileName(evidence.file_name || 'evidence-file')}"`);
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  if (evidence.file_size !== null && evidence.file_size !== undefined) {
    headers.set('Content-Length', String(evidence.file_size));
  }

  return new Response(object.body, { headers });
});

projectRoutes.delete('/:id/evidence/:entryId', async (c) => {
  const projectId = c.req.param('id');
  const entryId = c.req.param('entryId');
  const { project } = await getProject(c, projectId);
  if (!project) return c.json({ success: false, error: 'Project not found' }, 404);
  const evidence = await c.env.DB.prepare('SELECT r2_key FROM project_evidence WHERE project_id = ? AND id = ?')
    .bind(projectId, entryId)
    .first<{ r2_key: string | null }>();
  if (evidence?.r2_key) {
    await c.env.EVIDENCE_BUCKET.delete(evidence.r2_key);
  }
  await c.env.DB.prepare('DELETE FROM project_evidence WHERE project_id = ? AND id = ?').bind(projectId, entryId).run();
  return c.json({ success: true });
});

projectRoutes.post('/:id/comments', async (c) => {
  try {
    const user = c.get('user');
    const projectId = c.req.param('id');
    const { project } = await getProject(c, projectId);
    if (!project) return c.json({ success: false, error: 'Project not found' }, 404);
    const body = await c.req.json<IncomingBody>();
    const comment = normalizeText(body.body ?? body.comment, 2000);
    if (!comment) return c.json({ success: false, error: 'Comment is required' }, 400);
    const id = crypto.randomUUID();
    await c.env.DB.prepare('INSERT INTO project_comments (id, project_id, user_id, body) VALUES (?, ?, ?, ?)')
      .bind(id, projectId, user.id, comment)
      .run();
    await insertActivity(c.env.DB, projectId, user, 'comment_added', 'comment', id);
    return c.json({ success: true, id }, 201);
  } catch (err) {
    console.error('POST /projects/:id/comments error:', err);
    return c.json({ success: false, error: 'Failed to add comment' }, 500);
  }
});

projectRoutes.get('/:id/members', async (c) => {
  const projectId = c.req.param('id');
  const { project } = await getProject(c, projectId);
  if (!project) return c.json({ success: false, error: 'Project not found' }, 404);
  const params: SQLValue[] = [];
  const conditions: string[] = ['u.status = ?'];
  params.push('active');
  if (project.tenant_id) {
    conditions.push('(u.tenant_id = ? OR u.id = ?)');
    params.push(project.tenant_id, String(project.created_by || ''));
  }
  const { results } = await c.env.DB.prepare(`
    SELECT u.id, u.name, u.email, u.role, u.tenant_id, t.name AS tenant_name,
      CASE WHEN u.id = ? THEN 1 ELSE 0 END AS is_owner
    FROM users u
    LEFT JOIN tenants t ON t.id = u.tenant_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY is_owner DESC, u.name
  `).bind(String(project.created_by || ''), ...params).all();
  return c.json({ success: true, members: results || [] });
});
