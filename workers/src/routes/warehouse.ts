/**
 * Warehouse Management Routes - tenant/company scoped
 * CRUD for warehouses, zones, inventory, and movements
 */

import { Hono } from 'hono';
import type { Env } from '../index';
import { authMiddleware, logAudit, type User } from '../middleware/auth';
import { requirePermission, Permission } from '../middleware/permissions';
import { appendScopeCondition, resolveTenantScope, scopeInsertValues, scopedWhere } from '../middleware/tenantScope';
import {
  allocateTransactionInventoryMovements,
  applyInventoryMovements,
  findInventoryMovementsByIdempotencyKey,
  InventorySyncError,
  type InventoryMovementInput,
  type InventoryMovementType,
} from '../services/inventorySync';

type Variables = { user: User };
type SQLValue = string | number | null;
type ScopeValues = { tenantId: string | null; companyId: string | null };

export const warehouseRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

warehouseRoutes.use('*', authMiddleware);

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

function duplicateWarehouseCodeResponse() {
  return {
    success: false,
    error: 'Warehouse code already exists in the current company',
    code: 'DUPLICATE_WAREHOUSE_CODE',
  };
}

function isUniqueConstraintError(err: unknown, indexNames: string[]): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  return lower.includes('unique constraint')
    || indexNames.some((name) => lower.includes(name.toLowerCase()));
}

const ZONE_TYPES = ['storage', 'staging', 'inspection', 'shipping', 'receiving'] as const;

function normalizeZoneInput(body: Record<string, unknown>) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const zoneType = typeof body.zone_type === 'string' ? body.zone_type.trim().toLowerCase() : 'storage';
  const rawCapacity = body.capacity_units;
  const capacityUnits = rawCapacity === '' || rawCapacity === null || rawCapacity === undefined
    ? null
    : Number(rawCapacity);
  return { name, zoneType, capacityUnits };
}

function validateZoneInput(input: ReturnType<typeof normalizeZoneInput>): string | null {
  if (!input.name) return 'Zone name is required';
  if (!ZONE_TYPES.includes(input.zoneType as (typeof ZONE_TYPES)[number])) {
    return `zone_type must be: ${ZONE_TYPES.join(', ')}`;
  }
  if (input.capacityUnits !== null && (!Number.isInteger(input.capacityUnits) || input.capacityUnits < 0)) {
    return 'Zone capacity must be a non-negative integer';
  }
  return null;
}
// ============================================================================
// WAREHOUSES
// ============================================================================

// GET /api/warehouses - list all warehouses
warehouseRoutes.get('/', requirePermission(Permission.VIEW_WAREHOUSE), async (c) => {
  try {
    const scope = await resolveTenantScope(c);
    const status = c.req.query('status');
    const params: any[] = [];
    const conditions: string[] = [];
    appendScopeCondition(conditions, params, scope, 'w.tenant_id', 'w.company_id');
    if (status) { conditions.push('w.status = ?'); params.push(status); }
    const where = `WHERE ${conditions.join(' AND ')}`;

    const { results } = await c.env.DB.prepare(`
      SELECT w.*,
        (SELECT COUNT(*) FROM warehouse_zones z WHERE z.warehouse_id = w.id) as zone_count,
        (SELECT COALESCE(SUM(i.quantity), 0) FROM inventory i WHERE i.warehouse_id = w.id) as total_units
      FROM warehouses w ${where}
      ORDER BY w.name ASC
    `).bind(...params).all();

    return c.json({ success: true, warehouses: results || [] });
  } catch (err: any) {
    console.error('GET /warehouses error:', err);
    return c.json({ success: false, error: 'Failed to fetch warehouses' }, 500);
  }
});

