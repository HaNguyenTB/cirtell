type SQLValue = string | number | null;

export type InventoryCondition = 'New' | 'Good' | 'Fair' | 'Poor' | 'Scrap';
export type InventoryMovementType = 'Receive' | 'Ship' | 'Transfer' | 'Adjust';
export type TransactionMovementType = 'Purchase' | 'Sale' | 'Redeploy' | 'Recycle';
export type InventorySyncSource = 'manual' | 'transaction' | 'backfill' | 'reversal';

export interface ScopeValues {
  tenantId: string | null;
  companyId: string | null;
}

export interface InventoryMovementInput {
  movementType: InventoryMovementType;
  partId: string;
  quantity: number;
  condition?: unknown;
  fromWarehouseId?: string | null;
  fromZoneId?: string | null;
  toWarehouseId?: string | null;
  toZoneId?: string | null;
  reference?: string | null;
  notes?: string | null;
  createdBy?: string | null;
  createdAt?: string | null;
  transactionId?: string | null;
  transactionItemId?: string | null;
  syncSource?: InventorySyncSource;
  syncVersion?: number;
  reversalOfMovementId?: string | null;
  idempotencyKey?: string | null;
  effectiveAt?: string | null;
}

export interface AppliedInventoryMovement {
  id: string;
  idempotent: boolean;
}

export interface TransactionInventoryItemInput {
  id?: string | null;
  partId?: string | null;
  quantity?: number | null;
  condition?: unknown;
  sourceWarehouseId?: string | null;
  destinationWarehouseId?: string | null;
}

export interface TransactionInventoryInput {
  id: string;
  movementType: TransactionMovementType;
  date: string;
  partId?: string | null;
  quantity?: number | null;
  condition?: unknown;
  sourceWarehouseId?: string | null;
  destinationWarehouseId?: string | null;
  syncVersion?: number;
  syncSource?: Extract<InventorySyncSource, 'transaction' | 'backfill'>;
  items?: TransactionInventoryItemInput[];
}

export interface TransactionInventoryBuildResult {
  ready: boolean;
  reason?: string;
  movements: InventoryMovementInput[];
}

interface InventoryRow {
  id: string;
  quantity: number;
}

interface InventoryMovementRow {
  id: string;
  from_warehouse_id: string | null;
  from_zone_id: string | null;
  to_warehouse_id: string | null;
  to_zone_id: string | null;
  part_id: string;
  quantity: number;
  movement_type: InventoryMovementType;
  reference: string | null;
  notes: string | null;
  created_by: string | null;
  tenant_id: string | null;
  company_id: string | null;
  transaction_id: string | null;
  transaction_item_id: string | null;
  condition: string | null;
  sync_source: InventorySyncSource | null;
  sync_version: number | null;
  effective_at: string | null;
}

interface PreparedMovement {
  id: string;
  input: InventoryMovementInput;
  movementType: InventoryMovementType;
  quantity: number;
  condition: InventoryCondition;
  now: string;
}

interface InventoryDelta {
  warehouseId: string;
  zoneId: string | null;
  partId: string;
  condition: InventoryCondition;
  quantityDelta: number;
}

interface AllocationCandidate {
  zoneId: string | null;
  available: number;
}

interface AllocationRow {
  zone_id: string | null;
  quantity: number;
}

const INVENTORY_CONDITIONS: InventoryCondition[] = ['New', 'Good', 'Fair', 'Poor', 'Scrap'];
const INVENTORY_MOVEMENT_TYPES: InventoryMovementType[] = ['Receive', 'Ship', 'Transfer', 'Adjust'];

export class InventorySyncError extends Error {
  status: number;
  code: string;

  constructor(message: string, code = 'INVENTORY_SYNC_ERROR', status = 400) {
    super(message);
    this.name = 'InventorySyncError';
    this.code = code;
    this.status = status;
  }
}

export class InsufficientStockError extends InventorySyncError {
  constructor(message = 'Insufficient stock') {
    super(message, 'INSUFFICIENT_STOCK', 409);
    this.name = 'InsufficientStockError';
  }
}

