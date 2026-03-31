/**
 * Parts Catalog Routes — single tenant
 * CRUD for master parts catalog
 */

import { Hono } from 'hono';
import type { Env } from '../index';
import { authMiddleware, logAudit, type User } from '../middleware/auth';
import { requirePermission, Permission } from '../middleware/permissions';

export const partsRoutes = new Hono<{ Bindings: Env; Variables: { user: User } }>();

partsRoutes.use('*', authMiddleware);

// ============================================================================
// GET /api/parts — list all parts
// ============================================================================
partsRoutes.get('/', requirePermission(Permission.VIEW_PARTS), async (c) => {
  try {
    const search = c.req.query('search')?.trim();
    const category = c.req.query('category');
    const vendor = c.req.query('vendor');
    const limit = Math.min(parseInt(c.req.query('limit') || '200'), 1000);
    const offset = parseInt(c.req.query('offset') || '0');

    const params: any[] = [];
    let where = 'WHERE 1=1';

    if (search) {
      where += ' AND (p.part_number LIKE ? OR p.model_name LIKE ? OR v.vendor_name LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s);
    }
    if (category) { where += ' AND p.category = ?'; params.push(category); }
    if (vendor) { where += ' AND v.vendor_name = ?'; params.push(vendor); }

    const countResult = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM parts p LEFT JOIN vendors v ON p.vendor_id = v.id ${where}`,
    ).bind(...params).first<{ total: number }>();

    const { results } = await c.env.DB.prepare(`
      SELECT
        p.id, p.part_number, p.manufacturer_part_number, p.model_name,
        COALESCE(v.vendor_name, p.vendor_id) as vendor,
        p.technology_type, p.weight_kg, p.emission_factor_kg,
        p.manufacture_start_year, p.manufacture_end_year,
        p.category, p.subcategory, p.description,
        p.needs_review, p.review_notes,
        p.created_at, p.updated_at
      FROM parts p
      LEFT JOIN vendors v ON p.vendor_id = v.id
      ${where}
      ORDER BY p.part_number ASC
      LIMIT ? OFFSET ?
    `).bind(...params, limit, offset).all();

    return c.json({ success: true, parts: results || [], total: countResult?.total || 0 });
  } catch (err: any) {
    console.error('GET /parts error:', err);
    return c.json({ success: false, error: 'Failed to fetch parts' }, 500);
  }
});

// ============================================================================
// GET /api/parts/:id — single part
// ============================================================================
partsRoutes.get('/:id', requirePermission(Permission.VIEW_PARTS), async (c) => {
  try {
    const id = c.req.param('id');
    const part = await c.env.DB.prepare(`
      SELECT p.*, COALESCE(v.vendor_name, p.vendor_id) as vendor
      FROM parts p LEFT JOIN vendors v ON p.vendor_id = v.id
      WHERE p.id = ?
    `).bind(id).first();

    if (!part) return c.json({ success: false, error: 'Part not found' }, 404);
    return c.json({ success: true, part });
  } catch (err: any) {
    console.error('GET /parts/:id error:', err);
    return c.json({ success: false, error: 'Failed to fetch part' }, 500);
  }
});

// ============================================================================
// POST /api/parts — create a part
// ============================================================================
partsRoutes.post('/', requirePermission(Permission.EDIT_PARTS), async (c) => {
  try {
    const user = c.get('user');
    const body = await c.req.json();

    if (!body.part_number || typeof body.part_number !== 'string' || !body.part_number.trim()) {
      return c.json({ success: false, error: 'Part number is required' }, 400);
    }

    // Check duplicate
    const existing = await c.env.DB.prepare(
      'SELECT id FROM parts WHERE part_number = ?',
    ).bind(body.part_number.trim()).first();
    if (existing) {
      return c.json({ success: false, error: 'Part number already exists' }, 409);
    }

    // Resolve vendor
    let vendorId: string | null = null;
    if (body.vendor?.trim()) {
      const vendorName = body.vendor.trim();
      const existingV = await c.env.DB.prepare('SELECT id FROM vendors WHERE vendor_name = ?').bind(vendorName).first<{ id: string }>();
      if (existingV) {
        vendorId = existingV.id;
      } else {
        vendorId = `vendor_${crypto.randomUUID()}`;
        await c.env.DB.prepare('INSERT INTO vendors (id, vendor_name) VALUES (?, ?)').bind(vendorId, vendorName).run();
      }
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await c.env.DB.prepare(`
      INSERT INTO parts (
        id, part_number, manufacturer_part_number, model_name, vendor_id,
        technology_type, weight_kg, emission_factor_kg,
        manufacture_start_year, manufacture_end_year,
        category, subcategory, description,
        needs_review, review_notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, body.part_number.trim(),
      body.manufacturer_part_number?.trim() || null,
      body.model_name?.trim() || null,
      vendorId,
      body.technology_type?.trim() || null,
      body.weight_kg || null,
      body.emission_factor_kg || null,
      body.manufacture_start_year || null,
      body.manufacture_end_year || null,
      body.category?.trim() || null,
      body.subcategory?.trim() || null,
      body.description?.trim() || null,
      body.needs_review ? 1 : 0,
      body.review_notes?.trim() || null,
      now, now,
    ).run();

    await logAudit(c.env.DB, user.id, 'CREATE_PART', 'parts', id);
    return c.json({ success: true, id }, 201);
  } catch (err: any) {
    console.error('POST /parts error:', err);
    return c.json({ success: false, error: 'Failed to create part' }, 500);
  }
});

