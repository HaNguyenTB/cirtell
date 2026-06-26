/**
 * Parts Catalog Routes - tenant/company scoped master catalog
 * CRUD for master parts catalog
 */

import { Hono } from 'hono';
import type { Env } from '../index';
import { authMiddleware, logAudit, type User } from '../middleware/auth';
import { requirePermission, Permission } from '../middleware/permissions';
import { appendScopeCondition, resolveTenantScope, scopeInsertValues, scopedWhere } from '../middleware/tenantScope';

export const partsRoutes = new Hono<{ Bindings: Env; Variables: { user: User } }>();

partsRoutes.use('*', authMiddleware);

type SQLValue = string | number | null;
interface ScopeValues {
  tenantId: string | null;
  companyId: string | null;
}
type ImportPartRow = Record<string, unknown> & {
  part_number?: unknown;
  manufacturer_part_number?: unknown;
  model_name?: unknown;
  vendor?: unknown;
  technology_type?: unknown;
  weight_kg?: unknown;
  emission_factor_kg?: unknown;
  manufacture_start_year?: unknown;
  manufacture_end_year?: unknown;
  category?: unknown;
  subcategory?: unknown;
  description?: unknown;
  needs_review?: unknown;
  review_notes?: unknown;
};

interface ImportError {
  row: number;
  part_number?: string;
  error: string;
}

class RouteError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status = 400, code?: string) {
    super(message);
    this.name = 'RouteError';
    this.status = status;
    this.code = code;
  }
}

function firstDefined(body: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(body, key)) return body[key];
  }
  return undefined;
}

function normalizeText(value: unknown, maxLength = 500): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, maxLength) : null;
}

function parseNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseInteger(value: unknown): number | null {
  const parsed = parseNumber(value);
  return parsed === null ? null : Math.trunc(parsed);
}