function normalizeText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function ownershipClause(values: ScopeValues, alias = ''): { clause: string; params: SQLValue[] } {
  const prefix = alias ? `${alias}.` : '';
  if (values.companyId) return { clause: `${prefix}company_id = ?`, params: [values.companyId] };
  if (values.tenantId) return { clause: `${prefix}tenant_id = ?`, params: [values.tenantId] };
  return { clause: '1=0', params: [] };
}

function requireScopedOwnership(ownership: ScopeValues): void {
  if (!ownership.tenantId && !ownership.companyId) {
    throw new InventorySyncError('Tenant or company scope is required for inventory changes', 'MISSING_SCOPE', 403);
  }
}

function requirePositiveInteger(value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new InventorySyncError('Quantity must be a positive integer', 'INVALID_QUANTITY');
  }
  return value;
}

export function normalizeInventoryCondition(value: unknown): InventoryCondition {
  const text = normalizeText(value);
  if (!text) return 'Good';

  const direct = INVENTORY_CONDITIONS.find((condition) => condition.toLowerCase() === text.toLowerCase());
  if (direct) return direct;

  const aliases: Record<string, InventoryCondition> = {
    nib: 'New',
    nob: 'New',
    used: 'Good',
    refurbished: 'Good',
    'as-is': 'Poor',
    asis: 'Poor',
  };
  const alias = aliases[text.toLowerCase()];
  if (alias) return alias;

  throw new InventorySyncError(
    `condition must be one of: ${INVENTORY_CONDITIONS.join(', ')}`,
    'INVALID_CONDITION',
  );
}

function normalizeMovementType(value: string): InventoryMovementType {
  const movementType = INVENTORY_MOVEMENT_TYPES.find((type) => type === value);
  if (!movementType) {
    throw new InventorySyncError(
      `movement_type must be: ${INVENTORY_MOVEMENT_TYPES.join(', ')}`,
      'INVALID_MOVEMENT_TYPE',
    );
  }
  return movementType;
}

async function validatePart(db: D1Database, partId: string, ownership: ScopeValues): Promise<void> {
  const scoped = ownershipClause(ownership);
  const row = await db.prepare(`SELECT id FROM parts WHERE id = ? AND ${scoped.clause}`)
    .bind(partId, ...scoped.params)
    .first<{ id: string }>();
  if (!row) throw new InventorySyncError('Part not found', 'PART_NOT_FOUND');
}

async function validateWarehouse(
  db: D1Database,
  warehouseId: string | null | undefined,
  label: string,
  ownership: ScopeValues,
): Promise<void> {
  if (!warehouseId) return;
  const scoped = ownershipClause(ownership);
  const row = await db.prepare(`SELECT id FROM warehouses WHERE id = ? AND ${scoped.clause}`)
    .bind(warehouseId, ...scoped.params)
    .first<{ id: string }>();
  if (!row) throw new InventorySyncError(`${label} warehouse not found`, 'WAREHOUSE_NOT_FOUND');
}

async function validateZone(
  db: D1Database,
  zoneId: string | null | undefined,
  warehouseId: string | null | undefined,
  label: string,
  ownership: ScopeValues,
): Promise<void> {
  if (!zoneId) return;
  if (!warehouseId) {
    throw new InventorySyncError(`${label} zone requires a warehouse`, 'ZONE_REQUIRES_WAREHOUSE');
  }

  const scoped = ownershipClause(ownership);
  const row = await db.prepare(`
    SELECT id FROM warehouse_zones
    WHERE id = ? AND warehouse_id = ? AND ${scoped.clause}
  `).bind(zoneId, warehouseId, ...scoped.params).first<{ id: string }>();
  if (!row) throw new InventorySyncError(`${label} zone not found`, 'ZONE_NOT_FOUND');
}

