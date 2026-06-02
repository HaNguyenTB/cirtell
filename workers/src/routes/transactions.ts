/**
 * Transactions routes - Cirveris-style transaction workspace for Cirtell.
 * Tenant/company scoped, with enriched reference data and optional line items.
 */

import { Hono } from 'hono';
import type { Env } from '../index';
import { authMiddleware, logAudit, type User } from '../middleware/auth';
import { requirePermission, Permission } from '../middleware/permissions';
import { appendScopeCondition, resolveTenantScope, scopeInsertValues, scopedWhere } from '../middleware/tenantScope';

type Variables = { user: User };
type SQLValue = string | number | null;

type IncomingBody = Record<string, unknown>;

interface PreparedLineItem {
  partId: string | null;
  serialNumber: string | null;
  condition: string | null;
  quantity: number;
  unitPrice: number;
  sourceWarehouseId: string | null;
  destinationWarehouseId: string | null;
  notes: string | null;
}

interface ScopeValues {
  tenantId: string | null;
  companyId: string | null;
}

interface UploadedFile {
  name: string;
  size: number;
  type?: string;
  arrayBuffer: () => Promise<ArrayBuffer>;
}

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

const MOVEMENT_TYPES = ['Purchase', 'Sale', 'Redeploy', 'Recycle'] as const;

export const transactionsRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

transactionsRoutes.use('*', authMiddleware);

function firstDefined(body: IncomingBody, keys: string[]): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(body, key)) return body[key];
  }
  return undefined;
}

