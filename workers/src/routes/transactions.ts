/**
 * Transactions routes - Cirtell transaction workspace.
 * Tenant/company scoped, with enriched reference data and optional line items.
 */

import { Hono } from 'hono';
import type { Env } from '../index';
import { authMiddleware, logAudit, type User } from '../middleware/auth';
import { requirePermission, Permission } from '../middleware/permissions';
import { appendScopeCondition, resolveTenantScope, scopeInsertValues, scopedWhere } from '../middleware/tenantScope';
import {
  allocateTransactionInventoryMovements,
  type AppliedInventoryMovement,
  buildTransactionInventoryMovements,
  buildTransactionReversalMovements,
  InventorySyncError,
  type PreparedInventoryMovementBatch,
  prepareInventoryMovementBatch,
  preflightInventoryMovements,
  type InventoryMovementInput,
  type TransactionInventoryItemInput,
  type TransactionMovementType,
} from '../services/inventorySync';

type Variables = { user: User };
type SQLValue = string | number | null;

type IncomingBody = Record<string, unknown>;

interface PreparedLineItem {
  id: string;
  partId: string | null;
  serialNumber: string | null;
  condition: string | null;
  quantity: number;
  unitPrice: number;
  sourceWarehouseId: string | null;
  destinationWarehouseId: string | null;
  notes: string | null;
}

interface TransactionUpdateRow {
  id: string;
  date: string;
  movement_type: TransactionMovementType;
  quantity: number;
  unit_price_usd: number;
  vendor: string | null;
  part_id: string | null;
  serial_number: string | null;
  condition: string | null;
  po_number: string | null;
  po_file_key: string | null;
  po_file_name: string | null;
  market_id: string | null;
  source_warehouse_id: string | null;
  destination_warehouse_id: string | null;
  project_id: string | null;
  contact_id: string | null;
  tenant_id: string | null;
  company_id: string | null;
  inventory_sync_status: string;
  inventory_sync_version: number;
  inventory_sync_error: string | null;
}

interface StoredLineItem {
  id: string;
  part_id: string | null;
  condition: string | null;
  quantity: number;
  source_warehouse_id: string | null;
  destination_warehouse_id: string | null;
}

interface BackfillTransactionRow extends TransactionUpdateRow {
  created_at: string;
  voided_at: string | null;
}

type BackfillClassification =
  | 'eligible'
  | 'not_ready'
  | 'insufficient_stock'
  | 'double_count_risk';

interface BackfillResult {
  transactionId: string;
  date: string;
  createdAt: string;
  classification: BackfillClassification;
  reason: string | null;
  movementCount: number;
  applied?: boolean;
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
  status: number;
  code?: string;

  constructor(message: string, status = 400, code?: string) {
    super(message);
    this.name = 'ValidationError';
    this.status = status;
    this.code = code;
  }
}

const MOVEMENT_TYPES = ['Purchase', 'Sale', 'Redeploy', 'Recycle'] as const;
const TRANSACTION_PO_FILE_LIMIT_BYTES = 10 * 1024 * 1024;
const PO_FILE_TOO_LARGE_RESPONSE = {
  success: false,
  error: 'Purchase order file exceeds the 10 MB limit',
  code: 'PO_FILE_TOO_LARGE',
};
const ALLOWED_PO_CONTENT_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);
const ALLOWED_PO_EXTENSIONS = new Set(['pdf', 'jpg', 'jpeg', 'png', 'doc', 'docx', 'xls', 'xlsx']);

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
  const base = name.split(/[\\/]/).pop() || '';
  return base
    .replace(/[\r\n]/g, '')
    .replace(/[^\w.\- \u0080-\uFFFF]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180) || 'purchase-order';
}

function isUploadedFile(value: unknown): value is UploadedFile {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<UploadedFile>;
  return typeof candidate.name === 'string'
    && typeof candidate.size === 'number'
    && typeof candidate.arrayBuffer === 'function';
}

function fileExtension(fileName: string): string {
  const match = /\.([^.]+)$/.exec(fileName);
  return match ? match[1].toLowerCase() : '';
}

function isAllowedPoContentType(contentType: string, fileName: string): boolean {
  const normalized = contentType.toLowerCase();
  if (ALLOWED_PO_CONTENT_TYPES.has(normalized)) return true;
  // Some browsers and test adapters send uploaded Office/PDF files as octet-stream.
  // Only allow that fallback when the sanitized filename has an approved extension.
  return normalized === 'application/octet-stream' && ALLOWED_PO_EXTENSIONS.has(fileExtension(fileName));
}

function validatePoFile(file: UploadedFile): { fileName: string; contentType: string } {
  const fileName = safeFileName(file.name);
  const contentType = normalizeText(file.type)?.toLowerCase() || 'application/octet-stream';

  if (!normalizeText(file.name)) {
    throw new ValidationError('Purchase order filename is required', 400, 'PO_FILE_NAME_REQUIRED');
  }
  if (!file.size || file.size <= 0) {
    throw new ValidationError('Purchase order file is empty', 400, 'PO_FILE_EMPTY');
  }
  if (file.size > TRANSACTION_PO_FILE_LIMIT_BYTES) {
    throw new ValidationError(PO_FILE_TOO_LARGE_RESPONSE.error, 413, PO_FILE_TOO_LARGE_RESPONSE.code);
  }
  if (!isAllowedPoContentType(contentType, fileName)) {
    throw new ValidationError(
      'Purchase order file type is not allowed',
      415,
      'PO_FILE_TYPE_NOT_ALLOWED',
    );
  }

  return { fileName, contentType };
}

function rfc5987Encode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function contentDispositionAttachment(fileName: string): string {
  const sanitized = safeFileName(fileName);
  const fallback = sanitized.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '').trim() || 'purchase-order';
  return `attachment; filename="${fallback}"; filename*=UTF-8''${rfc5987Encode(sanitized)}`;
}

async function blobBytes(value: unknown): Promise<Uint8Array> {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    return new Uint8Array(await value.arrayBuffer());
  }
  if (Array.isArray(value)) return Uint8Array.from(value);
  if (typeof value === 'string') return new TextEncoder().encode(value);
  throw new Error('Unexpected D1 BLOB type');
}

