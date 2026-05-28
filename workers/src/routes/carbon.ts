/**
 * GHG Carbon Accounting Routes - tenant/company scoped
 * Manual emission entry by Scope 1/2/3 with Scope 3 upstream/downstream categories
 */

import { Hono } from 'hono';
import type { Env } from '../index';
import { authMiddleware, type User } from '../middleware/auth';
import { requirePermission, Permission } from '../middleware/permissions';
import { appendScopeCondition, resolveTenantScope, scopeInsertValues, scopedWhere } from '../middleware/tenantScope';

type Variables = { user: User };

export const carbonRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

carbonRoutes.use('*', authMiddleware);

const SCOPE3_CATEGORIES: Record<number, { name: string; stream: 'upstream' | 'downstream' }> = {
  1:  { name: 'Purchased Goods and Services', stream: 'upstream' },
  2:  { name: 'Capital Goods', stream: 'upstream' },
  3:  { name: 'Fuel- and Energy-Related Activities', stream: 'upstream' },
  4:  { name: 'Upstream Transportation and Distribution', stream: 'upstream' },
  5:  { name: 'Waste Generated in Operations', stream: 'upstream' },
  6:  { name: 'Business Travel', stream: 'upstream' },
  7:  { name: 'Employee Commuting', stream: 'upstream' },
  8:  { name: 'Upstream Leased Assets', stream: 'upstream' },
  9:  { name: 'Downstream Transportation and Distribution', stream: 'downstream' },
  10: { name: 'Processing of Sold Products', stream: 'downstream' },
  11: { name: 'Use of Sold Products', stream: 'downstream' },
  12: { name: 'End-of-Life Treatment of Sold Products', stream: 'downstream' },
  13: { name: 'Downstream Leased Assets', stream: 'downstream' },
  14: { name: 'Franchises', stream: 'downstream' },
  15: { name: 'Investments', stream: 'downstream' },
};

// GET /api/ghg/categories
carbonRoutes.get('/categories', (c) => {
  const categories = Object.entries(SCOPE3_CATEGORIES).map(([id, cat]) => ({
    id: Number(id), name: cat.name, stream: cat.stream,
  }));
  return c.json({ success: true, data: categories });
});