function validateEndpoints(input: InventoryMovementInput): void {
  if (input.movementType === 'Receive' && !input.toWarehouseId) {
    throw new InventorySyncError('to_warehouse_id is required for Receive', 'DESTINATION_WAREHOUSE_REQUIRED');
  }
  if (input.movementType === 'Ship' && !input.fromWarehouseId) {
    throw new InventorySyncError('from_warehouse_id is required for Ship', 'SOURCE_WAREHOUSE_REQUIRED');
  }
  if (input.movementType === 'Transfer' && (!input.fromWarehouseId || !input.toWarehouseId)) {
    throw new InventorySyncError('Both from/to warehouse required for Transfer', 'TRANSFER_WAREHOUSES_REQUIRED');
  }
  if (input.movementType === 'Adjust' && !input.fromWarehouseId && !input.toWarehouseId) {
    throw new InventorySyncError('At least one warehouse is required for Adjust', 'ADJUST_WAREHOUSE_REQUIRED');
  }
}

async function findInventoryRow(
  db: D1Database,
  ownership: ScopeValues,
  warehouseId: string,
  zoneId: string | null | undefined,
  partId: string,
  condition: InventoryCondition,
): Promise<InventoryRow | null> {
  const scoped = ownershipClause(ownership);
  const row = await db.prepare(`
    SELECT id, quantity FROM inventory
    WHERE warehouse_id = ? AND part_id = ? AND COALESCE(zone_id, '') = COALESCE(?, '')
      AND condition = ? AND ${scoped.clause}
    LIMIT 1
  `).bind(warehouseId, partId, zoneId || '', condition, ...scoped.params).first<InventoryRow>();
  return row || null;
}

async function requireStock(
  db: D1Database,
  ownership: ScopeValues,
  input: InventoryMovementInput,
  condition: InventoryCondition,
): Promise<InventoryRow | null> {
  if (!input.fromWarehouseId) return null;

  const row = await findInventoryRow(
    db,
    ownership,
    input.fromWarehouseId,
    input.fromZoneId,
    input.partId,
    condition,
  );

  if (!row || row.quantity < input.quantity) {
    throw new InsufficientStockError(
      `Insufficient stock for part ${input.partId} in source warehouse`,
    );
  }

  return row;
}

async function existingMovementByIdempotencyKey(
  db: D1Database,
  ownership: ScopeValues,
  idempotencyKey: string | null | undefined,
): Promise<{ id: string } | null> {
  if (!idempotencyKey) return null;
  const scoped = ownershipClause(ownership);
  const existing = await db.prepare(`
    SELECT id FROM inventory_movements
    WHERE idempotency_key = ? AND ${scoped.clause}
    LIMIT 1
  `).bind(idempotencyKey, ...scoped.params).first<{ id: string }>();
  return existing || null;
}

function inventoryDeltaKey(
  warehouseId: string,
  zoneId: string | null | undefined,
  partId: string,
  condition: InventoryCondition,
): string {
  return [warehouseId, zoneId || '', partId, condition].join('\u001f');
}

async function allocationCandidates(
  db: D1Database,
  ownership: ScopeValues,
  warehouseId: string,
  partId: string,
  condition: InventoryCondition,
): Promise<AllocationCandidate[]> {
  const scoped = ownershipClause(ownership);
  const { results } = await db.prepare(`
    SELECT zone_id, quantity
    FROM inventory
    WHERE warehouse_id = ? AND part_id = ? AND condition = ?
      AND quantity > 0 AND ${scoped.clause}
    ORDER BY CASE WHEN zone_id IS NULL THEN 0 ELSE 1 END,
             COALESCE(zone_id, ''),
             id
  `).bind(warehouseId, partId, condition, ...scoped.params).all<AllocationRow>();

  return (results || []).map((row) => ({
    zoneId: row.zone_id || null,
    available: row.quantity,
  }));
}

