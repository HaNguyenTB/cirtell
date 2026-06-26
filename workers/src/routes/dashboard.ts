/**
 * Dashboard - headline KPIs scoped by tenant/company.
 */

import { Hono } from 'hono';
import type { Env } from '../index';
import { authMiddleware, type User } from '../middleware/auth';
import { requirePermission, Permission } from '../middleware/permissions';
import { resolveTenantScope, scopedWhere } from '../middleware/tenantScope';

type Variables = { user: User };

export const dashboardRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

dashboardRoutes.use('*', authMiddleware);

// ============================================================================
// GET /api/overview/headline - top-level KPIs
// ============================================================================
dashboardRoutes.get('/overview/headline', requirePermission(Permission.VIEW_DASHBOARD), async (c) => {
  try {
    const scope = await resolveTenantScope(c);
    const transactionScope = scopedWhere(scope, 'tenant_id', 'company_id');
    const ghgScope = scopedWhere(scope, 'tenant_id', 'company_id');
    const partsScope = scopedWhere(scope, 'tenant_id', 'company_id');

    const txStats = await c.env.DB.prepare(`
      SELECT
        COUNT(*) as total_transactions,
        SUM(quantity * unit_price_usd) as total_value,
        SUM(quantity) as total_units,
        SUM(CASE WHEN movement_type = 'Redeploy' THEN quantity ELSE 0 END) as reuse_units
      FROM transactions
      WHERE ${transactionScope.clause}
    `).bind(...transactionScope.params).first();

    const ghgTotals = await c.env.DB.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN COALESCE(source_type, 'manual') = 'manual' AND scope = 1 THEN co2e_kg ELSE 0 END), 0) as scope1_kg,
        COALESCE(SUM(CASE WHEN COALESCE(source_type, 'manual') = 'manual' AND scope = 2 THEN co2e_kg ELSE 0 END), 0) as scope2_kg,
        COALESCE(SUM(CASE WHEN COALESCE(source_type, 'manual') = 'manual' AND scope = 3 THEN co2e_kg ELSE 0 END), 0) as scope3_kg,
        COALESCE(SUM(CASE WHEN COALESCE(source_type, 'manual') = 'manual' THEN co2e_kg ELSE 0 END), 0) as actual_co2e_kg,
        COALESCE(SUM(CASE WHEN source_type = 'transaction' THEN co2e_kg ELSE 0 END), 0) as avoided_co2e_kg,
        COALESCE(SUM(CASE WHEN source_type = 'transaction' AND source_movement_type = 'Redeploy' THEN co2e_kg ELSE 0 END), 0) as avoided_redeploy_co2e_kg,
        COALESCE(SUM(CASE WHEN source_type = 'transaction' AND source_movement_type = 'Recycle' THEN co2e_kg ELSE 0 END), 0) as avoided_recycle_co2e_kg
      FROM ghg_emission_entries
      WHERE ${ghgScope.clause}
    `).bind(...ghgScope.params).first();

    const partsCount = await c.env.DB.prepare(`SELECT COUNT(*) as total FROM parts WHERE ${partsScope.clause}`)
      .bind(...partsScope.params)
      .first<{ total: number }>();

    const totalUnits = (txStats as any)?.total_units || 0;
    const reuseUnits = (txStats as any)?.reuse_units || 0;
    const reuseRate = totalUnits > 0 ? (reuseUnits / totalUnits) * 100 : 0;

    const actualCo2eKg = (ghgTotals as any)?.actual_co2e_kg || 0;
    const avoidedCo2eKg = (ghgTotals as any)?.avoided_co2e_kg || 0;

    return c.json({
      success: true,
      data: {
        total_transactions: (txStats as any)?.total_transactions || 0,
        total_value_usd: (txStats as any)?.total_value || 0,
        total_units: totalUnits,
        reuse_rate: Math.round(reuseRate * 100) / 100,
        total_co2e_kg: actualCo2eKg,
        actual_co2e_kg: actualCo2eKg,
        avoided_co2e_kg: avoidedCo2eKg,
        net_co2e_kg: actualCo2eKg - avoidedCo2eKg,
        avoided_redeploy_co2e_kg: (ghgTotals as any)?.avoided_redeploy_co2e_kg || 0,
        avoided_recycle_co2e_kg: (ghgTotals as any)?.avoided_recycle_co2e_kg || 0,
        scope1_kg: (ghgTotals as any)?.scope1_kg || 0,
        scope2_kg: (ghgTotals as any)?.scope2_kg || 0,
        scope3_kg: (ghgTotals as any)?.scope3_kg || 0,
        total_parts: partsCount?.total || 0,
      },
    });
  } catch (err: any) {
    console.error('GET /overview/headline error:', err);
    return c.json({ success: false, error: 'Failed to fetch dashboard data' }, 500);
  }
});