// ============================================================================
// GET /api/ghg/entries
// ============================================================================
carbonRoutes.get('/entries', requirePermission(Permission.VIEW_CARBON), async (c) => {
  try {
    const scopeContext = await resolveTenantScope(c);
    const scope = c.req.query('scope');
    const stream = c.req.query('stream');
    const periodStart = c.req.query('period_start');
    const periodEnd = c.req.query('period_end');

    const params: any[] = [];
    const conditions: string[] = [];
    appendScopeCondition(conditions, params, scopeContext, 'e.tenant_id', 'e.company_id');

    if (scope) {
      const s = parseInt(scope);
      if (s >= 1 && s <= 3) { conditions.push('e.scope = ?'); params.push(s); }
    }
    if (stream === 'upstream' || stream === 'downstream') {
      conditions.push('e.scope3_stream = ?'); params.push(stream);
    }
    if (periodStart) { conditions.push('e.reporting_period_end >= ?'); params.push(periodStart); }
    if (periodEnd) { conditions.push('e.reporting_period_start <= ?'); params.push(periodEnd); }

    const { results } = await c.env.DB.prepare(`
      SELECT e.*, u.name as created_by_name
      FROM ghg_emission_entries e
      LEFT JOIN users u ON u.id = e.created_by
      WHERE ${conditions.join(' AND ')}
      ORDER BY e.scope, e.category_id, e.reporting_period_start DESC
    `).bind(...params).all();

    return c.json({ success: true, data: results || [] });
  } catch (err: any) {
    console.error('GET /ghg/entries error:', err);
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

// ============================================================================
// POST /api/ghg/entries
// ============================================================================
carbonRoutes.post('/entries', requirePermission(Permission.EDIT_CARBON), async (c) => {
  try {
    const user = c.get('user');
    const scopeContext = await resolveTenantScope(c);
    const scopeValues = scopeInsertValues(scopeContext, user);
    const body = await c.req.json();

    const {
      scope, category_id, source_description,
      activity_data, activity_unit,
      emission_factor, emission_factor_unit, emission_factor_source,
      reporting_period_start, reporting_period_end,
      data_quality, methodology_notes,
    } = body;

    if (!scope || !source_description || !activity_data || !activity_unit ||
        emission_factor === undefined || !reporting_period_start || !reporting_period_end) {
      return c.json({ error: 'Missing required fields' }, 400);
    }

    const scopeNum = parseInt(scope);
    if (scopeNum < 1 || scopeNum > 3) return c.json({ error: 'Scope must be 1, 2, or 3' }, 400);

    let catId: number | null = null;
    let stream: string | null = null;
    if (scopeNum === 3) {
      if (!category_id) return c.json({ error: 'Scope 3 entries require a category (1-15)' }, 400);
      catId = parseInt(category_id);
      if (!SCOPE3_CATEGORIES[catId]) return c.json({ error: 'Invalid Scope 3 category' }, 400);
      stream = SCOPE3_CATEGORIES[catId].stream;
    }

    const activityVal = parseFloat(activity_data);
    const efVal = parseFloat(emission_factor);
    if (isNaN(activityVal) || activityVal <= 0) return c.json({ error: 'Activity data must be positive' }, 400);
    if (isNaN(efVal) || efVal < 0) return c.json({ error: 'Emission factor must be non-negative' }, 400);

    const co2eKg = activityVal * efVal;
    const id = crypto.randomUUID();

    await c.env.DB.prepare(`
      INSERT INTO ghg_emission_entries (
        id, tenant_id, company_id, created_by, scope, category_id, scope3_stream,
        source_description, activity_data, activity_unit,
        emission_factor, emission_factor_unit, emission_factor_source,
        co2e_kg, reporting_period_start, reporting_period_end,
        data_quality, methodology_notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, scopeValues.tenantId, scopeValues.companyId, user.id, scopeNum, catId, stream,
      source_description, activityVal, activity_unit,
      efVal, emission_factor_unit || 'kgCO2e', emission_factor_source || null,
      co2eKg, reporting_period_start, reporting_period_end,
      data_quality || 'estimated', methodology_notes || null,
    ).run();

    return c.json({ success: true, data: { id, co2e_kg: co2eKg } }, 201);
  } catch (err: any) {
    console.error('POST /ghg/entries error:', err);
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

// ============================================================================
// DELETE /api/ghg/entries/:id
// ============================================================================
carbonRoutes.delete('/entries/:id', requirePermission(Permission.EDIT_CARBON), async (c) => {
  try {
    const scopeContext = await resolveTenantScope(c);
    const scopeWhere = scopedWhere(scopeContext, 'tenant_id', 'company_id');
    const id = c.req.param('id');
    const existing = await c.env.DB.prepare(`SELECT id FROM ghg_emission_entries WHERE id = ? AND ${scopeWhere.clause}`)
      .bind(id, ...scopeWhere.params)
      .first();
    if (!existing) return c.json({ error: 'Entry not found' }, 404);

    await c.env.DB.prepare(`DELETE FROM ghg_emission_entries WHERE id = ? AND ${scopeWhere.clause}`)
      .bind(id, ...scopeWhere.params)
      .run();
    return c.json({ success: true });
  } catch (err: any) {
    console.error('DELETE /ghg/entries/:id error:', err);
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

// ============================================================================
// GET /api/ghg/report - aggregated report
// ============================================================================
carbonRoutes.get('/report', requirePermission(Permission.VIEW_CARBON), async (c) => {
  try {
    const scopeContext = await resolveTenantScope(c);
    const periodStart = c.req.query('period_start');
    const periodEnd = c.req.query('period_end');

    const params: any[] = [];
    const conditions: string[] = [];
    appendScopeCondition(conditions, params, scopeContext, 'tenant_id', 'company_id');
    if (periodStart) { conditions.push('reporting_period_end >= ?'); params.push(periodStart); }
    if (periodEnd) { conditions.push('reporting_period_start <= ?'); params.push(periodEnd); }
    const where = `WHERE ${conditions.join(' AND ')}`;

    const { results } = await c.env.DB.prepare(`
      SELECT
        scope,
        scope3_stream,
        category_id,
        COUNT(*) as entry_count,
        SUM(co2e_kg) as total_co2e_kg,
        SUM(activity_data) as total_activity
      FROM ghg_emission_entries
      ${where}
      GROUP BY scope, scope3_stream, category_id
      ORDER BY scope, category_id
    `).bind(...params).all();

    // Overall totals
    const totals = await c.env.DB.prepare(`
      SELECT
        SUM(CASE WHEN scope = 1 THEN co2e_kg ELSE 0 END) as scope1_kg,
        SUM(CASE WHEN scope = 2 THEN co2e_kg ELSE 0 END) as scope2_kg,
        SUM(CASE WHEN scope = 3 THEN co2e_kg ELSE 0 END) as scope3_kg,
        SUM(co2e_kg) as total_kg
      FROM ghg_emission_entries
      ${where}
    `).bind(...params).first();

    return c.json({ success: true, breakdown: results || [], totals });
  } catch (err: any) {
    console.error('GET /ghg/report error:', err);
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});