export async function allocateTransactionInventoryMovements(
  db: D1Database,
  movements: InventoryMovementInput[],
  ownership: ScopeValues,
): Promise<InventoryMovementInput[]> {
  requireScopedOwnership(ownership);

  const allocated: InventoryMovementInput[] = [];
  const candidateCache = new Map<string, AllocationCandidate[]>();

  for (const movement of movements) {
    const quantity = requirePositiveInteger(movement.quantity);
    const condition = normalizeInventoryCondition(movement.condition);

    if (!movement.fromWarehouseId || movement.fromZoneId) {
      allocated.push({
        ...movement,
        quantity,
        condition,
        fromZoneId: movement.fromZoneId || null,
        toZoneId: null,
      });
      continue;
    }

    const cacheKey = inventoryDeltaKey(
      movement.fromWarehouseId,
      null,
      movement.partId,
      condition,
    );
    let candidates = candidateCache.get(cacheKey);
    if (!candidates) {
      candidates = await allocationCandidates(
        db,
        ownership,
        movement.fromWarehouseId,
        movement.partId,
        condition,
      );
      candidateCache.set(cacheKey, candidates);
    }

    let remaining = quantity;
    let chunkIndex = 0;

    for (const candidate of candidates) {
      if (remaining <= 0) break;
      if (candidate.available <= 0) continue;

      const chunkQuantity = Math.min(candidate.available, remaining);
      candidate.available -= chunkQuantity;
      remaining -= chunkQuantity;

      allocated.push({
        ...movement,
        quantity: chunkQuantity,
        condition,
        fromZoneId: candidate.zoneId,
        toZoneId: null,
        idempotencyKey: movement.idempotencyKey
          ? `${movement.idempotencyKey}:chunk:${chunkIndex}:${candidate.zoneId || 'default'}`
          : null,
      });
      chunkIndex += 1;
    }

    if (remaining > 0) {
      throw new InsufficientStockError(
        `Insufficient stock for part ${movement.partId} in source warehouse`,
      );
    }
  }

  return allocated;
}

function addInventoryDelta(
  deltas: Map<string, InventoryDelta>,
  warehouseId: string,
  zoneId: string | null | undefined,
  partId: string,
  condition: InventoryCondition,
  quantityDelta: number,
): void {
  const key = inventoryDeltaKey(warehouseId, zoneId, partId, condition);
  const existing = deltas.get(key);
  if (existing) {
    existing.quantityDelta += quantityDelta;
    return;
  }
  deltas.set(key, {
    warehouseId,
    zoneId: zoneId || null,
    partId,
    condition,
    quantityDelta,
  });
}

async function prepareMovementForApply(
  db: D1Database,
  input: InventoryMovementInput,
  ownership: ScopeValues,
): Promise<PreparedMovement | null> {
  const existing = await existingMovementByIdempotencyKey(db, ownership, input.idempotencyKey);
  if (existing) return null;

  const movementType = normalizeMovementType(input.movementType);
  const normalizedInput = { ...input, movementType };
  const quantity = requirePositiveInteger(input.quantity);
  const condition = normalizeInventoryCondition(input.condition);

  validateEndpoints(normalizedInput);
  await validatePart(db, input.partId, ownership);
  await validateWarehouse(db, input.fromWarehouseId, 'Source', ownership);
  await validateWarehouse(db, input.toWarehouseId, 'Destination', ownership);
  await validateZone(db, input.fromZoneId, input.fromWarehouseId, 'Source', ownership);
  await validateZone(db, input.toZoneId, input.toWarehouseId, 'Destination', ownership);

  return {
    id: crypto.randomUUID(),
    input: normalizedInput,
    movementType,
    quantity,
    condition,
    now: input.createdAt || new Date().toISOString(),
  };
}

async function inventoryDeltasForMovements(
  db: D1Database,
  inputs: InventoryMovementInput[],
  ownership: ScopeValues,
): Promise<{ prepared: PreparedMovement[]; deltas: Map<string, InventoryDelta>; idempotent: AppliedInventoryMovement[] }> {
  requireScopedOwnership(ownership);

  const prepared: PreparedMovement[] = [];
  const idempotent: AppliedInventoryMovement[] = [];
  const deltas = new Map<string, InventoryDelta>();

  for (const input of inputs) {
    const existing = await existingMovementByIdempotencyKey(db, ownership, input.idempotencyKey);
    if (existing) {
      idempotent.push({ id: existing.id, idempotent: true });
      continue;
    }

    const movement = await prepareMovementForApply(db, input, ownership);
    if (!movement) continue;
    prepared.push(movement);

    if (movement.input.fromWarehouseId) {
      addInventoryDelta(
        deltas,
        movement.input.fromWarehouseId,
        movement.input.fromZoneId,
        movement.input.partId,
        movement.condition,
        -movement.quantity,
      );
    }
    if (movement.input.toWarehouseId) {
      addInventoryDelta(
        deltas,
        movement.input.toWarehouseId,
        movement.input.toZoneId,
        movement.input.partId,
        movement.condition,
        movement.quantity,
      );
    }
  }

  return { prepared, deltas, idempotent };
}