// ============================================================================
// PUT /api/parts/:id — update a part
// ============================================================================
partsRoutes.put('/:id', requirePermission(Permission.EDIT_PARTS), async (c) => {
  try {
    const user = c.get('user');
    const id = c.req.param('id');
    const body = await c.req.json();

    const existing = await c.env.DB.prepare('SELECT id FROM parts WHERE id = ?').bind(id).first();
    if (!existing) return c.json({ success: false, error: 'Part not found' }, 404);

    const sets: string[] = [];
    const params: any[] = [];

    const fields: Record<string, string> = {
      part_number: 'part_number', model_name: 'model_name',
      manufacturer_part_number: 'manufacturer_part_number',
      technology_type: 'technology_type', weight_kg: 'weight_kg',
      emission_factor_kg: 'emission_factor_kg',
      manufacture_start_year: 'manufacture_start_year',
      manufacture_end_year: 'manufacture_end_year',
      category: 'category', subcategory: 'subcategory',
      description: 'description', needs_review: 'needs_review',
      review_notes: 'review_notes',
    };

    for (const [key, col] of Object.entries(fields)) {
      if (body[key] !== undefined) {
        sets.push(`${col} = ?`);
        params.push(key === 'needs_review' ? (body[key] ? 1 : 0) : body[key]);
      }
    }

    if (body.vendor !== undefined) {
      let vendorId: string | null = null;
      if (body.vendor?.trim()) {
        const name = body.vendor.trim();
        const v = await c.env.DB.prepare('SELECT id FROM vendors WHERE vendor_name = ?').bind(name).first<{ id: string }>();
        if (v) { vendorId = v.id; } else {
          vendorId = `vendor_${crypto.randomUUID()}`;
          await c.env.DB.prepare('INSERT INTO vendors (id, vendor_name) VALUES (?, ?)').bind(vendorId, name).run();
        }
      }
      sets.push('vendor_id = ?');
      params.push(vendorId);
    }

    if (sets.length === 0) return c.json({ success: false, error: 'No fields to update' }, 400);

    sets.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(id);

    await c.env.DB.prepare(`UPDATE parts SET ${sets.join(', ')} WHERE id = ?`).bind(...params).run();
    await logAudit(c.env.DB, user.id, 'UPDATE_PART', 'parts', id);

    return c.json({ success: true });
  } catch (err: any) {
    console.error('PUT /parts/:id error:', err);
    return c.json({ success: false, error: 'Failed to update part' }, 500);
  }
});

// ============================================================================
// DELETE /api/parts/:id
// ============================================================================
partsRoutes.delete('/:id', requirePermission(Permission.EDIT_PARTS), async (c) => {
  try {
    const user = c.get('user');
    const id = c.req.param('id');
    const existing = await c.env.DB.prepare('SELECT id FROM parts WHERE id = ?').bind(id).first();
    if (!existing) return c.json({ success: false, error: 'Part not found' }, 404);

    await c.env.DB.prepare('DELETE FROM parts WHERE id = ?').bind(id).run();
    await logAudit(c.env.DB, user.id, 'DELETE_PART', 'parts', id);
    return c.json({ success: true });
  } catch (err: any) {
    console.error('DELETE /parts/:id error:', err);
    return c.json({ success: false, error: 'Failed to delete part' }, 500);
  }
});

// ============================================================================
// GET /api/parts/vendors — list distinct vendors
// ============================================================================
partsRoutes.get('/vendors/list', requirePermission(Permission.VIEW_PARTS), async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT id, vendor_name FROM vendors ORDER BY vendor_name',
    ).all();
    return c.json({ success: true, vendors: results || [] });
  } catch (err: any) {
    return c.json({ success: false, error: 'Failed to fetch vendors' }, 500);
  }
});