// GET /api/warehouses/zones/all - list scoped zones for selectors and management
warehouseRoutes.get('/zones/all', requirePermission(Permission.VIEW_WAREHOUSE), async (c) => {
  try {
    const scope = await resolveTenantScope(c);
    const warehouseId = c.req.query('warehouse_id');
    const params: SQLValue[] = [];
    const conditions: string[] = [];
    appendScopeCondition(conditions, params, scope, 'z.tenant_id', 'z.company_id');
    if (warehouseId) {
      conditions.push('z.warehouse_id = ?');
      params.push(warehouseId);
    }

    const { results } = await c.env.DB.prepare(`
      SELECT z.*, w.name AS warehouse_name, w.code AS warehouse_code,
        COALESCE(SUM(i.quantity), 0) AS total_units
      FROM warehouse_zones z
      JOIN warehouses w ON w.id = z.warehouse_id
      LEFT JOIN inventory i ON i.zone_id = z.id
      WHERE ${conditions.join(' AND ')}
      GROUP BY z.id
      ORDER BY w.name, z.name
    `).bind(...params).all();

    return c.json({ success: true, zones: results || [] });
  } catch (err) {
    console.error('GET /warehouses/zones/all error:', err);
    return c.json({ success: false, error: 'Failed to fetch warehouse zones' }, 500);
  }
});
// GET /api/warehouses/:id
warehouseRoutes.get('/:id', requirePermission(Permission.VIEW_WAREHOUSE), async (c) => {
  try {
    const scope = await resolveTenantScope(c);
    const scopeWhere = scopedWhere(scope, 'tenant_id', 'company_id');
    const id = c.req.param('id')!;
    const warehouse = await c.env.DB.prepare(`SELECT * FROM warehouses WHERE id = ? AND ${scopeWhere.clause}`)
      .bind(id, ...scopeWhere.params)
      .first();
    if (!warehouse) return c.json({ success: false, error: 'Warehouse not found' }, 404);

    const { results: zones } = await c.env.DB.prepare(
      'SELECT * FROM warehouse_zones WHERE warehouse_id = ? ORDER BY name',
    ).bind(id).all();

    return c.json({ success: true, warehouse, zones: zones || [] });
  } catch (err: any) {
    console.error('GET /warehouses/:id error:', err);
    return c.json({ success: false, error: 'Failed to fetch warehouse' }, 500);
  }
});

// POST /api/warehouses - create
warehouseRoutes.post('/', requirePermission(Permission.EDIT_WAREHOUSE), async (c) => {
  try {
    const user = c.get('user');
    const scope = await resolveTenantScope(c);
    const ownership = scopeInsertValues(scope, user);
    const body = await c.req.json();

    if (!body.name?.trim() || !body.code?.trim()) {
      return c.json({ success: false, error: 'Name and code are required' }, 400);
    }

    const normalizedCode = body.code.trim().toUpperCase();
    const ownerWhere = ownershipClause(ownership);
    const existing = await c.env.DB.prepare(`SELECT id FROM warehouses WHERE UPPER(TRIM(code)) = UPPER(TRIM(?)) AND ${ownerWhere.clause}`)
      .bind(normalizedCode, ...ownerWhere.params)
      .first();
    if (existing) return c.json(duplicateWarehouseCodeResponse(), 409);

    const initialZoneBody = body.initial_zone && typeof body.initial_zone === 'object'
      ? body.initial_zone as Record<string, unknown>
      : null;
    const initialZone = initialZoneBody?.name ? normalizeZoneInput(initialZoneBody) : null;
    if (initialZone) {
      const zoneError = validateZoneInput(initialZone);
      if (zoneError) return c.json({ success: false, error: zoneError }, 400);
    }

    const id = crypto.randomUUID();
    const zoneId = initialZone ? crypto.randomUUID() : null;
    const now = new Date().toISOString();
    const statements: D1PreparedStatement[] = [
      c.env.DB.prepare(`
        INSERT INTO warehouses (id, tenant_id, company_id, name, code, address, city, country, capacity_units, status, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        id, ownership.tenantId, ownership.companyId, body.name.trim(), normalizedCode,
        body.address?.trim() || null, body.city?.trim() || null, body.country?.trim() || null,
        body.capacity_units || null, body.status || 'active', body.notes?.trim() || null,
        now, now,
      ),
    ];
    if (initialZone && zoneId) {
      statements.push(c.env.DB.prepare(`
        INSERT INTO warehouse_zones (id, tenant_id, company_id, warehouse_id, name, zone_type, capacity_units, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        zoneId, ownership.tenantId, ownership.companyId, id,
        initialZone.name, initialZone.zoneType, initialZone.capacityUnits, now,
      ));
    }
    await c.env.DB.batch(statements);

    await logAudit(
      c.env.DB, user.id, 'CREATE_WAREHOUSE', 'warehouses', id,
      initialZone ? JSON.stringify({ initialZoneId: zoneId }) : undefined,
      ownership.tenantId, ownership.companyId,
    );
    return c.json({ success: true, id, zoneId }, 201);
  } catch (err: any) {
    if (isUniqueConstraintError(err, ['ux_warehouses_scope_code'])) {
      return c.json(duplicateWarehouseCodeResponse(), 409);
    }
    console.error('POST /warehouses error:', err);
    return c.json({ success: false, error: 'Failed to create warehouse' }, 500);
  }
});