async function assertInventoryDeltasAvailable(
  db: D1Database,
  ownership: ScopeValues,
  deltas: Map<string, InventoryDelta>,
): Promise<void> {
  for (const delta of deltas.values()) {
    if (delta.quantityDelta >= 0) continue;

    const row = await findInventoryRow(
      db,
      ownership,
      delta.warehouseId,
      delta.zoneId,
      delta.partId,
      delta.condition,
    );
    const currentQuantity = row?.quantity || 0;
    if (currentQuantity + delta.quantityDelta < 0) {
      throw new InsufficientStockError(
        `Insufficient stock for part ${delta.partId} in source warehouse`,
      );
    }
  }
}

export async function preflightInventoryMovements(
  db: D1Database,
  inputs: InventoryMovementInput[],
  ownership: ScopeValues,
): Promise<void> {
  const { deltas } = await inventoryDeltasForMovements(db, inputs, ownership);
  await assertInventoryDeltasAvailable(db, ownership, deltas);
}

export async function applyInventoryMovements(
  db: D1Database,
  inputs: InventoryMovementInput[],
  ownership: ScopeValues,
): Promise<AppliedInventoryMovement[]> {
  const { prepared, deltas, idempotent } = await inventoryDeltasForMovements(db, inputs, ownership);
  if (prepared.length === 0) return idempotent;

  await assertInventoryDeltasAvailable(db, ownership, deltas);

  const statements: D1PreparedStatement[] = [];
  const updateNow = new Date().toISOString();

  for (const delta of deltas.values()) {
    if (delta.quantityDelta === 0) continue;

    const row = await findInventoryRow(
      db,
      ownership,
      delta.warehouseId,
      delta.zoneId,
      delta.partId,
      delta.condition,
    );

    if (row) {
      statements.push(
        db.prepare('UPDATE inventory SET quantity = quantity + ?, updated_at = ? WHERE id = ?')
          .bind(delta.quantityDelta, updateNow, row.id),
      );
    } else if (delta.quantityDelta > 0) {
      statements.push(
        db.prepare(`
          INSERT INTO inventory (id, tenant_id, company_id, warehouse_id, zone_id, part_id, quantity, condition, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          crypto.randomUUID(),
          ownership.tenantId,
          ownership.companyId,
          delta.warehouseId,
          delta.zoneId,
          delta.partId,
          delta.quantityDelta,
          delta.condition,
          updateNow,
        ),
      );
    } else {
      throw new InsufficientStockError(`Insufficient stock for part ${delta.partId} in source warehouse`);
    }
  }

  for (const movement of prepared) {
    statements.push(
      db.prepare(`
        INSERT INTO inventory_movements (
          id, from_warehouse_id, from_zone_id, to_warehouse_id, to_zone_id,
          part_id, tenant_id, company_id, quantity, movement_type, condition,
          reference, notes, created_by, created_at,
          transaction_id, transaction_item_id, sync_source, sync_version,
          reversal_of_movement_id, idempotency_key, effective_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        movement.id,
        movement.input.fromWarehouseId || null,
        movement.input.fromZoneId || null,
        movement.input.toWarehouseId || null,
        movement.input.toZoneId || null,
        movement.input.partId,
        ownership.tenantId,
        ownership.companyId,
        movement.quantity,
        movement.movementType,
        movement.condition,
        movement.input.reference || null,
        movement.input.notes || null,
        movement.input.createdBy || null,
        movement.now,
        movement.input.transactionId || null,
        movement.input.transactionItemId || null,
        movement.input.syncSource || 'manual',
        movement.input.syncVersion ?? 0,
        movement.input.reversalOfMovementId || null,
        movement.input.idempotencyKey || null,
        movement.input.effectiveAt || null,
      ),
    );
  }

  try {
    await db.batch(statements);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.toLowerCase().includes('check constraint')) {
      throw new InsufficientStockError();
    }
    throw err;
  }

  return [
    ...idempotent,
    ...prepared.map((movement) => ({ id: movement.id, idempotent: false })),
  ];
}

async function applyDestinationIncrement(
  db: D1Database,
  statements: D1PreparedStatement[],
  ownership: ScopeValues,
  input: InventoryMovementInput,
  condition: InventoryCondition,
  now: string,
): Promise<void> {
  if (!input.toWarehouseId) return;

  const destination = await findInventoryRow(
    db,
    ownership,
    input.toWarehouseId,
    input.toZoneId,
    input.partId,
    condition,
  );

  if (destination) {
    statements.push(
      db.prepare('UPDATE inventory SET quantity = quantity + ?, updated_at = ? WHERE id = ?')
        .bind(input.quantity, now, destination.id),
    );
    return;
  }

  statements.push(
    db.prepare(`
      INSERT INTO inventory (id, tenant_id, company_id, warehouse_id, zone_id, part_id, quantity, condition, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      ownership.tenantId,
      ownership.companyId,
      input.toWarehouseId,
      input.toZoneId || null,
      input.partId,
      input.quantity,
      condition,
      now,
    ),
  );
}

export async function applyInventoryMovement(
  db: D1Database,
  input: InventoryMovementInput,
  ownership: ScopeValues,
): Promise<AppliedInventoryMovement> {
  requireScopedOwnership(ownership);

  const movementType = normalizeMovementType(input.movementType);
  const normalizedInput = { ...input, movementType };
  const quantity = requirePositiveInteger(input.quantity);
  const condition = normalizeInventoryCondition(input.condition);

  const existing = await existingMovementByIdempotencyKey(db, ownership, input.idempotencyKey);
  if (existing) return { id: existing.id, idempotent: true };

  validateEndpoints(normalizedInput);
  await validatePart(db, input.partId, ownership);
  await validateWarehouse(db, input.fromWarehouseId, 'Source', ownership);
  await validateWarehouse(db, input.toWarehouseId, 'Destination', ownership);
  await validateZone(db, input.fromZoneId, input.fromWarehouseId, 'Source', ownership);
  await validateZone(db, input.toZoneId, input.toWarehouseId, 'Destination', ownership);

  const sourceInventory = await requireStock(db, ownership, { ...normalizedInput, quantity }, condition);
  const id = crypto.randomUUID();
  const now = input.createdAt || new Date().toISOString();
  const statements: D1PreparedStatement[] = [];

  if (sourceInventory) {
    statements.push(
      db.prepare('UPDATE inventory SET quantity = quantity - ?, updated_at = ? WHERE id = ?')
        .bind(quantity, now, sourceInventory.id),
    );
  }

  await applyDestinationIncrement(
    db,
    statements,
    ownership,
    { ...normalizedInput, quantity },
    condition,
    now,
  );

  statements.push(
    db.prepare(`
      INSERT INTO inventory_movements (
        id, from_warehouse_id, from_zone_id, to_warehouse_id, to_zone_id,
        part_id, tenant_id, company_id, quantity, movement_type, condition,
        reference, notes, created_by, created_at,
        transaction_id, transaction_item_id, sync_source, sync_version,
        reversal_of_movement_id, idempotency_key, effective_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      input.fromWarehouseId || null,
      input.fromZoneId || null,
      input.toWarehouseId || null,
      input.toZoneId || null,
      input.partId,
      ownership.tenantId,
      ownership.companyId,
      quantity,
      movementType,
      condition,
      input.reference || null,
      input.notes || null,
      input.createdBy || null,
      now,
      input.transactionId || null,
      input.transactionItemId || null,
      input.syncSource || 'manual',
      input.syncVersion ?? 0,
      input.reversalOfMovementId || null,
      input.idempotencyKey || null,
      input.effectiveAt || null,
    ),
  );

  try {
    await db.batch(statements);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (sourceInventory && message.toLowerCase().includes('check constraint')) {
      throw new InsufficientStockError(`Insufficient stock for part ${input.partId} in source warehouse`);
    }
    throw err;
  }

  return { id, idempotent: false };
}

export async function reverseInventoryMovement(
  db: D1Database,
  movementId: string,
  ownership: ScopeValues,
  options: {
    createdBy?: string | null;
    createdAt?: string | null;
    notes?: string | null;
    idempotencyKey?: string | null;
  } = {},
): Promise<AppliedInventoryMovement> {
  requireScopedOwnership(ownership);
  const scoped = ownershipClause(ownership, 'm');

  const existingReversal = await db.prepare(`
    SELECT id FROM inventory_movements m
    WHERE m.reversal_of_movement_id = ? AND ${scoped.clause}
    LIMIT 1
  `).bind(movementId, ...scoped.params).first<{ id: string }>();
  if (existingReversal) return { id: existingReversal.id, idempotent: true };

  const movement = await db.prepare(`
    SELECT
      m.id, m.from_warehouse_id, m.from_zone_id, m.to_warehouse_id, m.to_zone_id,
      m.part_id, m.quantity, m.movement_type, m.reference, m.notes, m.created_by,
      m.tenant_id, m.company_id, m.transaction_id, m.transaction_item_id,
      m.condition, m.sync_source, m.sync_version, m.effective_at
    FROM inventory_movements m
    WHERE m.id = ? AND ${scoped.clause}
  `).bind(movementId, ...scoped.params).first<InventoryMovementRow>();

  if (!movement) throw new InventorySyncError('Movement not found', 'MOVEMENT_NOT_FOUND', 404);

  const condition = normalizeInventoryCondition(movement.condition);
  let reversal: InventoryMovementInput;

  if (movement.movement_type === 'Receive') {
    reversal = {
      movementType: 'Ship',
      fromWarehouseId: movement.to_warehouse_id,
      fromZoneId: movement.to_zone_id,
      toWarehouseId: null,
      toZoneId: null,
      partId: movement.part_id,
      quantity: movement.quantity,
      condition,
    };
  } else if (movement.movement_type === 'Ship') {
    reversal = {
      movementType: 'Receive',
      fromWarehouseId: null,
      fromZoneId: null,
      toWarehouseId: movement.from_warehouse_id,
      toZoneId: movement.from_zone_id,
      partId: movement.part_id,
      quantity: movement.quantity,
      condition,
    };
  } else if (movement.movement_type === 'Transfer') {
    reversal = {
      movementType: 'Transfer',
      fromWarehouseId: movement.to_warehouse_id,
      fromZoneId: movement.to_zone_id,
      toWarehouseId: movement.from_warehouse_id,
      toZoneId: movement.from_zone_id,
      partId: movement.part_id,
      quantity: movement.quantity,
      condition,
    };
  } else if (movement.from_warehouse_id && movement.to_warehouse_id) {
    reversal = {
      movementType: 'Transfer',
      fromWarehouseId: movement.to_warehouse_id,
      fromZoneId: movement.to_zone_id,
      toWarehouseId: movement.from_warehouse_id,
      toZoneId: movement.from_zone_id,
      partId: movement.part_id,
      quantity: movement.quantity,
      condition,
    };
  } else if (movement.to_warehouse_id) {
    reversal = {
      movementType: 'Ship',
      fromWarehouseId: movement.to_warehouse_id,
      fromZoneId: movement.to_zone_id,
      toWarehouseId: null,
      toZoneId: null,
      partId: movement.part_id,
      quantity: movement.quantity,
      condition,
    };
  } else if (movement.from_warehouse_id) {
    reversal = {
      movementType: 'Receive',
      fromWarehouseId: null,
      fromZoneId: null,
      toWarehouseId: movement.from_warehouse_id,
      toZoneId: movement.from_zone_id,
      partId: movement.part_id,
      quantity: movement.quantity,
      condition,
    };
  } else {
    throw new InventorySyncError('Movement cannot be reversed because it has no warehouse endpoint', 'MOVEMENT_NOT_REVERSIBLE');
  }

  return applyInventoryMovement(db, {
    ...reversal,
    reference: movement.reference || `Reversal of ${movement.id}`,
    notes: options.notes || `Reversal of movement ${movement.id}`,
    createdBy: options.createdBy || movement.created_by,
    createdAt: options.createdAt || new Date().toISOString(),
    transactionId: movement.transaction_id,
    transactionItemId: movement.transaction_item_id,
    syncSource: 'reversal',
    syncVersion: movement.sync_version || 0,
    reversalOfMovementId: movement.id,
    idempotencyKey: options.idempotencyKey || `reversal:${movement.id}`,
    effectiveAt: movement.effective_at,
  }, ownership);
}

function transactionMovementType(type: TransactionMovementType): InventoryMovementType {
  if (type === 'Purchase') return 'Receive';
  if (type === 'Redeploy') return 'Transfer';
  return 'Ship';
}

function requiredWarehouseReason(
  type: TransactionMovementType,
  sourceWarehouseId: string | null | undefined,
  destinationWarehouseId: string | null | undefined,
): string | null {
  if (type === 'Purchase' && !destinationWarehouseId) return 'Purchase requires destination warehouse';
  if ((type === 'Sale' || type === 'Recycle') && !sourceWarehouseId) return `${type} requires source warehouse`;
  if (type === 'Redeploy' && (!sourceWarehouseId || !destinationWarehouseId)) {
    return 'Redeploy requires source and destination warehouse';
  }
  return null;
}

export function buildTransactionInventoryMovements(
  transaction: TransactionInventoryInput,
): TransactionInventoryBuildResult {
  const usesLineItems = !!transaction.items && transaction.items.length > 0;
  const rows: TransactionInventoryItemInput[] = usesLineItems
    ? transaction.items!
    : [{
      id: null,
      partId: transaction.partId || null,
      quantity: transaction.quantity || null,
      condition: transaction.condition,
      sourceWarehouseId: transaction.sourceWarehouseId || null,
      destinationWarehouseId: transaction.destinationWarehouseId || null,
    }];

  const movements: InventoryMovementInput[] = [];
  const syncVersion = transaction.syncVersion ?? 1;
  const syncSource = transaction.syncSource || 'transaction';

  for (const row of rows) {
    if (!row.partId) return { ready: false, reason: 'Transaction item requires part_id', movements: [] };
    if (!row.quantity || !Number.isInteger(row.quantity) || row.quantity <= 0) {
      return { ready: false, reason: 'Transaction item requires positive quantity', movements: [] };
    }

    const sourceWarehouseId = row.sourceWarehouseId || null;
    const destinationWarehouseId = row.destinationWarehouseId || null;
    const warehouseReason = requiredWarehouseReason(
      transaction.movementType,
      sourceWarehouseId,
      destinationWarehouseId,
    );
    if (warehouseReason) return { ready: false, reason: warehouseReason, movements: [] };

    const itemKey = row.id || 'header';
    movements.push({
      movementType: transactionMovementType(transaction.movementType),
      partId: row.partId,
      quantity: row.quantity,
      condition: row.condition ?? transaction.condition,
      fromWarehouseId: transaction.movementType === 'Purchase' ? null : sourceWarehouseId,
      toWarehouseId: transaction.movementType === 'Sale' || transaction.movementType === 'Recycle'
        ? null
        : destinationWarehouseId,
      reference: `Transaction ${transaction.id}`,
      transactionId: transaction.id,
      transactionItemId: row.id || null,
      syncSource,
      syncVersion,
      idempotencyKey: `${syncSource}:${transaction.id}:v${syncVersion}:${itemKey}`,
      effectiveAt: transaction.date,
    });
  }

  return { ready: true, movements };
}
