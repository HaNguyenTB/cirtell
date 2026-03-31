/**
 * Transactions routes — single tenant
 * CRUD with part/market enrichment
 */

import { Hono } from 'hono';
import type { Env } from '../index';
import { authMiddleware, logAudit, type User } from '../middleware/auth';
import { requirePermission, Permission } from '../middleware/permissions';

type Variables = { user: User };

export const transactionsRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

transactionsRoutes.use('*', authMiddleware);

// ============================================================================
// GET /api/transactions — list with enrichment
// ============================================================================
transactionsRoutes.get('/', requirePermission(Permission.VIEW_TRANSACTIONS), async (c) => {
  try {
    const search = c.req.query('search')?.trim();
    const movementType = c.req.query('movement_type');
    const startDate = c.req.query('start_date');
    const endDate = c.req.query('end_date');
    const limit = Math.min(parseInt(c.req.query('limit') || '100'), 500);
    const offset = parseInt(c.req.query('offset') || '0');

    const params: any[] = [];
    const conditions: string[] = [];

    if (movementType) { conditions.push('t.movement_type = ?'); params.push(movementType); }
    if (startDate) { conditions.push('t.date >= ?'); params.push(startDate); }
    if (endDate) { conditions.push('t.date <= ?'); params.push(endDate); }
    if (search) {
      conditions.push('(p.part_number LIKE ? OR p.model_name LIKE ? OR t.vendor LIKE ?)');
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    const whereClause = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const countResult = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM transactions t LEFT JOIN parts p ON t.part_id = p.id ${whereClause}`,
    ).bind(...params).first<{ total: number }>();

    const { results } = await c.env.DB.prepare(`
      SELECT
        t.id, t.date, t.movement_type as movementType,
        t.quantity, t.unit_price_usd as unitPrice,
        (t.quantity * t.unit_price_usd) as totalValue,
        t.vendor, t.serial_number as serialNumber,
        t.condition, t.po_number as poNumber,
        t.created_at,
        p.part_number as partNumber,
        p.model_name as partName,
        p.technology_type as technology,
        p.category
      FROM transactions t
      LEFT JOIN parts p ON t.part_id = p.id
      ${whereClause}
      ORDER BY t.date DESC, t.created_at DESC
      LIMIT ? OFFSET ?
    `).bind(...params, limit, offset).all();

    return c.json({ success: true, transactions: results || [], total: countResult?.total || 0, limit, offset });
  } catch (err: any) {
    console.error('GET /transactions error:', err);
    return c.json({ success: false, error: 'Failed to fetch transactions' }, 500);
  }
});

// ============================================================================
// GET /api/transactions/summary
// ============================================================================
transactionsRoutes.get('/summary', requirePermission(Permission.VIEW_TRANSACTIONS), async (c) => {
  try {
    const summary = await c.env.DB.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN movement_type = 'Purchase' THEN 1 ELSE 0 END) as purchases,
        SUM(CASE WHEN movement_type = 'Sale' THEN 1 ELSE 0 END) as sales,
        SUM(CASE WHEN movement_type = 'Redeploy' THEN 1 ELSE 0 END) as redeploys,
        SUM(CASE WHEN movement_type = 'Recycle' THEN 1 ELSE 0 END) as recycles,
        SUM(quantity * unit_price_usd) as totalValue
      FROM transactions
    `).first();

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
  } catch (err: any) {
    console.error('GET /transactions/summary error:', err);
    return c.json({ success: false, error: 'Failed to fetch summary' }, 500);
  }
});

// ============================================================================
// GET /api/transactions/:id
// ============================================================================
transactionsRoutes.get('/:id', requirePermission(Permission.VIEW_TRANSACTIONS), async (c) => {
  try {
    const id = c.req.param('id');
    const tx = await c.env.DB.prepare(`
      SELECT t.*, p.part_number, p.model_name as partName
      FROM transactions t LEFT JOIN parts p ON t.part_id = p.id
      WHERE t.id = ?
    `).bind(id).first();

    if (!tx) return c.json({ success: false, error: 'Transaction not found' }, 404);
    return c.json({ success: true, transaction: tx });
  } catch (err: any) {
    console.error('GET /transactions/:id error:', err);
    return c.json({ success: false, error: 'Failed to fetch transaction' }, 500);
  }
});