function parseBoolean(value: unknown): number {
  if (value === true || value === 1) return 1;
  if (value === false || value === 0 || value === undefined || value === null || value === '') return 0;
  const text = String(value).trim().toLowerCase();
  return ['1', 'true', 'yes', 'y', 'review', 'needs review'].includes(text) ? 1 : 0;
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

async function validateVendorId(db: D1Database, vendorId: string, ownership: ScopeValues): Promise<string> {
  const ownerWhere = ownershipClause(ownership);
  const existing = await db.prepare(`SELECT id FROM vendors WHERE id = ? AND ${ownerWhere.clause}`)
    .bind(vendorId, ...ownerWhere.params)
    .first<{ id: string }>();
  if (!existing) throw new RouteError('Vendor not found', 400);
  return existing.id;
}

async function findOrCreateVendorByName(db: D1Database, vendor: unknown, ownership: ScopeValues): Promise<string | null> {
  const vendorName = normalizeText(vendor, 160);
  if (!vendorName) return null;

  const ownerWhere = ownershipClause(ownership);
  const existing = await db.prepare(`SELECT id FROM vendors WHERE LOWER(TRIM(vendor_name)) = LOWER(TRIM(?)) AND ${ownerWhere.clause}`)
    .bind(vendorName, ...ownerWhere.params)
    .first<{ id: string }>();
  if (existing) return existing.id;

  const vendorId = `vendor_${crypto.randomUUID()}`;
  try {
    await db.prepare('INSERT INTO vendors (id, tenant_id, company_id, vendor_name) VALUES (?, ?, ?, ?)')
      .bind(vendorId, ownership.tenantId, ownership.companyId, vendorName)
      .run();
  } catch (err) {
    if (isUniqueConstraintError(err, ['ux_vendors_scope_name'])) {
      throw new RouteError(
        'Vendor already exists in the current company',
        409,
        'DUPLICATE_VENDOR_NAME',
      );
    }
    throw err;
  }
  return vendorId;
}

async function resolveVendorId(db: D1Database, input: Record<string, unknown>, ownership: ScopeValues): Promise<string | null> {
  const explicitVendorId = normalizeText(firstDefined(input, ['vendor_id', 'vendorId']), 160);
  if (explicitVendorId) return validateVendorId(db, explicitVendorId, ownership);
  return findOrCreateVendorByName(db, firstDefined(input, ['vendor', 'vendor_name', 'vendorName']), ownership);
}

function duplicatePartNumberResponse() {
  return {
    success: false,
    error: 'Part number already exists in the current company',
    code: 'DUPLICATE_PART_NUMBER',
  };
}

// ============================================================================
// GET /api/parts - list all parts
// ============================================================================
partsRoutes.get('/', requirePermission(Permission.VIEW_PARTS), async (c) => {
  try {
    const scope = await resolveTenantScope(c);
    const search = c.req.query('search')?.trim();
    const category = c.req.query('category');
    const vendor = c.req.query('vendor');
    const limit = Math.min(parseInt(c.req.query('limit') || '200'), 1000);
    const offset = parseInt(c.req.query('offset') || '0');

    const params: any[] = [];
    const conditions: string[] = [];
    appendScopeCondition(conditions, params, scope, 'p.tenant_id', 'p.company_id');

    if (search) {
      conditions.push(`(
        p.part_number LIKE ?
        OR p.manufacturer_part_number LIKE ?
        OR p.model_name LIKE ?
        OR v.vendor_name LIKE ?
        OR p.category LIKE ?
        OR p.subcategory LIKE ?
        OR p.description LIKE ?
      )`);
      const s = `%${search}%`;
      params.push(s, s, s, s, s, s, s);
    }
    if (category) { conditions.push('p.category = ?'); params.push(category); }
    if (vendor) { conditions.push('v.vendor_name = ?'); params.push(vendor); }
    const where = `WHERE ${conditions.join(' AND ')}`;

    const countResult = await c.env.DB.prepare(
      `SELECT COUNT(*) as total
       FROM parts p
       LEFT JOIN vendors v ON p.vendor_id = v.id
        AND p.tenant_id = v.tenant_id
        AND p.company_id = v.company_id
       ${where}`,
    ).bind(...params).first<{ total: number }>();

    const { results } = await c.env.DB.prepare(`
      SELECT
        p.id, p.part_number, p.manufacturer_part_number, p.model_name,
        COALESCE(v.vendor_name, p.vendor_id) as vendor,
        p.technology_type, p.weight_kg, p.emission_factor_kg,
        p.manufacture_start_year, p.manufacture_end_year,
        p.category, p.subcategory, p.description,
        p.needs_review, p.review_notes,
        p.tenant_id, p.company_id,
        t.name as tenant_name,
        c.name as company_name,
        p.created_at, p.updated_at
      FROM parts p
      LEFT JOIN vendors v ON p.vendor_id = v.id
        AND p.tenant_id = v.tenant_id
        AND p.company_id = v.company_id
      LEFT JOIN tenants t ON t.id = p.tenant_id
      LEFT JOIN companies c ON c.id = p.company_id
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
// GET /api/parts/:id - single part
// ============================================================================
partsRoutes.get('/:id', requirePermission(Permission.VIEW_PARTS), async (c) => {
  try {
    const scope = await resolveTenantScope(c);
    const scopeWhere = scopedWhere(scope, 'p.tenant_id', 'p.company_id');
    const id = c.req.param('id');
    const part = await c.env.DB.prepare(`
      SELECT p.*, COALESCE(v.vendor_name, p.vendor_id) as vendor,
             t.name as tenant_name,
             c.name as company_name
      FROM parts p
      LEFT JOIN vendors v ON p.vendor_id = v.id
        AND p.tenant_id = v.tenant_id
        AND p.company_id = v.company_id
      LEFT JOIN tenants t ON t.id = p.tenant_id
      LEFT JOIN companies c ON c.id = p.company_id
      WHERE p.id = ? AND ${scopeWhere.clause}
    `).bind(id, ...scopeWhere.params).first();

    if (!part) return c.json({ success: false, error: 'Part not found' }, 404);
    return c.json({ success: true, part });
  } catch (err: any) {
    console.error('GET /parts/:id error:', err);
    return c.json({ success: false, error: 'Failed to fetch part' }, 500);
  }
});

// ============================================================================
// POST /api/parts/import - bulk import from spreadsheet rows
// ============================================================================
partsRoutes.post('/import', requirePermission(Permission.EDIT_PARTS), async (c) => {
  try {
    const user = c.get('user');
    const scope = await resolveTenantScope(c);
    const scopeValues = scopeInsertValues(scope, user);
    const scopeWhere = scopedWhere(scope, 'tenant_id', 'company_id');
    const body = await c.req.json<{ parts?: ImportPartRow[] }>();
    const rows = Array.isArray(body.parts) ? body.parts.slice(0, 1000) : [];

    if (rows.length === 0) {
      return c.json({ success: false, error: 'No parts were provided for import' }, 400);
    }

    const errors: ImportError[] = [];
    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const [index, row] of rows.entries()) {
      const rowNumber = index + 2;
      const partNumber = normalizeText(row.part_number, 160);
      if (!partNumber) {
        skipped += 1;
        errors.push({ row: rowNumber, error: 'Part Number is required' });
        continue;
      }

      try {
        const vendorId = await resolveVendorId(c.env.DB, row, scopeValues);
        const existing = await c.env.DB.prepare(`SELECT id FROM parts WHERE LOWER(TRIM(part_number)) = LOWER(TRIM(?)) AND ${scopeWhere.clause}`)
          .bind(partNumber, ...scopeWhere.params)
          .first<{ id: string }>();

        if (existing) {
          const fields: Array<[keyof ImportPartRow, string, SQLValue]> = [
            ['manufacturer_part_number', 'manufacturer_part_number', normalizeText(row.manufacturer_part_number, 160)],
            ['model_name', 'model_name', normalizeText(row.model_name, 240)],
            ['technology_type', 'technology_type', normalizeText(row.technology_type, 160)],
            ['weight_kg', 'weight_kg', parseNumber(row.weight_kg)],
            ['emission_factor_kg', 'emission_factor_kg', parseNumber(row.emission_factor_kg)],
            ['manufacture_start_year', 'manufacture_start_year', parseInteger(row.manufacture_start_year)],
            ['manufacture_end_year', 'manufacture_end_year', parseInteger(row.manufacture_end_year)],
            ['category', 'category', normalizeText(row.category, 160)],
            ['subcategory', 'subcategory', normalizeText(row.subcategory, 160)],
            ['description', 'description', normalizeText(row.description, 2000)],
            ['needs_review', 'needs_review', parseBoolean(row.needs_review)],
            ['review_notes', 'review_notes', normalizeText(row.review_notes, 1000)],
          ];
          const sets: string[] = [];
          const params: SQLValue[] = [];

          if (row.vendor !== undefined) {
            sets.push('vendor_id = ?');
            params.push(vendorId);
          }

          for (const [inputKey, column, value] of fields) {
            if (row[inputKey] !== undefined) {
              sets.push(`${column} = ?`);
              params.push(value);
            }
          }

          if (sets.length > 0) {
            sets.push('updated_at = ?');
            params.push(new Date().toISOString(), existing.id);
            await c.env.DB.prepare(`UPDATE parts SET ${sets.join(', ')} WHERE id = ?`)
              .bind(...params)
              .run();
          }
          updated += 1;
          continue;
        }

        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        await c.env.DB.prepare(`
          INSERT INTO parts (
            id, tenant_id, company_id, part_number, manufacturer_part_number, model_name, vendor_id,
            technology_type, weight_kg, emission_factor_kg,
            manufacture_start_year, manufacture_end_year,
            category, subcategory, description,
            needs_review, review_notes, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          id,
          scopeValues.tenantId,
          scopeValues.companyId,
          partNumber,
          normalizeText(row.manufacturer_part_number, 160),
          normalizeText(row.model_name, 240),
          vendorId,
          normalizeText(row.technology_type, 160),
          parseNumber(row.weight_kg),
          parseNumber(row.emission_factor_kg),
          parseInteger(row.manufacture_start_year),
          parseInteger(row.manufacture_end_year),
          normalizeText(row.category, 160),
          normalizeText(row.subcategory, 160),
          normalizeText(row.description, 2000),
          parseBoolean(row.needs_review),
          normalizeText(row.review_notes, 1000),
          now,
          now,
        ).run();
        created += 1;
      } catch (rowError) {
        skipped += 1;
        errors.push({
          row: rowNumber,
          part_number: partNumber,
          error: rowError instanceof Error ? rowError.message : 'Failed to import row',
        });
      }
    }

    await logAudit(
      c.env.DB,
      user.id,
      'IMPORT_PARTS',
      'parts',
      crypto.randomUUID(),
      JSON.stringify({ created, updated, skipped, total: rows.length }),
    );

    return c.json({
      success: true,
      summary: { created, updated, skipped, total: rows.length },
      errors,
    });
  } catch (err: any) {
    console.error('POST /parts/import error:', err);
    return c.json({ success: false, error: 'Failed to import parts' }, 500);
  }
});