// PUT /api/warehouses/:id
warehouseRoutes.put('/:id', requirePermission(Permission.EDIT_WAREHOUSE), async (c) => {
  try {
    const user = c.get('user');
    const scope = await resolveTenantScope(c);
    const ownership = scopeInsertValues(scope, user);
    const scopeWhere = scopedWhere(scope, 'tenant_id', 'company_id');
    const id = c.req.param('id')!;
    const body = await c.req.json();

    const existing = await c.env.DB.prepare(`SELECT id FROM warehouses WHERE id = ? AND ${scopeWhere.clause}`)
      .bind(id, ...scopeWhere.params)
      .first();
    if (!existing) return c.json({ success: false, error: 'Warehouse not found' }, 404);

    let normalizedCode: string | null = null;
    if (body.code !== undefined) {
      normalizedCode = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
      if (!normalizedCode) return c.json({ success: false, error: 'Warehouse code is required' }, 400);

      const ownerWhere = ownershipClause(ownership);
      const duplicate = await c.env.DB.prepare(`
        SELECT id FROM warehouses
        WHERE UPPER(TRIM(code)) = UPPER(TRIM(?))
          AND id <> ?
          AND ${ownerWhere.clause}
      `).bind(normalizedCode, id, ...ownerWhere.params).first<{ id: string }>();
      if (duplicate) return c.json(duplicateWarehouseCodeResponse(), 409);
    }

    const sets: string[] = [];
    const params: any[] = [];
    const fields = ['name', 'code', 'address', 'city', 'country', 'capacity_units', 'status', 'notes'];
    for (const f of fields) {
      if (body[f] !== undefined) {
        sets.push(`${f} = ?`);
        params.push(f === 'code' ? normalizedCode : body[f]);
      }
    }
    if (sets.length === 0) return c.json({ success: false, error: 'No fields to update' }, 400);

    sets.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(id);

    await c.env.DB.prepare(`UPDATE warehouses SET ${sets.join(', ')} WHERE id = ? AND ${scopeWhere.clause}`)
      .bind(...params, ...scopeWhere.params)
      .run();
    await logAudit(c.env.DB, user.id, 'UPDATE_WAREHOUSE', 'warehouses', id);
    return c.json({ success: true });
  } catch (err: any) {
    if (isUniqueConstraintError(err, ['ux_warehouses_scope_code'])) {
      return c.json(duplicateWarehouseCodeResponse(), 409);
    }
    console.error('PUT /warehouses/:id error:', err);
    return c.json({ success: false, error: 'Failed to update warehouse' }, 500);
  }
});

// ============================================================================
// ZONES
// ============================================================================

