/**
 * Warehouse Management Routes - tenant/company scoped
 * CRUD for warehouses, zones, inventory, and movements
 */

import { Hono } from 'hono';
import type { Env } from '../index';
import { authMiddleware, logAudit, type User } from '../middleware/auth';
import { requirePermission, Permission } from '../middleware/permissions';
import { appendScopeCondition, resolveTenantScope, scopeInsertValues, scopedWhere } from '../middleware/tenantScope';

type Variables = { user: User };

export const warehouseRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

warehouseRoutes.use('*', authMiddleware);

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

    const existing = await c.env.DB.prepare('SELECT id FROM warehouses WHERE code = ? AND tenant_id = ?')
      .bind(body.code.trim().toUpperCase(), ownership.tenantId)
      .first();
    if (existing) return c.json({ success: false, error: 'Warehouse code already exists' }, 409);

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await c.env.DB.prepare(`
      INSERT INTO warehouses (id, tenant_id, company_id, name, code, address, city, country, capacity_units, status, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, ownership.tenantId, ownership.companyId, body.name.trim(), body.code.trim().toUpperCase(),
      body.address?.trim() || null, body.city?.trim() || null, body.country?.trim() || null,
      body.capacity_units || null, body.status || 'active', body.notes?.trim() || null,
      now, now,
    ).run();

    await logAudit(c.env.DB, user.id, 'CREATE_WAREHOUSE', 'warehouses', id);
    return c.json({ success: true, id }, 201);
  } catch (err: any) {
    console.error('POST /warehouses error:', err);
    return c.json({ success: false, error: 'Failed to create warehouse' }, 500);
  }
});

// PUT /api/warehouses/:id
warehouseRoutes.put('/:id', requirePermission(Permission.EDIT_WAREHOUSE), async (c) => {
  try {
    const user = c.get('user');
    const scope = await resolveTenantScope(c);
    const scopeWhere = scopedWhere(scope, 'tenant_id', 'company_id');
    const id = c.req.param('id')!;
    const body = await c.req.json();

    const existing = await c.env.DB.prepare(`SELECT id FROM warehouses WHERE id = ? AND ${scopeWhere.clause}`)
      .bind(id, ...scopeWhere.params)
      .first();
    if (!existing) return c.json({ success: false, error: 'Warehouse not found' }, 404);

    const sets: string[] = [];
    const params: any[] = [];
    const fields = ['name', 'code', 'address', 'city', 'country', 'capacity_units', 'status', 'notes'];
    for (const f of fields) {
      if (body[f] !== undefined) { sets.push(`${f} = ?`); params.push(body[f]); }
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
    const body = await c.req.json();
    if (!body.name?.trim()) return c.json({ success: false, error: 'Zone name is required' }, 400);

    const wh = await c.env.DB.prepare(`SELECT id FROM warehouses WHERE id = ? AND ${scopeWhere.clause}`)
      .bind(warehouseId, ...scopeWhere.params)
      .first();
    if (!wh) return c.json({ success: false, error: 'Warehouse not found' }, 404);

    const id = crypto.randomUUID();
    await c.env.DB.prepare(
      'INSERT INTO warehouse_zones (id, tenant_id, company_id, warehouse_id, name, zone_type, capacity_units) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(id, ownership.tenantId, ownership.companyId, warehouseId, body.name.trim(), body.zone_type || 'storage', body.capacity_units || null).run();

    return c.json({ success: true, id }, 201);
  } catch (err: any) {
    console.error('POST /warehouses/:id/zones error:', err);
    return c.json({ success: false, error: 'Failed to create zone' }, 500);
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
      SELECT i.id, i.quantity, i.condition, i.last_counted_at, i.updated_at,
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
    const itemScope = scopedWhere(scope, 'tenant_id', 'company_id');
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

    // Validate part exists
    const part = await c.env.DB.prepare(`SELECT id FROM parts WHERE id = ? AND ${itemScope.clause}`)
      .bind(body.part_id, ...itemScope.params)
      .first();
    if (!part) return c.json({ success: false, error: 'Part not found' }, 400);

    for (const warehouseId of [body.from_warehouse_id, body.to_warehouse_id].filter(Boolean)) {
      const warehouse = await c.env.DB.prepare(`SELECT id FROM warehouses WHERE id = ? AND ${itemScope.clause}`)
        .bind(warehouseId, ...itemScope.params)
        .first();
      if (!warehouse) return c.json({ success: false, error: 'Warehouse not found' }, 400);
    }

    // For Receive: to_warehouse_id required
    // For Ship: from_warehouse_id required
    // For Transfer: both required
    if (body.movement_type === 'Receive' && !body.to_warehouse_id) {
      return c.json({ success: false, error: 'to_warehouse_id is required for Receive' }, 400);
    }
    if (body.movement_type === 'Ship' && !body.from_warehouse_id) {
      return c.json({ success: false, error: 'from_warehouse_id is required for Ship' }, 400);
    }
    if (body.movement_type === 'Transfer' && (!body.from_warehouse_id || !body.to_warehouse_id)) {
      return c.json({ success: false, error: 'Both from/to warehouse required for Transfer' }, 400);
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const condition = body.condition || 'Good';

    // Record movement
    await c.env.DB.prepare(`
      INSERT INTO inventory_movements (id, from_warehouse_id, from_zone_id, to_warehouse_id, to_zone_id,
        part_id, tenant_id, company_id, quantity, movement_type, reference, notes, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, body.from_warehouse_id || null, body.from_zone_id || null,
      body.to_warehouse_id || null, body.to_zone_id || null,
      body.part_id, ownership.tenantId, ownership.companyId, qty, body.movement_type,
      body.reference || null, body.notes || null, user.id, now,
    ).run();

    // Update inventory: decrement source
    if (body.from_warehouse_id) {
      await c.env.DB.prepare(`
        UPDATE inventory SET quantity = MAX(quantity - ?, 0), updated_at = ?
        WHERE warehouse_id = ? AND part_id = ? AND COALESCE(zone_id, '') = COALESCE(?, '')
          AND condition = ? AND ${itemScope.clause}
      `).bind(qty, now, body.from_warehouse_id, body.part_id, body.from_zone_id || '', condition, ...itemScope.params).run();
    }

    // Update inventory: increment destination
    if (body.to_warehouse_id) {
      const existing = await c.env.DB.prepare(`
        SELECT id, quantity FROM inventory
        WHERE warehouse_id = ? AND part_id = ? AND COALESCE(zone_id, '') = COALESCE(?, '')
          AND condition = ? AND ${itemScope.clause}
      `).bind(body.to_warehouse_id, body.part_id, body.to_zone_id || '', condition, ...itemScope.params).first<{ id: string; quantity: number }>();

      if (existing) {
        await c.env.DB.prepare('UPDATE inventory SET quantity = ?, updated_at = ? WHERE id = ?')
          .bind(existing.quantity + qty, now, existing.id).run();
      } else {
        await c.env.DB.prepare(`
          INSERT INTO inventory (id, tenant_id, company_id, warehouse_id, zone_id, part_id, quantity, condition, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(crypto.randomUUID(), ownership.tenantId, ownership.companyId, body.to_warehouse_id, body.to_zone_id || null, body.part_id, qty, condition, now).run();
      }
    }

    await logAudit(c.env.DB, user.id, 'INVENTORY_MOVE', 'inventory_movements', id);
    return c.json({ success: true, id }, 201);
  } catch (err: any) {
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