// ============================================================================
// POST /api/parts - create a part
// ============================================================================
partsRoutes.post('/', requirePermission(Permission.EDIT_PARTS), async (c) => {
  try {
    const user = c.get('user');
    const scope = await resolveTenantScope(c);
    const scopeValues = scopeInsertValues(scope, user);
    const body = await c.req.json();

    if (!body.part_number || typeof body.part_number !== 'string' || !body.part_number.trim()) {
      return c.json({ success: false, error: 'Part number is required' }, 400);
    }

    // Check duplicate
    const ownerWhere = ownershipClause(scopeValues);
    const existing = await c.env.DB.prepare(
      `SELECT id FROM parts WHERE LOWER(TRIM(part_number)) = LOWER(TRIM(?)) AND ${ownerWhere.clause}`,
    ).bind(body.part_number.trim(), ...ownerWhere.params).first();
    if (existing) {
      return c.json(duplicatePartNumberResponse(), 409);
    }

    // Resolve vendor
    const vendorId = await resolveVendorId(c.env.DB, body, scopeValues);

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await c.env.DB.prepare(`
      INSERT INTO parts (
        id, tenant_id, company_id, part_number, manufacturer_part_number, model_name, vendor_id,
        technology_type, weight_kg, emission_factor_kg,
        manufacture_start_year, manufacture_end_year,
        category, subcategory, description,
        needs_review, review_notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, scopeValues.tenantId, scopeValues.companyId, body.part_number.trim(),
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
    if (err instanceof RouteError) {
      return c.json({
        success: false,
        error: err.message,
        ...(err.code ? { code: err.code } : {}),
      }, err.status as any);
    }
    if (isUniqueConstraintError(err, ['ux_parts_scope_part_number'])) {
      return c.json(duplicatePartNumberResponse(), 409);
    }
    console.error('POST /parts error:', err);
    return c.json({ success: false, error: 'Failed to create part' }, 500);
  }
});

// ============================================================================
// PUT /api/parts/:id - update a part
// ============================================================================
partsRoutes.put('/:id', requirePermission(Permission.EDIT_PARTS), async (c) => {
  try {
    const user = c.get('user');
    const scope = await resolveTenantScope(c);
    const scopeValues = scopeInsertValues(scope, user);
    const scopeWhere = scopedWhere(scope, 'tenant_id', 'company_id');
    const id = c.req.param('id')!;
    const body = await c.req.json();

    const existing = await c.env.DB.prepare(`SELECT id FROM parts WHERE id = ? AND ${scopeWhere.clause}`)
      .bind(id, ...scopeWhere.params)
      .first();
    if (!existing) return c.json({ success: false, error: 'Part not found' }, 404);

    let nextPartNumber: string | null = null;
    if (body.part_number !== undefined) {
      nextPartNumber = normalizeText(body.part_number, 160);
      if (!nextPartNumber) return c.json({ success: false, error: 'Part number is required' }, 400);
      const ownerWhere = ownershipClause(scopeValues);
      const duplicate = await c.env.DB.prepare(`
        SELECT id FROM parts
        WHERE LOWER(TRIM(part_number)) = LOWER(TRIM(?))
          AND id <> ?
          AND ${ownerWhere.clause}
      `).bind(nextPartNumber, id, ...ownerWhere.params).first<{ id: string }>();
      if (duplicate) return c.json(duplicatePartNumberResponse(), 409);
    }

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
        params.push(key === 'part_number' ? nextPartNumber : key === 'needs_review' ? (body[key] ? 1 : 0) : body[key]);
      }
    }

    if (body.vendor !== undefined) {
      const vendorId = await resolveVendorId(c.env.DB, body, scopeValues);
      sets.push('vendor_id = ?');
      params.push(vendorId);
    } else if (body.vendor_id !== undefined || body.vendorId !== undefined) {
      const vendorId = await resolveVendorId(c.env.DB, body, scopeValues);
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
    if (err instanceof RouteError) {
      return c.json({
        success: false,
        error: err.message,
        ...(err.code ? { code: err.code } : {}),
      }, err.status as any);
    }
    if (isUniqueConstraintError(err, ['ux_parts_scope_part_number'])) {
      return c.json(duplicatePartNumberResponse(), 409);
    }
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
    const scope = await resolveTenantScope(c);
    const scopeWhere = scopedWhere(scope, 'tenant_id', 'company_id');
    const id = c.req.param('id')!;
    const existing = await c.env.DB.prepare(`SELECT id FROM parts WHERE id = ? AND ${scopeWhere.clause}`)
      .bind(id, ...scopeWhere.params)
      .first();
    if (!existing) return c.json({ success: false, error: 'Part not found' }, 404);

    await c.env.DB.prepare(`DELETE FROM parts WHERE id = ? AND ${scopeWhere.clause}`)
      .bind(id, ...scopeWhere.params)
      .run();
    await logAudit(c.env.DB, user.id, 'DELETE_PART', 'parts', id);
    return c.json({ success: true });
  } catch (err: any) {
    console.error('DELETE /parts/:id error:', err);
    return c.json({ success: false, error: 'Failed to delete part' }, 500);
  }
});

// ============================================================================
// GET /api/parts/vendors - list distinct vendors
// ============================================================================
partsRoutes.get('/vendors/list', requirePermission(Permission.VIEW_PARTS), async (c) => {
  try {
    const scope = await resolveTenantScope(c);
    const scopeWhere = scopedWhere(scope, 'p.tenant_id', 'p.company_id');
    const { results } = await c.env.DB.prepare(
      `SELECT DISTINCT v.id, v.vendor_name
       FROM vendors v
       JOIN parts p ON p.vendor_id = v.id
        AND p.tenant_id = v.tenant_id
        AND p.company_id = v.company_id
       WHERE ${scopeWhere.clause}
       ORDER BY v.vendor_name`,
    ).bind(...scopeWhere.params).all();
    return c.json({ success: true, vendors: results || [] });
  } catch (err: any) {
    return c.json({ success: false, error: 'Failed to fetch vendors' }, 500);
  }
});