// POST /api/warehouses/:id/zones
warehouseRoutes.post('/:id/zones', requirePermission(Permission.EDIT_WAREHOUSE), async (c) => {
  try {
    const user = c.get('user');
    const scope = await resolveTenantScope(c);
    const ownership = scopeInsertValues(scope, user);
    const scopeWhere = scopedWhere(scope, 'tenant_id', 'company_id');
    const warehouseId = c.req.param('id')!;
    const input = normalizeZoneInput(await c.req.json<Record<string, unknown>>());
    const validationError = validateZoneInput(input);
    if (validationError) return c.json({ success: false, error: validationError }, 400);

    const warehouse = await c.env.DB.prepare(`SELECT id FROM warehouses WHERE id = ? AND ${scopeWhere.clause}`)
      .bind(warehouseId, ...scopeWhere.params)
      .first();
    if (!warehouse) return c.json({ success: false, error: 'Warehouse not found' }, 404);

    const duplicate = await c.env.DB.prepare(`
      SELECT id FROM warehouse_zones
      WHERE warehouse_id = ? AND UPPER(TRIM(name)) = UPPER(TRIM(?)) AND ${scopeWhere.clause}
    `).bind(warehouseId, input.name, ...scopeWhere.params).first();
    if (duplicate) return c.json({ success: false, error: 'Zone name already exists in this warehouse', code: 'DUPLICATE_ZONE_NAME' }, 409);

    const id = crypto.randomUUID();
    await c.env.DB.prepare(`
      INSERT INTO warehouse_zones (id, tenant_id, company_id, warehouse_id, name, zone_type, capacity_units)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, ownership.tenantId, ownership.companyId, warehouseId,
      input.name, input.zoneType, input.capacityUnits,
    ).run();
    await logAudit(c.env.DB, user.id, 'CREATE_WAREHOUSE_ZONE', 'warehouse_zones', id, undefined, ownership.tenantId, ownership.companyId);

    return c.json({ success: true, id }, 201);
  } catch (err) {
    console.error('POST /warehouses/:id/zones error:', err);
    return c.json({ success: false, error: 'Failed to create zone' }, 500);
  }
});

// PUT /api/warehouses/:id/zones/:zoneId
warehouseRoutes.put('/:id/zones/:zoneId', requirePermission(Permission.EDIT_WAREHOUSE), async (c) => {
  try {
    const user = c.get('user');
    const scope = await resolveTenantScope(c);
    const ownership = scopeInsertValues(scope, user);
    const scopeWhere = scopedWhere(scope, 'tenant_id', 'company_id');
    const warehouseId = c.req.param('id')!;
    const zoneId = c.req.param('zoneId')!;
    const input = normalizeZoneInput(await c.req.json<Record<string, unknown>>());
    const validationError = validateZoneInput(input);
    if (validationError) return c.json({ success: false, error: validationError }, 400);

    const existing = await c.env.DB.prepare(`
      SELECT id FROM warehouse_zones
      WHERE id = ? AND warehouse_id = ? AND ${scopeWhere.clause}
    `).bind(zoneId, warehouseId, ...scopeWhere.params).first();
    if (!existing) return c.json({ success: false, error: 'Warehouse zone not found' }, 404);

    const duplicate = await c.env.DB.prepare(`
      SELECT id FROM warehouse_zones
      WHERE warehouse_id = ? AND id <> ?
        AND UPPER(TRIM(name)) = UPPER(TRIM(?)) AND ${scopeWhere.clause}
    `).bind(warehouseId, zoneId, input.name, ...scopeWhere.params).first();
    if (duplicate) return c.json({ success: false, error: 'Zone name already exists in this warehouse', code: 'DUPLICATE_ZONE_NAME' }, 409);

    await c.env.DB.prepare(`
      UPDATE warehouse_zones SET name = ?, zone_type = ?, capacity_units = ?
      WHERE id = ? AND warehouse_id = ? AND ${scopeWhere.clause}
    `).bind(input.name, input.zoneType, input.capacityUnits, zoneId, warehouseId, ...scopeWhere.params).run();
    await logAudit(c.env.DB, user.id, 'UPDATE_WAREHOUSE_ZONE', 'warehouse_zones', zoneId, undefined, ownership.tenantId, ownership.companyId);

    return c.json({ success: true });
  } catch (err) {
    console.error('PUT /warehouses/:id/zones/:zoneId error:', err);
    return c.json({ success: false, error: 'Failed to update zone' }, 500);
  }
});

// DELETE /api/warehouses/:id/zones/:zoneId
warehouseRoutes.delete('/:id/zones/:zoneId', requirePermission(Permission.EDIT_WAREHOUSE), async (c) => {
  try {
    const user = c.get('user');
    const scope = await resolveTenantScope(c);
    const ownership = scopeInsertValues(scope, user);
    const scopeWhere = scopedWhere(scope, 'tenant_id', 'company_id');
    const warehouseId = c.req.param('id')!;
    const zoneId = c.req.param('zoneId')!;

    const existing = await c.env.DB.prepare(`
      SELECT id FROM warehouse_zones
      WHERE id = ? AND warehouse_id = ? AND ${scopeWhere.clause}
    `).bind(zoneId, warehouseId, ...scopeWhere.params).first();
    if (!existing) return c.json({ success: false, error: 'Warehouse zone not found' }, 404);

    const usage = await c.env.DB.prepare(`
      SELECT
        (SELECT COUNT(*) FROM inventory WHERE zone_id = ?) AS inventory_count,
        (SELECT COUNT(*) FROM inventory_movements WHERE from_zone_id = ? OR to_zone_id = ?) AS movement_count
    `).bind(zoneId, zoneId, zoneId).first<{ inventory_count: number; movement_count: number }>();
    if ((usage?.inventory_count || 0) > 0 || (usage?.movement_count || 0) > 0) {
      return c.json({
        success: false,
        error: 'Zone cannot be deleted because it has inventory or movement history',
        code: 'ZONE_IN_USE',
      }, 409);
    }

    await c.env.DB.prepare(`
      DELETE FROM warehouse_zones WHERE id = ? AND warehouse_id = ? AND ${scopeWhere.clause}
    `).bind(zoneId, warehouseId, ...scopeWhere.params).run();
    await logAudit(c.env.DB, user.id, 'DELETE_WAREHOUSE_ZONE', 'warehouse_zones', zoneId, undefined, ownership.tenantId, ownership.companyId);

    return c.json({ success: true });
  } catch (err) {
    console.error('DELETE /warehouses/:id/zones/:zoneId error:', err);
    return c.json({ success: false, error: 'Failed to delete zone' }, 500);
  }
});
// ============================================================================
// INVENTORY
// ============================================================================

// GET /api/warehouses/inventory - all inventory across warehouses
warehouseRoutes.get('/inventory/all', requirePermission(Permission.VIEW_WAREHOUSE), async (c) => {
  try {
    const scope = await resolveTenantScope(c);
    const warehouseId = c.req.query('warehouse_id');
    const partId = c.req.query('part_id');
    const search = c.req.query('search')?.trim();

    const params: any[] = [];
    const conditions: string[] = [];
    appendScopeCondition(conditions, params, scope, 'i.tenant_id', 'i.company_id');
    if (warehouseId) { conditions.push('i.warehouse_id = ?'); params.push(warehouseId); }
    if (partId) { conditions.push('i.part_id = ?'); params.push(partId); }
    if (search) {
      conditions.push('(p.part_number LIKE ? OR p.model_name LIKE ? OR w.name LIKE ?)');
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;

    const { results } = await c.env.DB.prepare(`
      SELECT i.id, i.warehouse_id, i.zone_id, i.part_id, i.quantity, i.condition, i.last_counted_at, i.updated_at,
        w.name as warehouse_name, w.code as warehouse_code,
        z.name as zone_name,
        p.part_number, p.model_name, p.category
      FROM inventory i
      JOIN warehouses w ON i.warehouse_id = w.id
      LEFT JOIN warehouse_zones z ON i.zone_id = z.id
      JOIN parts p ON i.part_id = p.id
      ${where}
      ORDER BY w.name, p.part_number
    `).bind(...params).all();

    return c.json({ success: true, inventory: results || [] });
  } catch (err: any) {
    console.error('GET /warehouses/inventory/all error:', err);
    return c.json({ success: false, error: 'Failed to fetch inventory' }, 500);
  }
});

// POST /api/warehouses/inventory/move - create inventory movement
warehouseRoutes.post('/inventory/move', requirePermission(Permission.EDIT_WAREHOUSE), async (c) => {
  try {
    const user = c.get('user');
    const scope = await resolveTenantScope(c);
    const ownership = scopeInsertValues(scope, user);
    const body = await c.req.json();

    if (!body.part_id || !body.quantity || !body.movement_type) {
      return c.json({ success: false, error: 'part_id, quantity, and movement_type are required' }, 400);
    }
    const qty = parseInt(body.quantity);
    if (isNaN(qty) || qty <= 0) return c.json({ success: false, error: 'Quantity must be positive' }, 400);

    const validTypes = ['Transfer', 'Receive', 'Ship', 'Adjust'];
    if (!validTypes.includes(body.movement_type)) {
      return c.json({ success: false, error: `movement_type must be: ${validTypes.join(', ')}` }, 400);
    }

    const movement: InventoryMovementInput = {
      movementType: body.movement_type as InventoryMovementType,
      partId: body.part_id,
      quantity: qty,
      condition: body.condition,
      fromWarehouseId: body.from_warehouse_id || null,
      fromZoneId: body.from_zone_id || null,
      toWarehouseId: body.to_warehouse_id || null,
      toZoneId: body.to_zone_id || null,
      reference: body.reference || null,
      notes: body.notes || null,
      createdBy: user.id,
      syncSource: 'manual',
      idempotencyKey: body.idempotency_key || null,
      effectiveAt: body.effective_at || null,
    };

    const existingMovements = await findInventoryMovementsByIdempotencyKey(
      c.env.DB,
      movement.idempotencyKey,
      ownership,
    );
    const plannedMovements = movement.fromWarehouseId && !movement.fromZoneId && existingMovements.length === 0
      ? await allocateTransactionInventoryMovements(c.env.DB, [movement], ownership)
      : [movement];
    const appliedMovements = existingMovements.length > 0
      ? existingMovements
      : await applyInventoryMovements(c.env.DB, plannedMovements, ownership);
    const primaryMovement = appliedMovements[0];

    if (!primaryMovement) {
      return c.json({ success: false, error: 'No inventory movement was applied' }, 500);
    }

    for (const applied of appliedMovements) {
      if (!applied.idempotent) {
        await logAudit(
          c.env.DB,
          user.id,
          'INVENTORY_MOVE',
          'inventory_movements',
          applied.id,
          undefined,
          ownership.tenantId,
          ownership.companyId,
        );
      }
    }

    const idempotent = appliedMovements.every((applied) => applied.idempotent);
    return c.json({
      success: true,
      id: primaryMovement.id,
      movementIds: appliedMovements.map((applied) => applied.id),
      idempotent,
    }, idempotent ? 200 : 201);
  } catch (err: any) {
    if (err instanceof InventorySyncError) {
      const status = err.status === 409 ? 409 : err.status === 403 ? 403 : err.status === 404 ? 404 : 400;
      return c.json({ success: false, error: err.message, code: err.code }, status);
    }
    console.error('POST /inventory/move error:', err);
    return c.json({ success: false, error: 'Failed to record movement' }, 500);
  }
});

// GET /api/warehouses/movements - recent movements
warehouseRoutes.get('/movements/list', requirePermission(Permission.VIEW_WAREHOUSE), async (c) => {
  try {
    const scope = await resolveTenantScope(c);
    const scopeWhere = scopedWhere(scope, 'm.tenant_id', 'm.company_id');
    const limit = Math.min(parseInt(c.req.query('limit') || '50'), 200);

    const { results } = await c.env.DB.prepare(`
      SELECT m.*,
        fw.name as from_warehouse_name, tw.name as to_warehouse_name,
        fz.name as from_zone_name, tz.name as to_zone_name,
        p.part_number, p.model_name,
        u.name as created_by_name
      FROM inventory_movements m
      LEFT JOIN warehouses fw ON m.from_warehouse_id = fw.id
      LEFT JOIN warehouses tw ON m.to_warehouse_id = tw.id
      LEFT JOIN warehouse_zones fz ON m.from_zone_id = fz.id
      LEFT JOIN warehouse_zones tz ON m.to_zone_id = tz.id
      JOIN parts p ON m.part_id = p.id
      LEFT JOIN users u ON m.created_by = u.id
      WHERE ${scopeWhere.clause}
      ORDER BY m.created_at DESC
      LIMIT ?
    `).bind(...scopeWhere.params, limit).all();

    return c.json({ success: true, movements: results || [] });
  } catch (err: any) {
    console.error('GET /movements error:', err);
    return c.json({ success: false, error: 'Failed to fetch movements' }, 500);
  }
});