async function findOrCreateVendor(db: D1Database, vendorName: unknown, ownership: ScopeValues): Promise<string | null> {
  const name = normalizeText(vendorName);
  if (!name) return null;

  const ownerWhere = ownershipClause(ownership);
  const existing = await db.prepare(
    `SELECT id FROM vendors WHERE LOWER(TRIM(vendor_name)) = LOWER(TRIM(?)) AND ${ownerWhere.clause}`,
  ).bind(name, ...ownerWhere.params).first<{ id: string }>();
  if (existing) return existing.id;

  const id = crypto.randomUUID();
  try {
    await db.prepare(
      'INSERT INTO vendors (id, tenant_id, company_id, vendor_name, created_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(id, ownership.tenantId, ownership.companyId, name, new Date().toISOString()).run();
  } catch (err) {
    if (isUniqueConstraintError(err, ['ux_vendors_scope_name'])) {
      throw new ValidationError(
        'Vendor already exists in the current company',
        409,
        'DUPLICATE_VENDOR_NAME',
      );
    }
    throw err;
  }
  return id;
}

function ownershipClause(values: ScopeValues, alias = ''): { clause: string; params: SQLValue[] } {
  const prefix = alias ? `${alias}.` : '';
  if (values.tenantId && values.companyId) {
    return {
      clause: `${prefix}tenant_id = ? AND ${prefix}company_id = ?`,
      params: [values.tenantId, values.companyId],
    };
  }
  if (values.companyId) return { clause: `${prefix}company_id = ?`, params: [values.companyId] };
  if (values.tenantId) return { clause: `${prefix}tenant_id = ?`, params: [values.tenantId] };
  return { clause: '1=0', params: [] };
}

function isUniqueConstraintError(err: unknown, indexNames: string[]): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  return lower.includes('unique constraint')
    || indexNames.some((name) => lower.includes(name.toLowerCase()));
}

function auditDetails(details: Record<string, unknown>): string {
  return JSON.stringify(details);
}

function auditInsertStatement(
  db: D1Database,
  userId: string,
  action: string,
  resource: string,
  resourceId: string,
  ownership: ScopeValues,
  details?: string | null,
): D1PreparedStatement {
  return db.prepare(`
    INSERT INTO audit_log (
      id, user_id, action, resource_type, resource_id, details, created_at, tenant_id, company_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    userId,
    action,
    resource,
    resourceId,
    details || null,
    new Date().toISOString(),
    ownership.tenantId,
    ownership.companyId,
  );
}

function automaticMovementAuditStatements(
  db: D1Database,
  userId: string,
  ownership: ScopeValues,
  transactionId: string,
  movements: AppliedInventoryMovement[],
  phase: 'create' | 'update' | 'void' | 'backfill',
): D1PreparedStatement[] {
  return movements
    .filter((movement) => !movement.idempotent)
    .map((movement) => auditInsertStatement(
      db,
      userId,
      'INVENTORY_MOVE_AUTO',
      'inventory_movements',
      movement.id,
      ownership,
      auditDetails({ transactionId, phase }),
    ));
}

async function logTransactionStockSyncFailed(
  db: D1Database,
  user: User | null,
  transactionId: string | null,
  ownership: ScopeValues | null,
  err: InventorySyncError,
): Promise<void> {
  if (!user || !transactionId || !ownership) return;
  try {
    await auditInsertStatement(
      db,
      user.id,
      'TRANSACTION_STOCK_SYNC_FAILED',
      'transactions',
      transactionId,
      ownership,
      auditDetails({ code: err.code, status: err.status, message: err.message }),
    ).run();
  } catch (auditErr) {
    console.error('Transaction stock sync failure audit failed:', auditErr);
  }
}

function requireTransactionScope(ownership: ScopeValues): ScopeValues {
  if (!ownership.companyId && !ownership.tenantId) {
    throw new InventorySyncError(
      'Tenant or company scope is required for transaction inventory sync',
      'MISSING_TRANSACTION_SCOPE',
      403,
    );
  }
  return ownership;
}

async function resolvePart(
  db: D1Database,
  input: IncomingBody,
  fallbackVendor: unknown,
  ownership: ScopeValues,
  createIfMissing = true,
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
    `SELECT id FROM parts WHERE LOWER(TRIM(part_number)) = LOWER(TRIM(?)) AND ${ownerWhere.clause}`,
  ).bind(partNumber, ...ownerWhere.params).first<{ id: string }>();
  if (existing) return existing.id;
  if (!createIfMissing) return null;

  const vendorId = await findOrCreateVendor(db, firstDefined(input, ['vendor', 'companyName']) ?? fallbackVendor, ownership);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const partName = normalizeText(firstDefined(input, ['part_name', 'partName', 'model_name', 'modelName'])) || partNumber;
  const technology = normalizeText(firstDefined(input, ['technology', 'technology_type', 'technologyType']));
  const category = normalizeText(firstDefined(input, ['category'])) || 'Network Equipment';

  try {
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
  } catch (err) {
    if (isUniqueConstraintError(err, ['ux_parts_scope_part_number'])) {
      throw new ValidationError(
        'Part number already exists in the current company',
        409,
        'DUPLICATE_PART_NUMBER',
      );
    }
    throw err;
  }

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

async function validateMarketId(db: D1Database, value: unknown, ownership: ScopeValues): Promise<string | null> {
  const ownerWhere = ownershipClause(ownership);
  const id = normalizeText(value);
  if (id) {
    const row = await db.prepare(`SELECT id FROM markets WHERE id = ? AND ${ownerWhere.clause}`)
      .bind(id, ...ownerWhere.params)
      .first<{ id: string }>();
    if (!row) throw new ValidationError('Market not found');
    return id;
  }

  return null;
}

async function findOrCreateMarketByName(db: D1Database, value: unknown, ownership: ScopeValues): Promise<string | null> {
  const marketName = normalizeText(value);
  if (!marketName) return null;

  const ownerWhere = ownershipClause(ownership);
  const existing = await db.prepare(`
    SELECT id
    FROM markets
    WHERE LOWER(TRIM(market_name)) = LOWER(TRIM(?))
      AND ${ownerWhere.clause}
  `).bind(marketName, ...ownerWhere.params).first<{ id: string }>();
  if (existing) return existing.id;

  const id = `market_${crypto.randomUUID()}`;
  try {
    await db.prepare(`
      INSERT INTO markets (id, tenant_id, company_id, market_name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(id, ownership.tenantId, ownership.companyId, marketName, new Date().toISOString(), new Date().toISOString()).run();
  } catch (err) {
    if (isUniqueConstraintError(err, ['ux_markets_scope_name'])) {
      throw new ValidationError(
        'Market already exists in the current company',
        409,
        'DUPLICATE_MARKET_NAME',
      );
    }
    throw err;
  }

  return id;
}

async function resolveMarket(db: D1Database, body: IncomingBody, useDefault: boolean, ownership: ScopeValues): Promise<string | null> {
  const marketId = firstDefined(body, ['market_id', 'marketId']);
  if (marketId !== undefined) return validateMarketId(db, marketId, ownership);

  const marketName = firstDefined(body, ['market_name', 'marketName', 'market']);
  if (marketName !== undefined) return findOrCreateMarketByName(db, marketName, ownership);

  if (!useDefault) return null;
  const ownerWhere = ownershipClause(ownership);
  const fallback = await db.prepare(
    `SELECT id FROM markets WHERE ${ownerWhere.clause} ORDER BY CASE WHEN id = 'global' THEN 0 ELSE 1 END, market_name LIMIT 1`,
  ).bind(...ownerWhere.params).first<{ id: string }>();
  return fallback?.id || null;
}

async function validateProject(db: D1Database, value: unknown, ownership: ScopeValues): Promise<string | null> {
  const id = normalizeText(value);
  if (!id) return null;
  const ownerWhere = ownershipClause(ownership);
  const row = await db.prepare(`SELECT id FROM projects WHERE id = ? AND ${ownerWhere.clause}`)
    .bind(id, ...ownerWhere.params)
    .first<{ id: string }>();
  if (!row) throw new ValidationError('Project not found', 404);
  return id;
}

function incomingItems(body: IncomingBody): IncomingBody[] {
  const raw = firstDefined(body, ['items', 'transaction_items', 'transactionItems', 'line_items', 'lineItems']);
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is IncomingBody => typeof item === 'object' && item !== null && !Array.isArray(item));
}