function normalizeText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function parsePositiveInteger(value: unknown): number | null {
  if (!hasValue(value)) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function parseNonNegativeNumber(value: unknown): number | null {
  if (!hasValue(value)) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

function requireMovementType(value: unknown): string {
  const movementType = normalizeText(value);
  if (!movementType || !MOVEMENT_TYPES.includes(movementType as (typeof MOVEMENT_TYPES)[number])) {
    throw new ValidationError(`movement_type must be one of: ${MOVEMENT_TYPES.join(', ')}`);
  }
  return movementType;
}

function safeFileName(name: string): string {
  return name.replace(/[^\w.\- ]+/g, '').trim() || 'purchase-order';
}

function isUploadedFile(value: unknown): value is UploadedFile {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<UploadedFile>;
  return typeof candidate.name === 'string'
    && typeof candidate.size === 'number'
    && typeof candidate.arrayBuffer === 'function';
}

async function findOrCreateVendor(db: D1Database, vendorName: unknown): Promise<string | null> {
  const name = normalizeText(vendorName);
  if (!name) return null;

  const existing = await db.prepare(
    'SELECT id FROM vendors WHERE LOWER(vendor_name) = LOWER(?)',
  ).bind(name).first<{ id: string }>();
  if (existing) return existing.id;

  const id = crypto.randomUUID();
  await db.prepare(
    'INSERT INTO vendors (id, vendor_name, created_at) VALUES (?, ?, ?)',
  ).bind(id, name, new Date().toISOString()).run();
  return id;
}

function ownershipClause(values: ScopeValues, alias = ''): { clause: string; params: SQLValue[] } {
  const prefix = alias ? `${alias}.` : '';
  if (values.companyId) return { clause: `${prefix}company_id = ?`, params: [values.companyId] };
  if (values.tenantId) return { clause: `${prefix}tenant_id = ?`, params: [values.tenantId] };
  return { clause: '1=1', params: [] };
}

async function resolvePart(
  db: D1Database,
  input: IncomingBody,
  fallbackVendor: unknown,
  ownership: ScopeValues,
): Promise<string | null> {
  const ownerWhere = ownershipClause(ownership);
  const explicitPartId = normalizeText(firstDefined(input, ['part_id', 'partId']));
  if (explicitPartId) {
    const part = await db.prepare(`SELECT id FROM parts WHERE id = ? AND ${ownerWhere.clause}`)
      .bind(explicitPartId, ...ownerWhere.params)
      .first<{ id: string }>();
    if (!part) throw new ValidationError('Part not found');
    return explicitPartId;
  }

  const partNumber = normalizeText(firstDefined(input, ['part_number', 'partNumber']));
  if (!partNumber) return null;

  const existing = await db.prepare(
    `SELECT id FROM parts WHERE LOWER(part_number) = LOWER(?) AND ${ownerWhere.clause}`,
  ).bind(partNumber, ...ownerWhere.params).first<{ id: string }>();
  if (existing) return existing.id;

  const vendorId = await findOrCreateVendor(db, firstDefined(input, ['vendor', 'companyName']) ?? fallbackVendor);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const partName = normalizeText(firstDefined(input, ['part_name', 'partName', 'model_name', 'modelName'])) || partNumber;
  const technology = normalizeText(firstDefined(input, ['technology', 'technology_type', 'technologyType']));
  const category = normalizeText(firstDefined(input, ['category'])) || 'Network Equipment';

  await db.prepare(`
    INSERT INTO parts (
        id, tenant_id, company_id, part_number, model_name, vendor_id, technology_type, category,
        needs_review, review_notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
  `).bind(
    id,
    ownership.tenantId,
    ownership.companyId,
    partNumber,
    partName,
    vendorId,
    technology,
    category,
    'Created from transaction entry',
    now,
    now,
  ).run();

  return id;
}

async function validateWarehouse(db: D1Database, value: unknown, label: string, ownership: ScopeValues): Promise<string | null> {
  const id = normalizeText(value);
  if (!id) return null;
  const ownerWhere = ownershipClause(ownership);
  const row = await db.prepare(`SELECT id FROM warehouses WHERE id = ? AND ${ownerWhere.clause}`)
    .bind(id, ...ownerWhere.params)
    .first<{ id: string }>();
  if (!row) throw new ValidationError(`${label} warehouse not found`);
  return id;
}

async function validateContact(db: D1Database, value: unknown, ownership: ScopeValues): Promise<string | null> {
  const id = normalizeText(value);
  if (!id) return null;
  const ownerWhere = ownershipClause(ownership);
  const row = await db.prepare(`SELECT id FROM contacts WHERE id = ? AND ${ownerWhere.clause}`)
    .bind(id, ...ownerWhere.params)
    .first<{ id: string }>();
  if (!row) throw new ValidationError('Contact not found');
  return id;
}

async function validateMarket(db: D1Database, value: unknown, useDefault: boolean, ownership: ScopeValues): Promise<string | null> {
  const ownerWhere = ownershipClause(ownership);
  const id = normalizeText(value);
  if (id) {
    const row = await db.prepare(`SELECT id FROM markets WHERE id = ? AND ${ownerWhere.clause}`)
      .bind(id, ...ownerWhere.params)
      .first<{ id: string }>();
    if (!row) throw new ValidationError('Market not found');
    return id;
  }

  if (!useDefault) return null;
  const fallback = await db.prepare(
    `SELECT id FROM markets WHERE ${ownerWhere.clause} ORDER BY CASE WHEN id = 'global' THEN 0 ELSE 1 END, market_name LIMIT 1`,
  ).bind(...ownerWhere.params).first<{ id: string }>();
  return fallback?.id || null;
}

function incomingItems(body: IncomingBody): IncomingBody[] {
  const raw = firstDefined(body, ['items', 'transaction_items', 'transactionItems', 'line_items', 'lineItems']);
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is IncomingBody => typeof item === 'object' && item !== null && !Array.isArray(item));
}

async function prepareLineItems(
  db: D1Database,
  body: IncomingBody,
  fallbackPartId: string | null,
  fallbackVendor: unknown,
  fallbackSourceWarehouseId: string | null,
  fallbackDestinationWarehouseId: string | null,
  ownership: ScopeValues,
): Promise<PreparedLineItem[]> {
  const items = incomingItems(body);
  const prepared: PreparedLineItem[] = [];

  for (const item of items) {
    const quantity = parsePositiveInteger(firstDefined(item, ['quantity', 'qty']));
    if (!quantity) throw new ValidationError('Each line item requires a positive quantity');

    const unitPriceRaw = firstDefined(item, ['unit_price_usd', 'unitPrice', 'unit_price']);
    const unitPrice = hasValue(unitPriceRaw) ? parseNonNegativeNumber(unitPriceRaw) : 0;
    if (unitPrice === null) throw new ValidationError('Line item unit price must be zero or greater');

    const sourceWarehouseId = await validateWarehouse(
      db,
      firstDefined(item, ['source_warehouse_id', 'sourceWarehouseId']) ?? fallbackSourceWarehouseId,
      'Source',
      ownership,
    );
    const destinationWarehouseId = await validateWarehouse(
      db,
      firstDefined(item, ['destination_warehouse_id', 'destinationWarehouseId']) ?? fallbackDestinationWarehouseId,
      'Destination',
      ownership,
    );

    prepared.push({
      partId: await resolvePart(db, item, fallbackVendor, ownership) || fallbackPartId,
      serialNumber: normalizeText(firstDefined(item, ['serial_number', 'serialNumber'])),
      condition: normalizeText(firstDefined(item, ['condition'])),
      quantity,
      unitPrice,
      sourceWarehouseId,
      destinationWarehouseId,
      notes: normalizeText(firstDefined(item, ['notes'])),
    });
  }

  return prepared;
}

async function insertLineItems(
  db: D1Database,
  transactionId: string,
  lineItems: PreparedLineItem[],
  now: string,
  ownership: ScopeValues,
): Promise<void> {
  for (const item of lineItems) {
    await db.prepare(`
      INSERT INTO transaction_items (
        id, tenant_id, company_id, transaction_id, part_id, serial_number, condition, quantity,
        unit_price_usd, source_warehouse_id, destination_warehouse_id,
        notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      ownership.tenantId,
      ownership.companyId,
      transactionId,
      item.partId,
      item.serialNumber,
      item.condition,
      item.quantity,
      item.unitPrice,
      item.sourceWarehouseId,
      item.destinationWarehouseId,
      item.notes,
      now,
      now,
    ).run();
  }
}

const TRANSACTION_FROM = `
  FROM transactions t
  LEFT JOIN parts p ON t.part_id = p.id
  LEFT JOIN vendors pv ON p.vendor_id = pv.id
  LEFT JOIN markets m ON t.market_id = m.id
  LEFT JOIN warehouses sw ON t.source_warehouse_id = sw.id
  LEFT JOIN warehouses dw ON t.destination_warehouse_id = dw.id
  LEFT JOIN projects pr ON t.project_id = pr.id
  LEFT JOIN contacts ct ON t.contact_id = ct.id
  LEFT JOIN (
    SELECT transaction_id, COUNT(*) AS item_count
    FROM transaction_items
    GROUP BY transaction_id
  ) ti ON ti.transaction_id = t.id
`;

const TRANSACTION_SELECT = `
  SELECT
    t.id,
    t.date,
    t.market_id AS marketId,
    COALESCE(m.market_name, 'Global') AS marketName,
    COALESCE(m.region, 'Global') AS region,
    t.movement_type AS movementType,
    t.quantity,
    t.unit_price_usd AS unitPrice,
    (t.quantity * t.unit_price_usd) AS totalValue,
    COALESCE(NULLIF(t.vendor, ''), pv.vendor_name) AS vendor,
    COALESCE(NULLIF(t.vendor, ''), pv.vendor_name) AS companyName,
    t.part_id AS partId,
    p.part_number AS partNumber,
    p.model_name AS partName,
    p.technology_type AS technology,
    p.category,
    t.serial_number AS serialNumber,
    t.condition,
    t.po_number AS poNumber,
    t.po_file_key AS poFileKey,
    t.po_file_name AS poFileName,
    t.project_id AS projectId,
    pr.name AS projectName,
    t.contact_id AS contactId,
    ct.company_name AS contactCompanyName,
    ct.contact_person_name AS contactPersonName,
    t.source_warehouse_id AS sourceWarehouseId,
    sw.name AS sourceWarehouseName,
    sw.code AS sourceWarehouseCode,
    t.destination_warehouse_id AS destinationWarehouseId,
    dw.name AS destinationWarehouseName,
    dw.code AS destinationWarehouseCode,
    COALESCE(ti.item_count, 0) AS itemCount,
    t.created_at AS createdAt,
    t.updated_at AS updatedAt
`;

// ============================================================================
// Reference routes used by the Cirveris transaction UI
// ============================================================================
transactionsRoutes.get('/markets', requirePermission(Permission.VIEW_TRANSACTIONS), async (c) => {
  try {
    const scope = await resolveTenantScope(c);
    const scopeWhere = scopedWhere(scope, 'tenant_id', 'company_id');
    const { results } = await c.env.DB.prepare(`
      SELECT id, market_name AS marketName, country, region
      FROM markets
      WHERE ${scopeWhere.clause}
      ORDER BY CASE WHEN id = 'global' THEN 0 ELSE 1 END, market_name
    `).bind(...scopeWhere.params).all();
    return c.json({ success: true, markets: results || [] });
  } catch (err) {
    console.error('GET /transactions/markets error:', err);
    return c.json({ success: false, error: 'Failed to fetch markets' }, 500);
  }
});

transactionsRoutes.get('/warehouses-list', requirePermission(Permission.VIEW_TRANSACTIONS), async (c) => {
  try {
    const scope = await resolveTenantScope(c);
    const scopeWhere = scopedWhere(scope, 'tenant_id', 'company_id');
    const { results } = await c.env.DB.prepare(`
      SELECT id, code, name, city, country, status
      FROM warehouses
      WHERE status = 'active' AND ${scopeWhere.clause}
      ORDER BY name
    `).bind(...scopeWhere.params).all();
    return c.json({ success: true, warehouses: results || [] });
  } catch (err) {
    console.error('GET /transactions/warehouses-list error:', err);
    return c.json({ success: false, error: 'Failed to fetch warehouses' }, 500);
  }
});

transactionsRoutes.get('/projects-list', requirePermission(Permission.VIEW_TRANSACTIONS), async (c) => {
  try {
    const scope = await resolveTenantScope(c);
    const scopeWhere = scopedWhere(scope, 'tenant_id', 'company_id');
    const { results } = await c.env.DB.prepare(`
      SELECT id, name AS projectName
      FROM projects
      WHERE ${scopeWhere.clause}
        AND status NOT IN ('cancelled')
      ORDER BY updated_at DESC, name
      LIMIT 250
    `).bind(...scopeWhere.params).all();
    return c.json({ success: true, projects: results || [] });
  } catch (err) {
    console.error('GET /transactions/projects-list error:', err);
    return c.json({ success: true, projects: [] });
  }
});

transactionsRoutes.get('/devices-available', requirePermission(Permission.VIEW_TRANSACTIONS), async (c) => {
  return c.json({ success: true, devices: [] });
});

// ============================================================================
// GET /api/transactions/items/:transactionId
// ============================================================================
transactionsRoutes.get('/items/:transactionId', requirePermission(Permission.VIEW_TRANSACTIONS), async (c) => {
  try {
    const scope = await resolveTenantScope(c);
    const scopeWhere = scopedWhere(scope, 'tenant_id', 'company_id');
    const transactionId = c.req.param('transactionId');
    const exists = await c.env.DB.prepare(`SELECT id FROM transactions WHERE id = ? AND ${scopeWhere.clause}`)
      .bind(transactionId, ...scopeWhere.params)
      .first<{ id: string }>();

    if (!exists) return c.json({ success: false, error: 'Transaction not found' }, 404);

    const { results } = await c.env.DB.prepare(`
      SELECT
        ti.id,
        ti.transaction_id AS transactionId,
        ti.part_id AS partId,
        p.part_number AS partNumber,
        p.model_name AS partName,
        p.technology_type AS technology,
        p.category,
        ti.serial_number AS serialNumber,
        ti.condition,
        ti.quantity,
        ti.unit_price_usd AS unitPrice,
        (ti.quantity * ti.unit_price_usd) AS totalValue,
        ti.source_warehouse_id AS sourceWarehouseId,
        sw.name AS sourceWarehouseName,
        sw.code AS sourceWarehouseCode,
        ti.destination_warehouse_id AS destinationWarehouseId,
        dw.name AS destinationWarehouseName,
        dw.code AS destinationWarehouseCode,
        ti.notes
      FROM transaction_items ti
      LEFT JOIN parts p ON ti.part_id = p.id
      LEFT JOIN warehouses sw ON ti.source_warehouse_id = sw.id
      LEFT JOIN warehouses dw ON ti.destination_warehouse_id = dw.id
      WHERE ti.transaction_id = ? AND ${scopeWhere.clause.replaceAll('tenant_id', 'ti.tenant_id').replaceAll('company_id', 'ti.company_id')}
      ORDER BY ti.created_at, ti.id
    `).bind(transactionId, ...scopeWhere.params).all();

    return c.json({ success: true, items: results || [] });
  } catch (err) {
    console.error('GET /transactions/items/:transactionId error:', err);
    return c.json({ success: false, error: 'Failed to fetch transaction items' }, 500);
  }
});

// ============================================================================
// GET /api/transactions/summary
// ============================================================================
transactionsRoutes.get('/summary', requirePermission(Permission.VIEW_TRANSACTIONS), async (c) => {
  try {
    const scope = await resolveTenantScope(c);
    const scopeWhere = scopedWhere(scope, 'tenant_id', 'company_id');
    const summary = await c.env.DB.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN movement_type = 'Purchase' THEN 1 ELSE 0 END) AS purchases,
        SUM(CASE WHEN movement_type = 'Sale' THEN 1 ELSE 0 END) AS sales,
        SUM(CASE WHEN movement_type = 'Redeploy' THEN 1 ELSE 0 END) AS redeploys,
        SUM(CASE WHEN movement_type = 'Recycle' THEN 1 ELSE 0 END) AS recycles,
        SUM(quantity * unit_price_usd) AS totalValue
      FROM transactions
      WHERE ${scopeWhere.clause}
    `).bind(...scopeWhere.params).first<{
      total: number;
      purchases: number;
      sales: number;
      redeploys: number;
      recycles: number;
      totalValue: number | null;
    }>();

    return c.json({
      success: true,
      summary: {
        total: summary?.total || 0,
        purchases: summary?.purchases || 0,
        sales: summary?.sales || 0,
        redeploys: summary?.redeploys || 0,
        recycles: summary?.recycles || 0,
        totalValue: summary?.totalValue || 0,
      },
    });
  } catch (err) {
    console.error('GET /transactions/summary error:', err);
    return c.json({ success: false, error: 'Failed to fetch summary' }, 500);
  }
});