// ============================================================================
// POST /api/transactions — create
// ============================================================================
transactionsRoutes.post('/', requirePermission(Permission.EDIT_TRANSACTIONS), async (c) => {
  try {
    const user = c.get('user');
    const body = await c.req.json();

    if (!body.movement_type || !body.date || !body.quantity) {
      return c.json({ success: false, error: 'movement_type, date, and quantity are required' }, 400);
    }

    const validTypes = ['Purchase', 'Sale', 'Redeploy', 'Recycle'];
    if (!validTypes.includes(body.movement_type)) {
      return c.json({ success: false, error: `movement_type must be one of: ${validTypes.join(', ')}` }, 400);
    }

    const qty = parseInt(body.quantity);
    if (isNaN(qty) || qty <= 0) {
      return c.json({ success: false, error: 'quantity must be a positive integer' }, 400);
    }

    // Validate part_id if provided
    if (body.part_id) {
      const part = await c.env.DB.prepare('SELECT id FROM parts WHERE id = ?').bind(body.part_id).first();
      if (!part) return c.json({ success: false, error: 'Part not found' }, 400);
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await c.env.DB.prepare(`
      INSERT INTO transactions (
        id, date, movement_type, quantity, unit_price_usd,
        vendor, part_id, serial_number, condition,
        po_number, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, body.date, body.movement_type, qty,
      body.unit_price_usd || 0,
      body.vendor?.trim() || null,
      body.part_id || null,
      body.serial_number?.trim() || null,
      body.condition?.trim() || null,
      body.po_number?.trim() || null,
      user.id, now, now,
    ).run();

    await logAudit(c.env.DB, user.id, 'CREATE_TRANSACTION', 'transactions', id);
    return c.json({ success: true, id }, 201);
  } catch (err: any) {
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
    const id = c.req.param('id');
    const body = await c.req.json();

    const existing = await c.env.DB.prepare('SELECT id FROM transactions WHERE id = ?').bind(id).first();
    if (!existing) return c.json({ success: false, error: 'Transaction not found' }, 404);

    const sets: string[] = [];
    const params: any[] = [];

    const fields: Record<string, string> = {
      date: 'date', movement_type: 'movement_type', quantity: 'quantity',
      unit_price_usd: 'unit_price_usd', vendor: 'vendor', part_id: 'part_id',
      serial_number: 'serial_number', condition: 'condition', po_number: 'po_number',
    };

    for (const [key, col] of Object.entries(fields)) {
      if (body[key] !== undefined) { sets.push(`${col} = ?`); params.push(body[key]); }
    }

    if (sets.length === 0) return c.json({ success: false, error: 'No fields to update' }, 400);

    sets.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(id);

    await c.env.DB.prepare(`UPDATE transactions SET ${sets.join(', ')} WHERE id = ?`).bind(...params).run();
    await logAudit(c.env.DB, user.id, 'UPDATE_TRANSACTION', 'transactions', id);
    return c.json({ success: true });
  } catch (err: any) {
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
    const id = c.req.param('id');

    const existing = await c.env.DB.prepare('SELECT id FROM transactions WHERE id = ?').bind(id).first();
    if (!existing) return c.json({ success: false, error: 'Transaction not found' }, 404);

    await c.env.DB.prepare('DELETE FROM transactions WHERE id = ?').bind(id).run();
    await logAudit(c.env.DB, user.id, 'DELETE_TRANSACTION', 'transactions', id);
    return c.json({ success: true });
  } catch (err: any) {
    console.error('DELETE /transactions/:id error:', err);
    return c.json({ success: false, error: 'Failed to delete transaction' }, 500);
  }
});