async function prepareLineItems(
  db: D1Database,
  body: IncomingBody,
  fallbackVendor: unknown,
  ownership: ScopeValues,
  createMissingParts = true,
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
      firstDefined(item, ['source_warehouse_id', 'sourceWarehouseId']),
      'Source',
      ownership,
    );
    const destinationWarehouseId = await validateWarehouse(
      db,
      firstDefined(item, ['destination_warehouse_id', 'destinationWarehouseId']),
      'Destination',
      ownership,
    );

    prepared.push({
      id: crypto.randomUUID(),
      partId: await resolvePart(db, item, fallbackVendor, ownership, createMissingParts),
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
    await lineItemInsertStatement(db, transactionId, item, now, ownership).run();
  }
}

function lineItemInsertStatement(
  db: D1Database,
  transactionId: string,
  item: PreparedLineItem,
  now: string,
  ownership: ScopeValues,
): D1PreparedStatement {
  return db.prepare(`
    INSERT INTO transaction_items (
      id, tenant_id, company_id, transaction_id, part_id, serial_number, condition, quantity,
      unit_price_usd, source_warehouse_id, destination_warehouse_id,
      notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    item.id,
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
  );
}

function preparedLineItemsForSync(lineItems: PreparedLineItem[]): TransactionInventoryItemInput[] {
  return lineItems.map((item) => ({
    id: item.id,
    partId: item.partId,
    quantity: item.quantity,
    condition: item.condition,
    sourceWarehouseId: item.sourceWarehouseId,
    destinationWarehouseId: item.destinationWarehouseId,
  }));
}

function storedLineItemsForSync(lineItems: StoredLineItem[]): TransactionInventoryItemInput[] {
  return lineItems.map((item) => ({
    id: item.id,
    partId: item.part_id,
    quantity: item.quantity,
    condition: item.condition,
    sourceWarehouseId: item.source_warehouse_id,
    destinationWarehouseId: item.destination_warehouse_id,
  }));
}

async function loadActiveStoredLineItems(
  db: D1Database,
  transactionId: string,
  ownership: ScopeValues,
): Promise<StoredLineItem[]> {
  const lineItemScope = ownershipClause(ownership, 'ti');
  const { results } = await db.prepare(`
    SELECT
      ti.id, ti.part_id, ti.condition, ti.quantity,
      ti.source_warehouse_id, ti.destination_warehouse_id
    FROM transaction_items ti
    WHERE ti.transaction_id = ?
      AND ti.superseded_at IS NULL
      AND ${lineItemScope.clause}
    ORDER BY ti.created_at, ti.id
  `).bind(transactionId, ...lineItemScope.params).all<StoredLineItem>();
  return results || [];
}

function boolFromBody(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  const text = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(text)) return true;
  if (['false', '0', 'no', 'n'].includes(text)) return false;
  return fallback;
}

function idListFromBody(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalizeText(item)).filter((item): item is string => !!item);
}

function backfillIdempotencyMovements(movements: InventoryMovementInput[]): InventoryMovementInput[] {
  const counters = new Map<string, number>();
  return movements.map((movement) => {
    if (movement.syncSource !== 'backfill' || !movement.transactionId) return movement;

    const itemKey = movement.transactionItemId || 'header';
    const baseKey = `backfill:${movement.transactionId}:${itemKey}`;
    const chunk = counters.get(baseKey) || 0;
    counters.set(baseKey, chunk + 1);
    return {
      ...movement,
      idempotencyKey: `${baseKey}:${chunk}`,
    };
  });
}

function movementWarehouseRiskClause(movement: InventoryMovementInput): { clause: string; params: SQLValue[] } | null {
  if (movement.movementType === 'Receive' && movement.toWarehouseId) {
    return { clause: '(movement_type = ? AND to_warehouse_id = ?)', params: ['Receive', movement.toWarehouseId] };
  }
  if (movement.movementType === 'Ship' && movement.fromWarehouseId) {
    return { clause: '(movement_type = ? AND from_warehouse_id = ?)', params: ['Ship', movement.fromWarehouseId] };
  }
  if (movement.movementType === 'Transfer' && movement.fromWarehouseId && movement.toWarehouseId) {
    return {
      clause: '(movement_type = ? AND from_warehouse_id = ? AND to_warehouse_id = ?)',
      params: ['Transfer', movement.fromWarehouseId, movement.toWarehouseId],
    };
  }
  return null;
}

async function hasManualDoubleCountRisk(
  db: D1Database,
  transaction: BackfillTransactionRow,
  movements: InventoryMovementInput[],
  ownership: ScopeValues,
): Promise<boolean> {
  const riskClauses: string[] = [];
  const riskParams: SQLValue[] = [];
  for (const movement of movements) {
    const warehouseRisk = movementWarehouseRiskClause(movement);
    if (!warehouseRisk) continue;
    riskClauses.push(`(part_id = ? AND ${warehouseRisk.clause})`);
    riskParams.push(movement.partId, ...warehouseRisk.params);
  }
  if (riskClauses.length === 0) return false;

  const scoped = ownershipClause(ownership);
  const row = await db.prepare(`
    SELECT id
    FROM inventory_movements
    WHERE ${scoped.clause}
      AND sync_source = 'manual'
      AND DATE(created_at) = DATE(?)
      AND (${riskClauses.join(' OR ')})
    LIMIT 1
  `).bind(...scoped.params, transaction.date, ...riskParams).first<{ id: string }>();
  return !!row;
}

function transactionOwnership(
  transaction: { tenant_id: string | null; company_id: string | null },
  fallback: ScopeValues,
): ScopeValues {
  return requireTransactionScope({
    tenantId: transaction.tenant_id || fallback.tenantId,
    companyId: transaction.company_id || fallback.companyId,
  });
}

async function buildBackfillCandidate(
  db: D1Database,
  transaction: BackfillTransactionRow,
  ownership: ScopeValues,
  startingMovements: InventoryMovementInput[],
): Promise<{ result: BackfillResult; movements: InventoryMovementInput[] }> {
  const lineItems = await loadActiveStoredLineItems(db, transaction.id, ownership);
  const syncVersion = (transaction.inventory_sync_version || 0) + 1;
  const syncPlan = buildTransactionInventoryMovements({
    id: transaction.id,
    movementType: transaction.movement_type,
    date: transaction.date,
    partId: transaction.part_id,
    quantity: transaction.quantity,
    condition: transaction.condition,
    sourceWarehouseId: transaction.source_warehouse_id,
    destinationWarehouseId: transaction.destination_warehouse_id,
    syncVersion,
    syncSource: 'backfill',
    items: storedLineItemsForSync(lineItems),
  });

  if (!syncPlan.ready) {
    return {
      result: {
        transactionId: transaction.id,
        date: transaction.date,
        createdAt: transaction.created_at,
        classification: 'not_ready',
        reason: syncPlan.reason || 'Transaction is not ready for inventory sync',
        movementCount: 0,
      },
      movements: [],
    };
  }

  try {
    const doubleCountRisk = await hasManualDoubleCountRisk(db, transaction, syncPlan.movements, ownership);
    const allocatedMovements = await allocateTransactionInventoryMovements(
      db,
      syncPlan.movements,
      ownership,
      { startingMovements },
    );
    const movements = backfillIdempotencyMovements(allocatedMovements);
    await prepareInventoryMovementBatch(db, [...startingMovements, ...movements], ownership);

    return {
      result: {
        transactionId: transaction.id,
        date: transaction.date,
        createdAt: transaction.created_at,
        classification: doubleCountRisk ? 'double_count_risk' : 'eligible',
        reason: doubleCountRisk
          ? 'Matching manual inventory movement exists for the transaction date, part, and warehouse direction'
          : null,
        movementCount: movements.length,
      },
      movements,
    };
  } catch (err) {
    if (err instanceof InventorySyncError && err.code === 'INSUFFICIENT_STOCK') {
      return {
        result: {
          transactionId: transaction.id,
          date: transaction.date,
          createdAt: transaction.created_at,
          classification: 'insufficient_stock',
          reason: err.message,
          movementCount: 0,
        },
        movements: [],
      };
    }
    if (err instanceof InventorySyncError) {
      return {
        result: {
          transactionId: transaction.id,
          date: transaction.date,
          createdAt: transaction.created_at,
          classification: 'not_ready',
          reason: err.message,
          movementCount: 0,
        },
        movements: [],
      };
    }
    throw err;
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
    WHERE superseded_at IS NULL
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
    t.inventory_sync_status AS inventorySyncStatus,
    t.voided_at AS voidedAt,
    t.voided_by AS voidedBy,
    t.created_at AS createdAt,
    t.updated_at AS updatedAt
`;

// ============================================================================
// Reference routes used by the Cirtell transaction UI
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
      WHERE ti.transaction_id = ?
        AND ti.superseded_at IS NULL
        AND ${scopeWhere.clause.replaceAll('tenant_id', 'ti.tenant_id').replaceAll('company_id', 'ti.company_id')}
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
        AND COALESCE(inventory_sync_status, 'not_ready') <> 'voided'
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
    const transactionId = c.req.query('transaction_id')?.trim();
    const movementType = c.req.query('movement_type') || c.req.query('type');
    const startDate = c.req.query('start_date');
    const endDate = c.req.query('end_date');
    const marketId = c.req.query('market_id');
    const includeVoided = ['true', '1', 'yes'].includes(
      (c.req.query('include_voided') || c.req.query('includeVoided') || '').toLowerCase(),
    );
    const limit = Math.min(parseInt(c.req.query('limit') || '100', 10), 500);
    const offset = Math.max(parseInt(c.req.query('offset') || '0', 10), 0);

    const params: SQLValue[] = [];
    const conditions: string[] = [];
    appendScopeCondition(conditions, params, scope, 't.tenant_id', 't.company_id');
    if (!includeVoided) {
      conditions.push("COALESCE(t.inventory_sync_status, 'not_ready') <> 'voided'");
    }

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
    if (transactionId) {
      conditions.push('t.id = ?');
      params.push(transactionId);
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
// POST /api/transactions/inventory-backfill - controlled dry-run/apply
// ============================================================================
transactionsRoutes.post('/inventory-backfill', requirePermission(Permission.MANAGE_INVENTORY_SYNC), async (c) => {
  try {
    const user = c.get('user');
    const scope = await resolveTenantScope(c);
    const requestOwnership = scopeInsertValues(scope, user);
    let body: IncomingBody = {};
    try {
      body = await c.req.json<IncomingBody>();
    } catch {
      body = {};
    }

    const dryRun = boolFromBody(firstDefined(body, ['dryRun', 'dry_run']), true);
    const allowDoubleCountRisk = boolFromBody(
      firstDefined(body, ['allowDoubleCountRisk', 'allow_double_count_risk']),
      false,
    );
    const limit = Math.min(parsePositiveInteger(firstDefined(body, ['limit'])) || 100, 500);
    const transactionIds = idListFromBody(firstDefined(body, ['transactionIds', 'transaction_ids']));

    const params: SQLValue[] = [];
    const conditions: string[] = [
      "COALESCE(inventory_sync_status, 'not_ready') IN ('not_ready', 'failed', 'backfill_pending')",
      'voided_at IS NULL',
    ];
    appendScopeCondition(conditions, params, scope, 'tenant_id', 'company_id');
    if (transactionIds.length > 0) {
      conditions.push(`id IN (${transactionIds.map(() => '?').join(', ')})`);
      params.push(...transactionIds);
    }

    const { results: rows } = await c.env.DB.prepare(`
      SELECT
        id, date, movement_type, quantity, unit_price_usd, vendor, part_id,
        serial_number, condition, po_number, po_file_key, po_file_name,
        market_id, source_warehouse_id, destination_warehouse_id,
        project_id, contact_id, tenant_id, company_id,
        inventory_sync_status, inventory_sync_version, inventory_sync_error,
        created_at, voided_at
      FROM transactions
      WHERE ${conditions.join(' AND ')}
      ORDER BY date ASC, created_at ASC
      LIMIT ?
    `).bind(...params, limit).all<BackfillTransactionRow>();

    const results: BackfillResult[] = [];
    const simulatedMovements: InventoryMovementInput[] = [];

    for (const transaction of rows || []) {
      let ownership: ScopeValues;
      try {
        ownership = transactionOwnership(transaction, requestOwnership);
      } catch (err) {
        if (err instanceof InventorySyncError) {
          results.push({
            transactionId: transaction.id,
            date: transaction.date,
            createdAt: transaction.created_at,
            classification: 'not_ready',
            reason: err.message,
            movementCount: 0,
            applied: false,
          });
          continue;
        }
        throw err;
      }
      const startingMovements = dryRun ? simulatedMovements : [];
      const candidate = await buildBackfillCandidate(
        c.env.DB,
        transaction,
        ownership,
        startingMovements,
      );
      const result: BackfillResult = { ...candidate.result, applied: false };

      if (dryRun) {
        if (
          candidate.result.classification === 'eligible'
          || (candidate.result.classification === 'double_count_risk' && allowDoubleCountRisk)
        ) {
          simulatedMovements.push(...candidate.movements);
        }
        results.push(result);
        continue;
      }

      const shouldApply = candidate.result.classification === 'eligible'
        || (candidate.result.classification === 'double_count_risk' && allowDoubleCountRisk);
      if (!shouldApply) {
        results.push(result);
        continue;
      }

      const now = new Date().toISOString();
      const movements = candidate.movements.map((movement) => ({
        ...movement,
        createdBy: user.id,
        createdAt: now,
      }));
      const inventoryBatch = await prepareInventoryMovementBatch(c.env.DB, movements, ownership);
      const nextSyncVersion = (transaction.inventory_sync_version || 0) + 1;
      const updateScope = ownershipClause(ownership);
      await c.env.DB.batch([
        ...inventoryBatch.statements,
        c.env.DB.prepare(`
          UPDATE transactions
          SET inventory_sync_status = 'synced',
              inventory_sync_version = ?,
              inventory_synced_at = ?,
              inventory_sync_error = NULL,
              updated_at = ?
          WHERE id = ? AND ${updateScope.clause}
        `).bind(nextSyncVersion, now, now, transaction.id, ...updateScope.params),
        ...automaticMovementAuditStatements(
          c.env.DB,
          user.id,
          ownership,
          transaction.id,
          inventoryBatch.movements,
          'backfill',
        ),
      ]);

      result.applied = true;
      results.push(result);
    }

    const summary = {
      total: results.length,
      eligible: results.filter((item) => item.classification === 'eligible').length,
      notReady: results.filter((item) => item.classification === 'not_ready').length,
      insufficientStock: results.filter((item) => item.classification === 'insufficient_stock').length,
      doubleCountRisk: results.filter((item) => item.classification === 'double_count_risk').length,
      applied: results.filter((item) => item.applied === true).length,
    };

    await logAudit(
      c.env.DB,
      user.id,
      dryRun ? 'DRY_RUN_TRANSACTION_INVENTORY_BACKFILL' : 'APPLY_TRANSACTION_INVENTORY_BACKFILL',
      'transactions',
      'inventory-backfill',
      JSON.stringify({ summary, limit, allowDoubleCountRisk }),
    );

    return c.json({
      success: true,
      dryRun,
      allowDoubleCountRisk,
      summary,
      results,
    });
  } catch (err) {
    if (err instanceof InventorySyncError) {
      const status = err.status === 409 ? 409 : err.status === 403 ? 403 : err.status === 404 ? 404 : 400;
      return c.json({ success: false, error: err.message, code: err.code }, status);
    }
    console.error('POST /transactions/inventory-backfill error:', err);
    return c.json({ success: false, error: 'Failed to run transaction inventory backfill' }, 500);
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
    const existing = await c.env.DB.prepare(`
      SELECT id, tenant_id, company_id, po_file_name, po_file_key
      FROM transactions
      WHERE id = ? AND ${scopeWhere.clause}
    `)
      .bind(id, ...scopeWhere.params)
      .first<{
        id: string;
        tenant_id: string | null;
        company_id: string | null;
        po_file_name: string | null;
        po_file_key: string | null;
      }>();
    if (!existing) return c.json({ success: false, error: 'Transaction not found', code: 'TRANSACTION_NOT_FOUND' }, 404);

    const existingFile = await c.env.DB.prepare(
      'SELECT transaction_id FROM transaction_po_files WHERE transaction_id = ?',
    ).bind(id).first<{ transaction_id: string }>();

    const formData = await c.req.formData();
    const file = formData.get('file');
    if (!isUploadedFile(file)) {
      return c.json({ success: false, error: 'Purchase order file is required', code: 'PO_FILE_REQUIRED' }, 400);
    }

    const { fileName, contentType } = validatePoFile(file);
    const fileData = new Uint8Array(await file.arrayBuffer());
    const now = new Date().toISOString();
    const poFileKey = `d1:${id}`;

    await c.env.DB.batch([
      c.env.DB.prepare(`
        INSERT INTO transaction_po_files (
          transaction_id, file_name, content_type, file_data, uploaded_by, uploaded_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(transaction_id) DO UPDATE SET
          file_name = excluded.file_name,
          content_type = excluded.content_type,
          file_data = excluded.file_data,
          uploaded_by = excluded.uploaded_by,
          uploaded_at = excluded.uploaded_at
      `).bind(id, fileName, contentType, fileData, user.id, now),
      c.env.DB.prepare(`
        UPDATE transactions
        SET po_file_key = ?, po_file_name = ?, updated_at = ?
        WHERE id = ? AND ${scopeWhere.clause}
      `).bind(poFileKey, fileName, now, id, ...scopeWhere.params),
    ]);

    const replacedExistingFile = Boolean(existingFile);
    await logAudit(
      c.env.DB,
      user.id,
      'UPLOAD_TRANSACTION_PO',
      'transaction',
      id,
      auditDetails({
        fileName,
        contentType,
        sizeBytes: file.size,
        replacedExistingFile,
      }),
      existing.tenant_id ?? scope.tenantId,
      existing.company_id ?? scope.companyId,
    );
    return c.json({
      success: true,
      data: {
        transactionId: id,
        fileName,
        contentType,
        sizeBytes: file.size,
        uploadedAt: now,
        replaced: replacedExistingFile,
      },
    }, replacedExistingFile ? 200 : 201);
  } catch (err) {
    if (err instanceof ValidationError) {
      if (err.code === PO_FILE_TOO_LARGE_RESPONSE.code) {
        return c.json(PO_FILE_TOO_LARGE_RESPONSE, 413);
      }
      return c.json({ success: false, error: err.message, code: err.code }, err.status as 400 | 413 | 415);
    }
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
    const transactionScope = scopedWhere(scope, 'tenant_id', 'company_id');
    const fileScope = scopedWhere(scope, 't.tenant_id', 't.company_id');
    const id = c.req.param('id')!;
    const existing = await c.env.DB.prepare(`SELECT id FROM transactions WHERE id = ? AND ${transactionScope.clause}`)
      .bind(id, ...transactionScope.params)
      .first<{ id: string }>();
    if (!existing) return c.json({ success: false, error: 'Transaction not found', code: 'TRANSACTION_NOT_FOUND' }, 404);

    const row = await c.env.DB.prepare(`
      SELECT pf.file_name AS fileName, pf.content_type AS contentType, pf.file_data AS fileData
      FROM transaction_po_files pf
      JOIN transactions t ON t.id = pf.transaction_id
      WHERE pf.transaction_id = ? AND ${fileScope.clause}
    `).bind(id, ...fileScope.params).first<{ fileName: string; contentType: string; fileData: unknown }>();

    if (!row) {
      return c.json({
        success: false,
        error: 'Purchase order file not found',
        code: 'PO_FILE_NOT_FOUND',
      }, 404);
    }

    const bytes = await blobBytes(row.fileData);
    const headers = new Headers();
    headers.set('Content-Type', row.contentType || 'application/octet-stream');
    headers.set('Content-Length', String(bytes.byteLength));
    headers.set('Content-Disposition', contentDispositionAttachment(row.fileName || 'purchase-order'));
    headers.set('Cache-Control', 'private, no-store');
    headers.set('X-Content-Type-Options', 'nosniff');

    return new Response(bytes, { headers });
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
  let auditUser: User | null = null;
  let auditOwnership: ScopeValues | null = null;
  let auditTransactionId: string | null = null;
  try {
    const user = c.get('user');
    auditUser = user;
    const scope = await resolveTenantScope(c);
    const ownership = requireTransactionScope(scopeInsertValues(scope, user));
    auditOwnership = ownership;
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
    const marketId = await resolveMarket(c.env.DB, body, true, ownership);
    const contactId = await validateContact(c.env.DB, firstDefined(body, ['contact_id', 'contactId']), ownership);
    const projectId = await validateProject(c.env.DB, firstDefined(body, ['project_id', 'projectId']), ownership);
    const createMissingParts = movementType === 'Purchase';
    let partId = await resolvePart(c.env.DB, body, vendor, ownership, createMissingParts);
    const lineItems = await prepareLineItems(
      c.env.DB,
      body,
      vendor,
      ownership,
      createMissingParts,
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
    auditTransactionId = id;
    const now = new Date().toISOString();
    const headerCondition = normalizeText(firstDefined(body, ['condition']));
    const syncPlan = buildTransactionInventoryMovements({
      id,
      movementType: movementType as TransactionMovementType,
      date,
      partId,
      quantity,
      condition: headerCondition,
      sourceWarehouseId,
      destinationWarehouseId,
      syncVersion: 1,
      syncSource: 'transaction',
      items: lineItems.map((item) => ({
        id: item.id,
        partId: item.partId,
        quantity: item.quantity,
        condition: item.condition,
        sourceWarehouseId: item.sourceWarehouseId,
        destinationWarehouseId: item.destinationWarehouseId,
      })),
    });

    const allocatedSyncMovements = syncPlan.ready
      ? await allocateTransactionInventoryMovements(c.env.DB, syncPlan.movements, ownership)
      : [];

    if (syncPlan.ready) {
      await preflightInventoryMovements(c.env.DB, allocatedSyncMovements, ownership);
    }

    const inventoryBatch = syncPlan.ready
      ? await prepareInventoryMovementBatch(c.env.DB, allocatedSyncMovements.map((movement) => ({
        ...movement,
        createdBy: user.id,
        createdAt: now,
      })), ownership)
      : { statements: [], movements: [] };

    const inventorySyncStatus = syncPlan.ready ? 'synced' : 'not_ready';
    const inventorySyncError = syncPlan.ready
      ? null
      : syncPlan.reason || 'Transaction is not ready for inventory sync';
    const statements: D1PreparedStatement[] = [];

    statements.push(c.env.DB.prepare(`
      INSERT INTO transactions (
        id, tenant_id, company_id, date, movement_type, quantity, unit_price_usd,
        vendor, part_id, serial_number, condition,
        po_number, po_file_key, po_file_name,
        market_id, source_warehouse_id, destination_warehouse_id,
        project_id, contact_id, created_by, created_at, updated_at,
        inventory_sync_status, inventory_sync_version, inventory_synced_at, inventory_sync_error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      headerCondition,
      normalizeText(firstDefined(body, ['po_number', 'poNumber'])),
      normalizeText(firstDefined(body, ['po_file_key', 'poFileKey'])),
      normalizeText(firstDefined(body, ['po_file_name', 'poFileName'])),
      marketId,
      sourceWarehouseId,
      destinationWarehouseId,
      projectId,
      contactId,
      user.id,
      now,
      now,
      inventorySyncStatus,
      syncPlan.ready ? 1 : 0,
      syncPlan.ready ? now : null,
      inventorySyncError,
    ));

    for (const item of lineItems) {
      statements.push(lineItemInsertStatement(c.env.DB, id, item, now, ownership));
    }
    statements.push(...inventoryBatch.statements);
    statements.push(auditInsertStatement(
      c.env.DB,
      user.id,
      'TRANSACTION_CREATE',
      'transactions',
      id,
      ownership,
      auditDetails({ inventorySyncStatus, inventorySyncError }),
    ));
    statements.push(...automaticMovementAuditStatements(
      c.env.DB,
      user.id,
      ownership,
      id,
      inventoryBatch.movements,
      'create',
    ));

    await c.env.DB.batch(statements);

    return c.json({
      success: true,
      id,
      inventorySyncStatus,
      inventorySyncError,
    }, 201);
  } catch (err) {
    if (err instanceof ValidationError) {
      return c.json({
        success: false,
        error: err.message,
        ...(err.code ? { code: err.code } : {}),
      }, err.status as any);
    }
    if (err instanceof InventorySyncError) {
      await logTransactionStockSyncFailed(c.env.DB, auditUser, auditTransactionId, auditOwnership, err);
      const status = err.status === 409 ? 409 : err.status === 403 ? 403 : err.status === 404 ? 404 : 400;
      return c.json({ success: false, error: err.message, code: err.code }, status);
    }
    console.error('POST /transactions error:', err);
    return c.json({ success: false, error: 'Failed to create transaction' }, 500);
  }
});

// ============================================================================
// PUT /api/transactions/:id
// ============================================================================
transactionsRoutes.put('/:id', requirePermission(Permission.EDIT_TRANSACTIONS), async (c) => {
  let auditUser: User | null = null;
  let auditOwnership: ScopeValues | null = null;
  let auditTransactionId: string | null = null;
  try {
    const user = c.get('user');
    auditUser = user;
    const scope = await resolveTenantScope(c);
    const scopeWhere = scopedWhere(scope, 'tenant_id', 'company_id');
    const requestOwnership = scopeInsertValues(scope, user);
    const id = c.req.param('id')!;
    auditTransactionId = id;
    const body = await c.req.json<IncomingBody>();

    const existing = await c.env.DB.prepare(`
      SELECT
        id, date, movement_type, quantity, unit_price_usd, vendor, part_id,
        serial_number, condition, po_number, po_file_key, po_file_name,
        market_id, source_warehouse_id, destination_warehouse_id,
        project_id, contact_id, tenant_id, company_id,
        inventory_sync_status, inventory_sync_version, inventory_sync_error
      FROM transactions
      WHERE id = ? AND ${scopeWhere.clause}
    `).bind(id, ...scopeWhere.params).first<TransactionUpdateRow>();
    if (!existing) return c.json({ success: false, error: 'Transaction not found' }, 404);

    const transactionOwnership: ScopeValues = {
      tenantId: existing.tenant_id || requestOwnership.tenantId,
      companyId: existing.company_id || requestOwnership.companyId,
    };
    auditOwnership = transactionOwnership;
    const lineItemScope = ownershipClause(transactionOwnership, 'ti');
    const { results: existingLineItemRows } = await c.env.DB.prepare(`
      SELECT
        ti.id, ti.part_id, ti.condition, ti.quantity,
        ti.source_warehouse_id, ti.destination_warehouse_id
      FROM transaction_items ti
      WHERE ti.transaction_id = ?
        AND ti.superseded_at IS NULL
        AND ${lineItemScope.clause}
      ORDER BY ti.created_at, ti.id
    `).bind(id, ...lineItemScope.params).all<StoredLineItem>();
    const existingLineItems = existingLineItemRows || [];

    const next = { ...existing };
    const nextValues = next as unknown as Record<string, SQLValue>;
    const sets: string[] = [];
    const params: SQLValue[] = [];
    const touchedColumns = new Set<string>();

    const setColumn = (column: string, value: SQLValue) => {
      sets.push(`${column} = ?`);
      params.push(value);
      touchedColumns.add(column);
      nextValues[column] = value;
    };

    if (Object.prototype.hasOwnProperty.call(body, 'date')) {
      const date = normalizeText(body.date);
      if (!date) return c.json({ success: false, error: 'date is required' }, 400);
      setColumn('date', date);
    }

    const movementRaw = firstDefined(body, ['movement_type', 'movementType']);
    if (movementRaw !== undefined) {
      setColumn('movement_type', requireMovementType(movementRaw) as TransactionMovementType);
    }

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
    if (partWasProvided) {
      const createMissingParts = next.movement_type === 'Purchase';
      const partId = await resolvePart(
        c.env.DB,
        body,
        firstDefined(body, ['vendor', 'companyName']) ?? existing.vendor,
        transactionOwnership,
        createMissingParts,
      );
      setColumn('part_id', partId);
    }

    const simpleTextFields: Array<[string[], string]> = [
      [['vendor', 'companyName'], 'vendor'],
      [['serial_number', 'serialNumber'], 'serial_number'],
      [['condition'], 'condition'],
      [['po_number', 'poNumber'], 'po_number'],
      [['po_file_key', 'poFileKey'], 'po_file_key'],
      [['po_file_name', 'poFileName'], 'po_file_name'],
    ];

    for (const [keys, column] of simpleTextFields) {
      const raw = firstDefined(body, keys);
      if (raw !== undefined) setColumn(column, normalizeText(raw));
    }

    const marketRaw = firstDefined(body, ['market_id', 'marketId']);
    const marketNameRaw = firstDefined(body, ['market_name', 'marketName', 'market']);
    if (marketRaw !== undefined || marketNameRaw !== undefined) {
      setColumn('market_id', await resolveMarket(c.env.DB, body, false, transactionOwnership));
    }

    const sourceWarehouseRaw = firstDefined(body, ['source_warehouse_id', 'sourceWarehouseId']);
    if (sourceWarehouseRaw !== undefined) {
      const sourceWarehouseId = await validateWarehouse(c.env.DB, sourceWarehouseRaw, 'Source', transactionOwnership);
      setColumn('source_warehouse_id', sourceWarehouseId);
    }

    const destinationWarehouseRaw = firstDefined(body, ['destination_warehouse_id', 'destinationWarehouseId']);
    if (destinationWarehouseRaw !== undefined) {
      const destinationWarehouseId = await validateWarehouse(c.env.DB, destinationWarehouseRaw, 'Destination', transactionOwnership);
      setColumn('destination_warehouse_id', destinationWarehouseId);
    }

    const contactRaw = firstDefined(body, ['contact_id', 'contactId']);
    if (contactRaw !== undefined) setColumn('contact_id', await validateContact(c.env.DB, contactRaw, transactionOwnership));

    const projectRaw = firstDefined(body, ['project_id', 'projectId']);
    if (projectRaw !== undefined) setColumn('project_id', await validateProject(c.env.DB, projectRaw, transactionOwnership));

    const shouldReplaceLineItems = incomingItems(body).length > 0;
    const lineItems = shouldReplaceLineItems
      ? await prepareLineItems(
        c.env.DB,
        body,
        firstDefined(body, ['vendor', 'companyName']) ?? next.vendor,
        transactionOwnership,
        next.movement_type === 'Purchase',
      )
      : [];

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

    const activeSyncItems = shouldReplaceLineItems
      ? preparedLineItemsForSync(lineItems)
      : storedLineItemsForSync(existingLineItems);
    const syncUsesLineItems = activeSyncItems.length > 0;
    const syncAffectingColumns = new Set<string>(['date', 'movement_type']);
    if (!syncUsesLineItems) {
      syncAffectingColumns.add('part_id');
      syncAffectingColumns.add('quantity');
      syncAffectingColumns.add('condition');
      syncAffectingColumns.add('source_warehouse_id');
      syncAffectingColumns.add('destination_warehouse_id');
    }
    const syncAffectingUpdate = shouldReplaceLineItems
      || [...syncAffectingColumns].some((column) => touchedColumns.has(column));

    const wasSynced = existing.inventory_sync_status === 'synced';
    const now = new Date().toISOString();
    let inventorySyncStatus = existing.inventory_sync_status;
    let inventorySyncError = existing.inventory_sync_error;
    let inventorySyncVersion = existing.inventory_sync_version || 0;
    let inventorySyncedAt: string | null | undefined;
    let inventoryBatch: PreparedInventoryMovementBatch = { statements: [], movements: [] };

    if (syncAffectingUpdate) {
      const targetSyncVersion = wasSynced || inventorySyncStatus !== 'synced'
        ? inventorySyncVersion + 1
        : inventorySyncVersion;
      const syncPlan = buildTransactionInventoryMovements({
        id,
        movementType: next.movement_type,
        date: next.date,
        partId: next.part_id,
        quantity: next.quantity,
        condition: next.condition,
        sourceWarehouseId: next.source_warehouse_id,
        destinationWarehouseId: next.destination_warehouse_id,
        syncVersion: targetSyncVersion,
        syncSource: 'transaction',
        items: activeSyncItems,
      });

      const reversalMovements = wasSynced
        ? await buildTransactionReversalMovements(c.env.DB, id, transactionOwnership, {
          createdBy: user.id,
          createdAt: now,
          syncVersion: targetSyncVersion,
          idempotencyPrefix: `reversal:update:${id}:v${targetSyncVersion}`,
        })
        : [];

      if (syncPlan.ready) {
        const allocatedSyncMovements = await allocateTransactionInventoryMovements(
          c.env.DB,
          syncPlan.movements,
          transactionOwnership,
          { startingMovements: reversalMovements },
        );
        inventoryBatch = await prepareInventoryMovementBatch(
          c.env.DB,
          [...reversalMovements, ...allocatedSyncMovements].map((movement) => ({
            ...movement,
            createdBy: movement.createdBy || user.id,
            createdAt: movement.createdAt || now,
          })),
          transactionOwnership,
        );

        inventorySyncStatus = 'synced';
        inventorySyncVersion = targetSyncVersion;
        inventorySyncedAt = now;
        inventorySyncError = null;
      } else if (wasSynced) {
        inventoryBatch = await prepareInventoryMovementBatch(
          c.env.DB,
          reversalMovements.map((movement) => ({
            ...movement,
            createdBy: movement.createdBy || user.id,
            createdAt: movement.createdAt || now,
          })),
          transactionOwnership,
        );

        inventorySyncStatus = 'not_ready';
        inventorySyncVersion = targetSyncVersion;
        inventorySyncedAt = null;
        inventorySyncError = syncPlan.reason || 'Transaction is not ready for inventory sync';
      } else {
        inventorySyncStatus = 'not_ready';
        inventorySyncError = syncPlan.reason || 'Transaction is not ready for inventory sync';
      }

      setColumn('inventory_sync_status', inventorySyncStatus);
      setColumn('inventory_sync_version', inventorySyncVersion);
      setColumn('inventory_synced_at', inventorySyncedAt === undefined ? null : inventorySyncedAt);
      setColumn('inventory_sync_error', inventorySyncError);
    }

    setColumn('updated_at', now);
    const statements: D1PreparedStatement[] = [
      c.env.DB.prepare(`UPDATE transactions SET ${sets.join(', ')} WHERE id = ? AND ${scopeWhere.clause}`)
        .bind(...params, id, ...scopeWhere.params),
    ];

    if (shouldReplaceLineItems) {
      statements.push(c.env.DB.prepare(`
        UPDATE transaction_items
        SET superseded_at = ?, updated_at = ?
        WHERE transaction_id = ?
          AND superseded_at IS NULL
          AND ${lineItemScope.clause}
      `).bind(now, now, id, ...lineItemScope.params));
      for (const item of lineItems) {
        statements.push(lineItemInsertStatement(c.env.DB, id, item, now, transactionOwnership));
      }
    }
    statements.push(...inventoryBatch.statements);
    statements.push(auditInsertStatement(
      c.env.DB,
      user.id,
      'TRANSACTION_UPDATE',
      'transactions',
      id,
      transactionOwnership,
      auditDetails({ inventorySyncStatus, inventorySyncError, syncAffectingUpdate }),
    ));
    statements.push(...automaticMovementAuditStatements(
      c.env.DB,
      user.id,
      transactionOwnership,
      id,
      inventoryBatch.movements,
      'update',
    ));

    await c.env.DB.batch(statements);
    return c.json({
      success: true,
      inventorySyncStatus,
      inventorySyncError,
    });
  } catch (err) {
    if (err instanceof ValidationError) {
      return c.json({
        success: false,
        error: err.message,
        ...(err.code ? { code: err.code } : {}),
      }, err.status as any);
    }
    if (err instanceof InventorySyncError) {
      await logTransactionStockSyncFailed(c.env.DB, auditUser, auditTransactionId, auditOwnership, err);
      const status = err.status === 409 ? 409 : err.status === 403 ? 403 : err.status === 404 ? 404 : 400;
      return c.json({ success: false, error: err.message, code: err.code }, status);
    }
    console.error('PUT /transactions/:id error:', err);
    return c.json({ success: false, error: 'Failed to update transaction' }, 500);
  }
});

// ============================================================================
// DELETE /api/transactions/:id
// ============================================================================
transactionsRoutes.delete('/:id', requirePermission(Permission.DELETE_TRANSACTIONS), async (c) => {
  let auditUser: User | null = null;
  let auditOwnership: ScopeValues | null = null;
  let auditTransactionId: string | null = null;
  try {
    const user = c.get('user');
    auditUser = user;
    const scope = await resolveTenantScope(c);
    const scopeWhere = scopedWhere(scope, 'tenant_id', 'company_id');
    const requestOwnership = scopeInsertValues(scope, user);
    const id = c.req.param('id')!;
    auditTransactionId = id;

    const existing = await c.env.DB.prepare(`
      SELECT
        id, tenant_id, company_id, inventory_sync_status,
        inventory_sync_version, voided_at
      FROM transactions
      WHERE id = ? AND ${scopeWhere.clause}
    `)
      .bind(id, ...scopeWhere.params)
      .first<{
        id: string;
        tenant_id: string | null;
        company_id: string | null;
        inventory_sync_status: string;
        inventory_sync_version: number;
        voided_at: string | null;
      }>();
    if (!existing) return c.json({ success: false, error: 'Transaction not found' }, 404);

    if (existing.inventory_sync_status === 'voided' || existing.voided_at) {
      return c.json({ success: true, inventorySyncStatus: 'voided' });
    }

    const transactionOwnership: ScopeValues = {
      tenantId: existing.tenant_id || requestOwnership.tenantId,
      companyId: existing.company_id || requestOwnership.companyId,
    };
    auditOwnership = transactionOwnership;
    const now = new Date().toISOString();
    const nextSyncVersion = existing.inventory_sync_status === 'synced'
      ? (existing.inventory_sync_version || 0) + 1
      : (existing.inventory_sync_version || 0);
    const reversalMovements = existing.inventory_sync_status === 'synced'
      ? await buildTransactionReversalMovements(c.env.DB, id, transactionOwnership, {
        createdBy: user.id,
        createdAt: now,
        syncVersion: nextSyncVersion,
        idempotencyPrefix: `reversal:void:${id}:v${nextSyncVersion}`,
      })
      : [];
    const inventoryBatch: PreparedInventoryMovementBatch = reversalMovements.length > 0
      ? await prepareInventoryMovementBatch(c.env.DB, reversalMovements, transactionOwnership)
      : { statements: [], movements: [] };

    const statements: D1PreparedStatement[] = [
      c.env.DB.prepare(`
        UPDATE transactions
        SET inventory_sync_status = 'voided',
            inventory_sync_version = ?,
            inventory_synced_at = NULL,
            inventory_sync_error = NULL,
            voided_at = ?,
            voided_by = ?,
            updated_at = ?
        WHERE id = ? AND ${scopeWhere.clause}
      `).bind(nextSyncVersion, now, user.id, now, id, ...scopeWhere.params),
      ...inventoryBatch.statements,
      auditInsertStatement(
        c.env.DB,
        user.id,
        'TRANSACTION_VOID',
        'transactions',
        id,
        transactionOwnership,
        auditDetails({ previousInventorySyncStatus: existing.inventory_sync_status }),
      ),
      ...automaticMovementAuditStatements(
        c.env.DB,
        user.id,
        transactionOwnership,
        id,
        inventoryBatch.movements,
        'void',
      ),
    ];

    await c.env.DB.batch(statements);

    return c.json({ success: true, inventorySyncStatus: 'voided' });
  } catch (err) {
    if (err instanceof InventorySyncError) {
      await logTransactionStockSyncFailed(c.env.DB, auditUser, auditTransactionId, auditOwnership, err);
      const status = err.status === 409 ? 409 : err.status === 403 ? 403 : err.status === 404 ? 404 : 400;
      return c.json({ success: false, error: err.message, code: err.code }, status);
    }
    console.error('DELETE /transactions/:id error:', err);
    return c.json({ success: false, error: 'Failed to delete transaction' }, 500);
  }
});