// ============================================================================
// GET /api/transactions - list with enrichment
// ============================================================================
transactionsRoutes.get('/', requirePermission(Permission.VIEW_TRANSACTIONS), async (c) => {
  try {
    const scope = await resolveTenantScope(c);
    const search = c.req.query('search')?.trim();
    const movementType = c.req.query('movement_type') || c.req.query('type');
    const startDate = c.req.query('start_date');
    const endDate = c.req.query('end_date');
    const marketId = c.req.query('market_id');
    const limit = Math.min(parseInt(c.req.query('limit') || '100', 10), 500);
    const offset = Math.max(parseInt(c.req.query('offset') || '0', 10), 0);

    const params: SQLValue[] = [];
    const conditions: string[] = [];
    appendScopeCondition(conditions, params, scope, 't.tenant_id', 't.company_id');

    if (movementType) {
      conditions.push('t.movement_type = ?');
      params.push(movementType);
    }
    if (startDate) {
      conditions.push('t.date >= ?');
      params.push(startDate);
    }
    if (endDate) {
      conditions.push('t.date <= ?');
      params.push(endDate);
    }
    if (marketId) {
      conditions.push('t.market_id = ?');
      params.push(marketId);
    }
    if (search) {
      conditions.push(`(
        p.part_number LIKE ?
        OR p.model_name LIKE ?
        OR t.vendor LIKE ?
        OR pv.vendor_name LIKE ?
        OR t.po_number LIKE ?
        OR t.serial_number LIKE ?
        OR m.market_name LIKE ?
        OR ct.company_name LIKE ?
      )`);
      const term = `%${search}%`;
      params.push(term, term, term, term, term, term, term, term);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const countResult = await c.env.DB.prepare(
      `SELECT COUNT(*) AS total ${TRANSACTION_FROM} ${whereClause}`,
    ).bind(...params).first<{ total: number }>();

    const { results } = await c.env.DB.prepare(`
      ${TRANSACTION_SELECT}
      ${TRANSACTION_FROM}
      ${whereClause}
      ORDER BY t.date DESC, t.created_at DESC
      LIMIT ? OFFSET ?
    `).bind(...params, limit, offset).all();

    return c.json({
      success: true,
      transactions: results || [],
      total: countResult?.total || 0,
      limit,
      offset,
    });
  } catch (err) {
    console.error('GET /transactions error:', err);
    return c.json({ success: false, error: 'Failed to fetch transactions' }, 500);
  }
});

// ============================================================================
// POST /api/transactions/:id/po-upload
// ============================================================================
transactionsRoutes.post('/:id/po-upload', requirePermission(Permission.EDIT_TRANSACTIONS), async (c) => {
  try {
    const user = c.get('user');
    const scope = await resolveTenantScope(c);
    const scopeWhere = scopedWhere(scope, 'tenant_id', 'company_id');
    const id = c.req.param('id')!;
    const existing = await c.env.DB.prepare(`SELECT id FROM transactions WHERE id = ? AND ${scopeWhere.clause}`)
      .bind(id, ...scopeWhere.params)
      .first<{ id: string }>();
    if (!existing) return c.json({ success: false, error: 'Transaction not found' }, 404);

    const formData = await c.req.formData();
    const file = formData.get('file');
    if (!isUploadedFile(file)) {
      return c.json({ success: false, error: 'PO file is required' }, 400);
    }
    if (file.size > 10 * 1024 * 1024) {
      return c.json({ success: false, error: 'PO file must be 10 MB or smaller' }, 400);
    }

    const fileName = safeFileName(file.name);
    const contentType = file.type || 'application/octet-stream';
    const fileData = await file.arrayBuffer();
    const now = new Date().toISOString();

    await c.env.DB.prepare(`
      INSERT INTO transaction_po_files (
        transaction_id, file_name, content_type, file_data, uploaded_by, uploaded_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(transaction_id) DO UPDATE SET
        file_name = excluded.file_name,
        content_type = excluded.content_type,
        file_data = excluded.file_data,
        uploaded_by = excluded.uploaded_by,
        uploaded_at = excluded.uploaded_at
    `).bind(id, fileName, contentType, fileData, user.id, now).run();

    await c.env.DB.prepare(`
      UPDATE transactions
      SET po_file_key = ?, po_file_name = ?, updated_at = ?
      WHERE id = ?
    `).bind(id, fileName, now, id).run();

    await logAudit(c.env.DB, user.id, 'UPLOAD_TRANSACTION_PO', 'transactions', id, fileName);
    return c.json({ success: true, fileName });
  } catch (err) {
    console.error('POST /transactions/:id/po-upload error:', err);
    return c.json({ success: false, error: 'Failed to upload PO file' }, 500);
  }
});

// ============================================================================
// GET /api/transactions/:id/po-download
// ============================================================================
transactionsRoutes.get('/:id/po-download', requirePermission(Permission.VIEW_TRANSACTIONS), async (c) => {
  try {
    const scope = await resolveTenantScope(c);
    const scopeWhere = scopedWhere(scope, 't.tenant_id', 't.company_id');
    const id = c.req.param('id')!;
    const row = await c.env.DB.prepare(`
      SELECT pf.file_name AS fileName, pf.content_type AS contentType, pf.file_data AS fileData
      FROM transaction_po_files pf
      JOIN transactions t ON t.id = pf.transaction_id
      WHERE pf.transaction_id = ? AND ${scopeWhere.clause}
    `).bind(id, ...scopeWhere.params).first<{ fileName: string; contentType: string; fileData: ArrayBuffer }>();

    if (!row) return c.json({ success: false, error: 'PO file not found' }, 404);

    return new Response(row.fileData, {
      headers: {
        'Content-Type': row.contentType || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${safeFileName(row.fileName)}"`,
      },
    });
  } catch (err) {
    console.error('GET /transactions/:id/po-download error:', err);
    return c.json({ success: false, error: 'Failed to download PO file' }, 500);
  }
});

// ============================================================================
// GET /api/transactions/:id
// ============================================================================
transactionsRoutes.get('/:id', requirePermission(Permission.VIEW_TRANSACTIONS), async (c) => {
  try {
    const scope = await resolveTenantScope(c);
    const scopeWhere = scopedWhere(scope, 't.tenant_id', 't.company_id');
    const id = c.req.param('id')!;
    const tx = await c.env.DB.prepare(`
      ${TRANSACTION_SELECT}
      ${TRANSACTION_FROM}
      WHERE t.id = ? AND ${scopeWhere.clause}
    `).bind(id, ...scopeWhere.params).first();

    if (!tx) return c.json({ success: false, error: 'Transaction not found' }, 404);
    return c.json({ success: true, transaction: tx });
  } catch (err) {
    console.error('GET /transactions/:id error:', err);
    return c.json({ success: false, error: 'Failed to fetch transaction' }, 500);
  }
});

// ============================================================================
// POST /api/transactions - create
// ============================================================================
transactionsRoutes.post('/', requirePermission(Permission.EDIT_TRANSACTIONS), async (c) => {
  try {
    const user = c.get('user');
    const scope = await resolveTenantScope(c);
    const ownership = scopeInsertValues(scope, user);
    const body = await c.req.json<IncomingBody>();

    const date = normalizeText(firstDefined(body, ['date']));
    if (!date) return c.json({ success: false, error: 'date is required' }, 400);

    const movementType = requireMovementType(firstDefined(body, ['movement_type', 'movementType']));
    const vendor = normalizeText(firstDefined(body, ['vendor', 'companyName']));
    const sourceWarehouseId = await validateWarehouse(
      c.env.DB,
      firstDefined(body, ['source_warehouse_id', 'sourceWarehouseId']),
      'Source',
      ownership,
    );
    const destinationWarehouseId = await validateWarehouse(
      c.env.DB,
      firstDefined(body, ['destination_warehouse_id', 'destinationWarehouseId']),
      'Destination',
      ownership,
    );
    const marketId = await validateMarket(c.env.DB, firstDefined(body, ['market_id', 'marketId']), true, ownership);
    const contactId = await validateContact(c.env.DB, firstDefined(body, ['contact_id', 'contactId']), ownership);
    let partId = await resolvePart(c.env.DB, body, vendor, ownership);
    const lineItems = await prepareLineItems(
      c.env.DB,
      body,
      partId,
      vendor,
      sourceWarehouseId,
      destinationWarehouseId,
      ownership,
    );
    if (!partId && lineItems.length > 0) partId = lineItems[0].partId;

    const quantityRaw = firstDefined(body, ['quantity', 'qty']);
    let quantity = parsePositiveInteger(quantityRaw);
    if (!quantity && lineItems.length > 0) {
      quantity = lineItems.reduce((sum, item) => sum + item.quantity, 0);
    }
    if (!quantity) return c.json({ success: false, error: 'quantity must be a positive integer' }, 400);

    const unitPriceRaw = firstDefined(body, ['unit_price_usd', 'unitPrice', 'unit_price']);
    let unitPrice = hasValue(unitPriceRaw) ? parseNonNegativeNumber(unitPriceRaw) : null;
    if (hasValue(unitPriceRaw) && unitPrice === null) {
      return c.json({ success: false, error: 'unit_price_usd must be zero or greater' }, 400);
    }
    if (unitPrice === null) {
      const total = lineItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
      unitPrice = quantity > 0 && total > 0 ? total / quantity : 0;
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await c.env.DB.prepare(`
      INSERT INTO transactions (
        id, tenant_id, company_id, date, movement_type, quantity, unit_price_usd,
        vendor, part_id, serial_number, condition,
        po_number, po_file_key, po_file_name,
        market_id, source_warehouse_id, destination_warehouse_id,
        project_id, contact_id, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      ownership.tenantId,
      ownership.companyId,
      date,
      movementType,
      quantity,
      unitPrice,
      vendor,
      partId,
      normalizeText(firstDefined(body, ['serial_number', 'serialNumber'])),
      normalizeText(firstDefined(body, ['condition'])),
      normalizeText(firstDefined(body, ['po_number', 'poNumber'])),
      normalizeText(firstDefined(body, ['po_file_key', 'poFileKey'])),
      normalizeText(firstDefined(body, ['po_file_name', 'poFileName'])),
      marketId,
      sourceWarehouseId,
      destinationWarehouseId,
      normalizeText(firstDefined(body, ['project_id', 'projectId'])),
      contactId,
      user.id,
      now,
      now,
    ).run();

    await insertLineItems(c.env.DB, id, lineItems, now, ownership);
    await logAudit(c.env.DB, user.id, 'CREATE_TRANSACTION', 'transactions', id);

    return c.json({ success: true, id }, 201);
  } catch (err) {
    if (err instanceof ValidationError) {
      return c.json({ success: false, error: err.message }, 400);
    }
    console.error('POST /transactions error:', err);
    return c.json({ success: false, error: 'Failed to create transaction' }, 500);
  }
});

// ============================================================================
// PUT /api/transactions/:id
// ============================================================================
transactionsRoutes.put('/:id', requirePermission(Permission.EDIT_TRANSACTIONS), async (c) => {
  try {
    const user = c.get('user');
    const scope = await resolveTenantScope(c);
    const scopeWhere = scopedWhere(scope, 'tenant_id', 'company_id');
    const ownership = scopeInsertValues(scope, user);
    const id = c.req.param('id')!;
    const body = await c.req.json<IncomingBody>();

    const existing = await c.env.DB.prepare(`
      SELECT id, part_id, vendor, source_warehouse_id, destination_warehouse_id
      FROM transactions
      WHERE id = ? AND ${scopeWhere.clause}
    `).bind(id, ...scopeWhere.params).first<{
      id: string;
      part_id: string | null;
      vendor: string | null;
      source_warehouse_id: string | null;
      destination_warehouse_id: string | null;
    }>();
    if (!existing) return c.json({ success: false, error: 'Transaction not found' }, 404);

    const sets: string[] = [];
    const params: SQLValue[] = [];
    const touchedColumns = new Set<string>();

    const setColumn = (column: string, value: SQLValue) => {
      sets.push(`${column} = ?`);
      params.push(value);
      touchedColumns.add(column);
    };

    if (Object.prototype.hasOwnProperty.call(body, 'date')) {
      const date = normalizeText(body.date);
      if (!date) return c.json({ success: false, error: 'date is required' }, 400);
      setColumn('date', date);
    }

    const movementRaw = firstDefined(body, ['movement_type', 'movementType']);
    if (movementRaw !== undefined) setColumn('movement_type', requireMovementType(movementRaw));

    const quantityRaw = firstDefined(body, ['quantity', 'qty']);
    if (quantityRaw !== undefined) {
      const quantity = parsePositiveInteger(quantityRaw);
      if (!quantity) return c.json({ success: false, error: 'quantity must be a positive integer' }, 400);
      setColumn('quantity', quantity);
    }

    const unitPriceRaw = firstDefined(body, ['unit_price_usd', 'unitPrice', 'unit_price']);
    if (unitPriceRaw !== undefined) {
      const unitPrice = hasValue(unitPriceRaw) ? parseNonNegativeNumber(unitPriceRaw) : 0;
      if (unitPrice === null) return c.json({ success: false, error: 'unit_price_usd must be zero or greater' }, 400);
      setColumn('unit_price_usd', unitPrice);
    }

    const partWasProvided =
      firstDefined(body, ['part_id', 'partId', 'part_number', 'partNumber']) !== undefined;
    let currentPartId = existing.part_id;
    if (partWasProvided) {
      currentPartId = await resolvePart(c.env.DB, body, firstDefined(body, ['vendor', 'companyName']) ?? existing.vendor, ownership);
      setColumn('part_id', currentPartId);
    }

    const simpleTextFields: Array<[string[], string]> = [
      [['vendor', 'companyName'], 'vendor'],
      [['serial_number', 'serialNumber'], 'serial_number'],
      [['condition'], 'condition'],
      [['po_number', 'poNumber'], 'po_number'],
      [['po_file_key', 'poFileKey'], 'po_file_key'],
      [['po_file_name', 'poFileName'], 'po_file_name'],
      [['project_id', 'projectId'], 'project_id'],
    ];

    for (const [keys, column] of simpleTextFields) {
      const raw = firstDefined(body, keys);
      if (raw !== undefined) setColumn(column, normalizeText(raw));
    }

    const marketRaw = firstDefined(body, ['market_id', 'marketId']);
    if (marketRaw !== undefined) setColumn('market_id', await validateMarket(c.env.DB, marketRaw, false, ownership));

    const sourceWarehouseRaw = firstDefined(body, ['source_warehouse_id', 'sourceWarehouseId']);
    let sourceWarehouseId = existing.source_warehouse_id;
    if (sourceWarehouseRaw !== undefined) {
      sourceWarehouseId = await validateWarehouse(c.env.DB, sourceWarehouseRaw, 'Source', ownership);
      setColumn('source_warehouse_id', sourceWarehouseId);
    }

    const destinationWarehouseRaw = firstDefined(body, ['destination_warehouse_id', 'destinationWarehouseId']);
    let destinationWarehouseId = existing.destination_warehouse_id;
    if (destinationWarehouseRaw !== undefined) {
      destinationWarehouseId = await validateWarehouse(c.env.DB, destinationWarehouseRaw, 'Destination', ownership);
      setColumn('destination_warehouse_id', destinationWarehouseId);
    }

    const contactRaw = firstDefined(body, ['contact_id', 'contactId']);
    if (contactRaw !== undefined) setColumn('contact_id', await validateContact(c.env.DB, contactRaw, ownership));

    const lineItems = await prepareLineItems(
      c.env.DB,
      body,
      currentPartId,
      firstDefined(body, ['vendor', 'companyName']) ?? existing.vendor,
      sourceWarehouseId,
      destinationWarehouseId,
      ownership,
    );
    const shouldReplaceLineItems = incomingItems(body).length > 0;

    if (shouldReplaceLineItems) {
      const itemQuantity = lineItems.reduce((sum, item) => sum + item.quantity, 0);
      const itemTotal = lineItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
      if (!touchedColumns.has('quantity')) setColumn('quantity', itemQuantity);
      if (!touchedColumns.has('unit_price_usd')) {
        setColumn('unit_price_usd', itemQuantity > 0 ? itemTotal / itemQuantity : 0);
      }
    }

    if (sets.length === 0 && !shouldReplaceLineItems) {
      return c.json({ success: false, error: 'No fields to update' }, 400);
    }

    if (sets.length > 0) {
      setColumn('updated_at', new Date().toISOString());
      await c.env.DB.prepare(`UPDATE transactions SET ${sets.join(', ')} WHERE id = ? AND ${scopeWhere.clause}`)
        .bind(...params, id, ...scopeWhere.params)
        .run();
    }

    if (shouldReplaceLineItems) {
      const now = new Date().toISOString();
      await c.env.DB.prepare('DELETE FROM transaction_items WHERE transaction_id = ?').bind(id).run();
      await insertLineItems(c.env.DB, id, lineItems, now, ownership);
    }

    await logAudit(c.env.DB, user.id, 'UPDATE_TRANSACTION', 'transactions', id);
    return c.json({ success: true });
  } catch (err) {
    if (err instanceof ValidationError) {
      return c.json({ success: false, error: err.message }, 400);
    }
    console.error('PUT /transactions/:id error:', err);
    return c.json({ success: false, error: 'Failed to update transaction' }, 500);
  }
});

// ============================================================================
// DELETE /api/transactions/:id
// ============================================================================
transactionsRoutes.delete('/:id', requirePermission(Permission.DELETE_TRANSACTIONS), async (c) => {
  try {
    const user = c.get('user');
    const scope = await resolveTenantScope(c);
    const scopeWhere = scopedWhere(scope, 'tenant_id', 'company_id');
    const id = c.req.param('id')!;

    const existing = await c.env.DB.prepare(`SELECT id FROM transactions WHERE id = ? AND ${scopeWhere.clause}`)
      .bind(id, ...scopeWhere.params)
      .first<{ id: string }>();
    if (!existing) return c.json({ success: false, error: 'Transaction not found' }, 404);

    await c.env.DB.prepare('DELETE FROM transaction_items WHERE transaction_id = ?').bind(id).run();
    await c.env.DB.prepare(`DELETE FROM transactions WHERE id = ? AND ${scopeWhere.clause}`)
      .bind(id, ...scopeWhere.params)
      .run();
    await logAudit(c.env.DB, user.id, 'DELETE_TRANSACTION', 'transactions', id);
    return c.json({ success: true });
  } catch (err) {
    console.error('DELETE /transactions/:id error:', err);
    return c.json({ success: false, error: 'Failed to delete transaction' }, 500);
  }
});
