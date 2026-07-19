/**
 * GHG Carbon Accounting Routes - tenant/company scoped
 * Manual emission entry by Scope 1/2/3 with Scope 3 upstream/downstream categories
 */

import { Hono } from 'hono';
import type { Env } from '../index';
import { authMiddleware, logAudit, type User } from '../middleware/auth';
import { requirePermission, Permission } from '../middleware/permissions';
import { appendScopeCondition, resolveTenantScope, scopeInsertValues, scopedWhere } from '../middleware/tenantScope';
import { prepareTransactionCarbonBatch } from '../services/transactionCarbonSync';
import type { TransactionMovementType } from '../services/inventorySync';

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

const AVOIDED_EMISSIONS_METHOD = 'avoided_emissions_v1';

interface AvoidedEmissionCandidate {
  transaction_id: string;
  date: string;
  movement_type: 'Redeploy' | 'Recycle';
  tenant_id: string | null;
  company_id: string | null;
  part_id: string | null;
  part_number: string | null;
  quantity: number | null;
  emission_factor_kg: number | null;
}

interface ExistingAvoidedEntry {
  id: string;
  activity_data: number;
  emission_factor: number;
  co2e_kg: number;
  reporting_period_start: string;
  reporting_period_end: string;
  source_movement_type: string | null;
}

interface AvoidedSyncWarning {
  transactionId: string;
  partId: string | null;
  partNumber?: string | null;
  code: string;
}
interface CarbonReconciliationTransaction {
  id: string;
  tenant_id: string | null;
  company_id: string | null;
  created_by: string;
  date: string;
  movement_type: TransactionMovementType;
  part_id: string | null;
  quantity: number | null;
  inventory_sync_status: string;
  inventory_sync_version: number;
  voided_at: string | null;
}

interface ActiveTransactionCarbonEntry {
  part_id: string;
  activity_data: number;
  emission_factor: number;
  co2e_kg: number;
  reporting_period_start: string;
  reporting_period_end: string;
  emission_kind: string;
  calculation_method: string;
  source_transaction_version: number | null;
}

function positiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function auditDetails(details: Record<string, unknown>): string {
  return JSON.stringify(details);
}

function dateOnly(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

function roundedKg(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function valuesDiffer(existing: ExistingAvoidedEntry, next: {
  quantity: number;
  factor: number;
  co2eKg: number;
  date: string;
  movementType: 'Redeploy' | 'Recycle';
}): boolean {
  return Number(existing.activity_data) !== next.quantity
    || Number(existing.emission_factor) !== next.factor
    || Number(existing.co2e_kg) !== next.co2eKg
    || existing.reporting_period_start !== next.date
    || existing.reporting_period_end !== next.date
    || existing.source_movement_type !== next.movementType;
}

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
    const conditions: string[] = ['e.is_active = 1'];
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
      SELECT
        e.*,
        u.name as created_by_name,
        t.movement_type as transaction_movement_type,
        p.part_number as part_number
      FROM ghg_emission_entries e
      LEFT JOIN users u ON u.id = e.created_by
      LEFT JOIN transactions t
        ON t.id = e.transaction_id
       AND (t.tenant_id = e.tenant_id OR (t.tenant_id IS NULL AND e.tenant_id IS NULL))
       AND (t.company_id = e.company_id OR (t.company_id IS NULL AND e.company_id IS NULL))
      LEFT JOIN parts p
        ON p.id = e.part_id
       AND (p.tenant_id = e.tenant_id OR (p.tenant_id IS NULL AND e.tenant_id IS NULL))
       AND (p.company_id = e.company_id OR (p.company_id IS NULL AND e.company_id IS NULL))
      WHERE ${conditions.join(' AND ')}
      ORDER BY e.reporting_period_start DESC, e.created_at DESC, e.scope, e.category_id
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
        data_quality, methodology_notes, source_type, transaction_id, part_id,
        calculation_method, factor_source, source_movement_type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, scopeValues.tenantId, scopeValues.companyId, user.id, scopeNum, catId, stream,
      source_description, activityVal, activity_unit,
      efVal, emission_factor_unit || 'kgCO2e', emission_factor_source || null,
      co2eKg, reporting_period_start, reporting_period_end,
      data_quality || 'estimated', methodology_notes || null,
      'manual', null, null, 'activity_factor_v1', emission_factor_source || null, null,
    ).run();

    await logAudit(
      c.env.DB,
      user.id,
      'CREATE_GHG_ENTRY',
      'ghg_emission_entries',
      id,
      auditDetails({
        scope: scopeNum,
        category: catId,
        co2eKg,
      }),
      scopeValues.tenantId,
      scopeValues.companyId,
    );

    return c.json({ success: true, data: { id, co2e_kg: co2eKg } }, 201);
  } catch (err: any) {
    console.error('POST /ghg/entries error:', err);
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

// ============================================================================
// POST /api/ghg/avoided-emissions/sync
// ============================================================================
carbonRoutes.post('/avoided-emissions/sync', requirePermission(Permission.EDIT_CARBON), async (c) => {
  try {
    const user = c.get('user');
    const scopeContext = await resolveTenantScope(c);
    const bodyText = await c.req.text();
    let body: Record<string, unknown> = {};
    if (bodyText.trim()) {
      try {
        body = JSON.parse(bodyText) as Record<string, unknown>;
      } catch {
        return c.json({ success: false, error: 'Invalid request body', code: 'INVALID_REQUEST' }, 400);
      }
    }

    const transactionIdValue = body.transaction_id ?? c.req.query('transaction_id');
    const periodStartValue = body.period_start ?? c.req.query('period_start');
    const periodEndValue = body.period_end ?? c.req.query('period_end');
    const dryRunValue = body.dry_run ?? c.req.query('dry_run');

    if (transactionIdValue !== undefined && typeof transactionIdValue !== 'string') {
      return c.json({ success: false, error: 'transaction_id must be a string', code: 'INVALID_REQUEST' }, 400);
    }
    const transactionId = typeof transactionIdValue === 'string' && transactionIdValue.trim()
      ? transactionIdValue.trim()
      : null;

    const periodStart = periodStartValue === undefined ? null : dateOnly(periodStartValue);
    const periodEnd = periodEndValue === undefined ? null : dateOnly(periodEndValue);
    if ((periodStartValue !== undefined && !periodStart) || (periodEndValue !== undefined && !periodEnd)) {
      return c.json({ success: false, error: 'Invalid reporting period', code: 'INVALID_PERIOD' }, 400);
    }
    if (periodStart && periodEnd && periodStart > periodEnd) {
      return c.json({ success: false, error: 'period_start must be before or equal to period_end', code: 'INVALID_PERIOD' }, 400);
    }

    let dryRun = false;
    if (dryRunValue !== undefined) {
      if (typeof dryRunValue === 'boolean') {
        dryRun = dryRunValue;
      } else if (dryRunValue === 'true') {
        dryRun = true;
      } else if (dryRunValue === 'false') {
        dryRun = false;
      } else {
        return c.json({ success: false, error: 'dry_run must be boolean', code: 'INVALID_REQUEST' }, 400);
      }
    }

    if (transactionId) {
      const txScope = scopedWhere(scopeContext, 'tenant_id', 'company_id');
      const scopedTransaction = await c.env.DB.prepare(`
        SELECT id
        FROM transactions
        WHERE id = ? AND ${txScope.clause}
      `).bind(transactionId, ...txScope.params).first<{ id: string }>();
      if (!scopedTransaction) {
        return c.json({ success: false, error: 'Transaction not found', code: 'TRANSACTION_NOT_FOUND' }, 404);
      }
    }

    const params: any[] = [];
    const conditions: string[] = [
      "t.movement_type IN ('Redeploy', 'Recycle')",
      't.voided_at IS NULL',
    ];
    appendScopeCondition(conditions, params, scopeContext, 't.tenant_id', 't.company_id');
    if (transactionId) {
      conditions.push('t.id = ?');
      params.push(transactionId);
    }
    if (periodStart) {
      conditions.push('t.date >= ?');
      params.push(periodStart);
    }
    if (periodEnd) {
      conditions.push('t.date <= ?');
      params.push(periodEnd);
    }

    const scanned = await c.env.DB.prepare(`
      SELECT COUNT(*) AS count
      FROM transactions t
      WHERE ${conditions.join(' AND ')}
    `).bind(...params).first<{ count: number }>();

    const { results } = await c.env.DB.prepare(`
      WITH eligible_transactions AS (
        SELECT
          t.id,
          t.tenant_id,
          t.company_id,
          t.date,
          t.movement_type,
          t.part_id,
          t.quantity
        FROM transactions t
        WHERE ${conditions.join(' AND ')}
      ),
      active_items AS (
        SELECT
          ti.transaction_id,
          ti.part_id,
          SUM(ti.quantity) AS quantity
        FROM transaction_items ti
        JOIN eligible_transactions t ON t.id = ti.transaction_id
        WHERE ti.superseded_at IS NULL
          AND ti.part_id IS NOT NULL
        GROUP BY ti.transaction_id, ti.part_id
      ),
      candidates AS (
        SELECT
          t.id AS transaction_id,
          t.tenant_id,
          t.company_id,
          t.date,
          t.movement_type,
          ai.part_id,
          ai.quantity
        FROM eligible_transactions t
        JOIN active_items ai ON ai.transaction_id = t.id

        UNION ALL

        SELECT
          t.id AS transaction_id,
          t.tenant_id,
          t.company_id,
          t.date,
          t.movement_type,
          t.part_id,
          t.quantity
        FROM eligible_transactions t
        WHERE t.part_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM active_items ai WHERE ai.transaction_id = t.id
          )
      )
      SELECT
        c.transaction_id,
        c.date,
        c.movement_type,
        c.tenant_id,
        c.company_id,
        c.part_id,
        c.quantity,
        p.part_number,
        p.emission_factor_kg
      FROM candidates c
      LEFT JOIN parts p
        ON p.id = c.part_id
       AND (p.tenant_id = c.tenant_id OR (p.tenant_id IS NULL AND c.tenant_id IS NULL))
       AND (p.company_id = c.company_id OR (p.company_id IS NULL AND c.company_id IS NULL))
      WHERE c.part_id IS NOT NULL
      ORDER BY c.date, c.transaction_id, c.part_id
    `).bind(...params).all<AvoidedEmissionCandidate>();

    const candidates = results || [];
    let created = 0;
    let updated = 0;
    let alreadyExisting = 0;
    let skippedMissingPart = 0;
    let skippedMissingFactor = 0;
    let skippedInvalidQuantity = 0;
    let avoidedCo2eKg = 0;
    const warnings: AvoidedSyncWarning[] = [];

    for (const candidate of candidates) {
      const quantity = positiveNumber(candidate.quantity);
      if (!quantity) {
        skippedInvalidQuantity += 1;
        warnings.push({
          transactionId: candidate.transaction_id,
          partId: candidate.part_id,
          code: 'INVALID_QUANTITY',
        });
        continue;
      }

      if (!candidate.part_id || !candidate.part_number) {
        skippedMissingPart += 1;
        warnings.push({
          transactionId: candidate.transaction_id,
          partId: candidate.part_id,
          code: 'MISSING_PART',
        });
        continue;
      }

      const factor = positiveNumber(candidate.emission_factor_kg);
      if (!factor) {
        skippedMissingFactor += 1;
        warnings.push({
          transactionId: candidate.transaction_id,
          partId: candidate.part_id,
          partNumber: candidate.part_number,
          code: 'MISSING_EMISSION_FACTOR',
        });
        continue;
      }

      const existing = await c.env.DB.prepare(`
        SELECT
          id,
          activity_data,
          emission_factor,
          co2e_kg,
          reporting_period_start,
          reporting_period_end,
          source_movement_type
        FROM ghg_emission_entries
        WHERE source_type = 'transaction'
          AND emission_kind = 'avoided'
          AND is_active = 1
          AND transaction_id = ?
          AND part_id = ?
          AND calculation_method = ?
          AND COALESCE(tenant_id, '') = COALESCE(?, '')
          AND COALESCE(company_id, '') = COALESCE(?, '')
        LIMIT 1
      `).bind(
        candidate.transaction_id,
        candidate.part_id,
        AVOIDED_EMISSIONS_METHOD,
        candidate.tenant_id,
        candidate.company_id,
      ).first<ExistingAvoidedEntry>();

      const co2eKg = quantity * factor;
      const next = {
        quantity,
        factor,
        co2eKg,
        date: candidate.date,
        movementType: candidate.movement_type,
      };

      if (existing && !valuesDiffer(existing, next)) {
        alreadyExisting += 1;
        continue;
      }

      if (existing) {
        updated += 1;
      } else {
        created += 1;
      }
      avoidedCo2eKg += co2eKg;
      if (dryRun) continue;

      const id = crypto.randomUUID();

      if (existing) {
        await c.env.DB.prepare(`
          UPDATE ghg_emission_entries
          SET
            created_by = ?,
            source_description = ?,
            activity_data = ?,
            activity_unit = ?,
            emission_factor = ?,
            emission_factor_unit = ?,
            emission_factor_source = ?,
            co2e_kg = ?,
            reporting_period_start = ?,
            reporting_period_end = ?,
            data_quality = ?,
            methodology_notes = ?,
            source_movement_type = ?,
            emission_kind = 'avoided',
            is_active = 1,
            invalidated_at = NULL,
            invalidated_by = NULL,
            invalidation_reason = NULL,
            updated_at = ?
          WHERE id = ?
        `).bind(
          user.id,
          `Avoided emissions from ${candidate.movement_type} transaction ${candidate.transaction_id}`,
          quantity,
          'unit',
          factor,
          'kgCO2e/unit',
          'parts.emission_factor_kg',
          co2eKg,
          candidate.date,
          candidate.date,
          'estimated',
          'Generated from transaction avoided emissions sync: avoided_co2e_kg = quantity * part.emission_factor_kg',
          candidate.movement_type,
          new Date().toISOString(),
          existing.id,
        ).run();
      } else {
        await c.env.DB.prepare(`
          INSERT INTO ghg_emission_entries (
            id, tenant_id, company_id, created_by, scope, category_id, scope3_stream,
            source_description, activity_data, activity_unit,
            emission_factor, emission_factor_unit, emission_factor_source,
            co2e_kg, reporting_period_start, reporting_period_end,
            data_quality, methodology_notes, source_type, transaction_id, part_id,
            calculation_method, factor_source, source_movement_type,
            emission_kind, is_active
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          id,
          candidate.tenant_id,
          candidate.company_id,
          user.id,
          3,
          null,
          null,
          `Avoided emissions from ${candidate.movement_type} transaction ${candidate.transaction_id}`,
          quantity,
          'unit',
          factor,
          'kgCO2e/unit',
          'parts.emission_factor_kg',
          co2eKg,
          candidate.date,
          candidate.date,
          'estimated',
          'Generated from transaction avoided emissions sync: avoided_co2e_kg = quantity * part.emission_factor_kg',
          'transaction',
          candidate.transaction_id,
          candidate.part_id,
          AVOIDED_EMISSIONS_METHOD,
          'parts.emission_factor_kg',
          candidate.movement_type,
          'avoided',
          1,
        ).run();
      }
    }

    if (!dryRun && (created > 0 || updated > 0)) {
      const scopeValues = scopeInsertValues(scopeContext, user);
      await logAudit(
        c.env.DB,
        user.id,
        'SYNC_AVOIDED_EMISSIONS',
        'ghg_emission_entries',
        transactionId || scopeValues.companyId || scopeValues.tenantId || 'carbon',
        auditDetails({
          transactionId,
          periodStart,
          periodEnd,
          created,
          updated,
          skippedMissingFactor,
          avoidedCo2eKg: roundedKg(avoidedCo2eKg),
        }),
        scopeValues.tenantId,
        scopeValues.companyId,
      );
    }

    return c.json({
      success: true,
      data: {
        dryRun,
        transactionsScanned: scanned?.count || 0,
        candidates: candidates.length,
        created,
        updated,
        alreadyExisting,
        skippedMissingFactor,
        avoidedCo2eKg: roundedKg(avoidedCo2eKg),
        warnings,
      },
      dry_run: dryRun,
      scanned: candidates.length,
      created,
      updated,
      already_existing: alreadyExisting,
      skipped_missing_factor: skippedMissingFactor,
      skipped_missing_part: skippedMissingPart,
      skipped_invalid_quantity: skippedInvalidQuantity,
      avoided_co2e_kg: roundedKg(avoidedCo2eKg),
      warnings,
    });
  } catch (err: any) {
    console.error('POST /ghg/avoided-emissions/sync error:', err);
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

// ============================================================================
// POST /api/ghg/transaction-emissions/sync
// Reconcile generated transaction carbon in the active tenant/company scope.
// ============================================================================
carbonRoutes.post('/transaction-emissions/sync', requirePermission(Permission.EDIT_CARBON), async (c) => {
  try {
    const user = c.get('user');
    const scopeContext = await resolveTenantScope(c);
    const bodyText = await c.req.text();
    let body: Record<string, unknown> = {};
    if (bodyText.trim()) {
      try {
        body = JSON.parse(bodyText) as Record<string, unknown>;
      } catch {
        return c.json({ success: false, error: 'Invalid request body', code: 'INVALID_REQUEST' }, 400);
      }
    }

    const transactionId = typeof body.transaction_id === 'string' && body.transaction_id.trim()
      ? body.transaction_id.trim()
      : null;
    const periodStart = body.period_start === undefined ? null : dateOnly(body.period_start);
    const periodEnd = body.period_end === undefined ? null : dateOnly(body.period_end);
    const dryRun = body.dry_run === true;

    if ((body.period_start !== undefined && !periodStart) || (body.period_end !== undefined && !periodEnd)) {
      return c.json({ success: false, error: 'Invalid reporting period', code: 'INVALID_PERIOD' }, 400);
    }
    if (periodStart && periodEnd && periodStart > periodEnd) {
      return c.json({ success: false, error: 'period_start must be before or equal to period_end', code: 'INVALID_PERIOD' }, 400);
    }
    if (body.dry_run !== undefined && typeof body.dry_run !== 'boolean') {
      return c.json({ success: false, error: 'dry_run must be boolean', code: 'INVALID_REQUEST' }, 400);
    }

    const txScope = scopedWhere(scopeContext, 't.tenant_id', 't.company_id');
    const conditions = [txScope.clause];
    const params: unknown[] = [...txScope.params];
    if (transactionId) {
      conditions.push('t.id = ?');
      params.push(transactionId);
    }
    if (periodStart) {
      conditions.push('t.date >= ?');
      params.push(periodStart);
    }
    if (periodEnd) {
      conditions.push('t.date <= ?');
      params.push(periodEnd);
    }
    conditions.push(`(
      (
        t.voided_at IS NULL
        AND t.inventory_sync_status = 'synced'
        AND t.movement_type IN ('Purchase', 'Redeploy', 'Recycle')
      )
      OR EXISTS (
        SELECT 1
        FROM ghg_emission_entries active_carbon
        WHERE active_carbon.transaction_id = t.id
          AND active_carbon.source_type = 'transaction'
          AND active_carbon.is_active = 1
      )
    )`);

    const { results } = await c.env.DB.prepare(`
      SELECT
        t.id, t.tenant_id, t.company_id, t.created_by, t.date, t.movement_type,
        t.part_id, t.quantity, t.inventory_sync_status,
        COALESCE(t.inventory_sync_version, 0) AS inventory_sync_version,
        t.voided_at
      FROM transactions t
      WHERE ${conditions.join(' AND ')}
      ORDER BY t.date, t.created_at, t.id
    `).bind(...params).all<CarbonReconciliationTransaction>();

    if (transactionId && !(results || []).some((row) => row.id === transactionId)) {
      const exists = await c.env.DB.prepare(`
        SELECT t.id
        FROM transactions t
        WHERE t.id = ? AND ${txScope.clause}
      `).bind(transactionId, ...txScope.params).first<{ id: string }>();
      if (!exists) {
        return c.json({ success: false, error: 'Transaction not found', code: 'TRANSACTION_NOT_FOUND' }, 404);
      }
    }

    let rebuiltTransactions = 0;
    let unchangedTransactions = 0;
    let invalidatedEntries = 0;
    let generatedEntries = 0;
    let actualCo2eKg = 0;
    let avoidedCo2eKg = 0;
    const warnings: Array<{ transactionId: string; partId: string; code: string }> = [];
    const now = new Date().toISOString();

    for (const transaction of results || []) {
      const { results: itemRows } = await c.env.DB.prepare(`
        SELECT part_id, quantity
        FROM transaction_items
        WHERE transaction_id = ? AND superseded_at IS NULL
        ORDER BY created_at, id
      `).bind(transaction.id).all<{ part_id: string | null; quantity: number | null }>();

      const carbonBatch = await prepareTransactionCarbonBatch(
        c.env.DB,
        {
          id: transaction.id,
          movementType: transaction.movement_type,
          date: transaction.date,
          partId: transaction.part_id,
          quantity: transaction.quantity,
          inventorySyncStatus: transaction.voided_at ? 'voided' : transaction.inventory_sync_status,
          syncVersion: Number(transaction.inventory_sync_version || 0),
          items: itemRows || [],
          createdBy: user.id,
          createdAt: now,
        },
        {
          tenantId: transaction.tenant_id,
          companyId: transaction.company_id,
        },
        transaction.voided_at ? 'void' : 'reconcile',
      );

      const { results: activeRows } = await c.env.DB.prepare(`
        SELECT
          part_id, activity_data, emission_factor, co2e_kg,
          reporting_period_start, reporting_period_end,
          emission_kind, calculation_method, source_transaction_version
        FROM ghg_emission_entries
        WHERE transaction_id = ?
          AND source_type = 'transaction'
          AND is_active = 1
          AND COALESCE(tenant_id, '') = COALESCE(?, '')
          AND COALESCE(company_id, '') = COALESCE(?, '')
      `).bind(
        transaction.id,
        transaction.tenant_id,
        transaction.company_id,
      ).all<ActiveTransactionCarbonEntry>();

      const current = activeRows || [];
      const isCurrent = current.length === carbonBatch.entries.length
        && carbonBatch.entries.every((expected) => current.some((entry) =>
          entry.part_id === expected.partId
          && Number(entry.activity_data) === expected.quantity
          && Number(entry.emission_factor) === expected.emissionFactor
          && Number(entry.co2e_kg) === expected.co2eKg
          && entry.reporting_period_start === transaction.date
          && entry.reporting_period_end === transaction.date
          && entry.emission_kind === expected.emissionKind
          && entry.calculation_method === expected.calculationMethod
          && Number(entry.source_transaction_version || 0) === Number(transaction.inventory_sync_version || 0)
        ));

      warnings.push(...carbonBatch.warnings.map((warning) => ({
        transactionId: transaction.id,
        partId: warning.partId,
        code: warning.code,
      })));

      if (isCurrent) {
        unchangedTransactions += 1;
        continue;
      }

      rebuiltTransactions += 1;
      invalidatedEntries += current.length;
      generatedEntries += carbonBatch.entries.length;
      for (const entry of carbonBatch.entries) {
        if (entry.emissionKind === 'actual') actualCo2eKg += entry.co2eKg;
        else avoidedCo2eKg += entry.co2eKg;
      }

      if (!dryRun) {
        await c.env.DB.batch(carbonBatch.statements);
      }
    }

    if (!dryRun && rebuiltTransactions > 0) {
      const scopeValues = scopeInsertValues(scopeContext, user);
      await logAudit(
        c.env.DB,
        user.id,
        'SYNC_TRANSACTION_CARBON',
        'ghg_emission_entries',
        transactionId || scopeValues.companyId || scopeValues.tenantId || 'carbon',
        auditDetails({
          transactionId,
          periodStart,
          periodEnd,
          transactionsScanned: (results || []).length,
          rebuiltTransactions,
          invalidatedEntries,
          generatedEntries,
          warningCount: warnings.length,
        }),
        scopeValues.tenantId,
        scopeValues.companyId,
      );
    }

    return c.json({
      success: true,
      data: {
        dryRun,
        transactionsScanned: (results || []).length,
        rebuiltTransactions,
        unchangedTransactions,
        invalidatedEntries,
        generatedEntries,
        actualCo2eKg: roundedKg(actualCo2eKg),
        avoidedCo2eKg: roundedKg(avoidedCo2eKg),
        warnings,
      },
    });
  } catch (err: any) {
    console.error('POST /ghg/transaction-emissions/sync error:', err);
    return c.json({ success: false, error: 'Internal Server Error' }, 500);
  }
});

// ============================================================================// DELETE /api/ghg/entries/:id
// ============================================================================
carbonRoutes.delete('/entries/:id', requirePermission(Permission.EDIT_CARBON), async (c) => {
  try {
    const user = c.get('user');
    const scopeContext = await resolveTenantScope(c);
    const scopeWhere = scopedWhere(scopeContext, 'tenant_id', 'company_id');
    const id = c.req.param('id')!;
    const existing = await c.env.DB.prepare(`
      SELECT id, source_type, scope, category_id, co2e_kg, tenant_id, company_id
      FROM ghg_emission_entries
      WHERE id = ? AND ${scopeWhere.clause}
    `)
      .bind(id, ...scopeWhere.params)
      .first<{
        id: string;
        source_type: string | null;
        scope: number;
        category_id: number | null;
        co2e_kg: number;
        tenant_id: string | null;
        company_id: string | null;
      }>();
    if (!existing) return c.json({ error: 'Entry not found' }, 404);
    if (existing.source_type === 'transaction') {
      return c.json({
        success: false,
        error: 'Transaction-generated carbon entries are managed by transaction lifecycle',
        code: 'GENERATED_ENTRY_IMMUTABLE',
      }, 409);
    }

    await c.env.DB.prepare(`DELETE FROM ghg_emission_entries WHERE id = ? AND ${scopeWhere.clause}`)
      .bind(id, ...scopeWhere.params)
      .run();
    await logAudit(
      c.env.DB,
      user.id,
      'DELETE_GHG_ENTRY',
      'ghg_emission_entries',
      id,
      auditDetails({
        sourceType: existing.source_type || 'manual',
        scope: existing.scope,
        category: existing.category_id,
        co2eKg: existing.co2e_kg,
      }),
      existing.tenant_id,
      existing.company_id,
    );
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
    const conditions: string[] = ['e.is_active = 1'];
    appendScopeCondition(conditions, params, scopeContext, 'e.tenant_id', 'e.company_id');
    if (periodStart) { conditions.push('e.reporting_period_end >= ?'); params.push(periodStart); }
    if (periodEnd) { conditions.push('e.reporting_period_start <= ?'); params.push(periodEnd); }
    const where = `WHERE ${conditions.join(' AND ')}`;

    const { results } = await c.env.DB.prepare(`
      SELECT
        e.scope,
        e.scope3_stream,
        e.category_id,
        COALESCE(e.source_type, 'manual') as source_type,
        e.emission_kind,
        COALESCE(e.source_movement_type, t.movement_type) as movement_type,
        COUNT(*) as entry_count,
        SUM(e.co2e_kg) as total_co2e_kg,
        SUM(e.activity_data) as total_activity
      FROM ghg_emission_entries e
      LEFT JOIN transactions t
        ON t.id = e.transaction_id
       AND (t.tenant_id = e.tenant_id OR (t.tenant_id IS NULL AND e.tenant_id IS NULL))
       AND (t.company_id = e.company_id OR (t.company_id IS NULL AND e.company_id IS NULL))
      ${where}
      GROUP BY e.scope, e.scope3_stream, e.category_id, source_type, e.emission_kind, movement_type
      ORDER BY e.scope, e.category_id, source_type
    `).bind(...params).all();

    // Manual entries and transaction-generated Purchases are actual emissions.
    // Redeploy and Recycle entries are avoided emissions and remain separate.
    const totals = await c.env.DB.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN e.emission_kind = 'actual' AND e.scope = 1 THEN e.co2e_kg ELSE 0 END), 0) as scope1_kg,
        COALESCE(SUM(CASE WHEN e.emission_kind = 'actual' AND e.scope = 2 THEN e.co2e_kg ELSE 0 END), 0) as scope2_kg,
        COALESCE(SUM(CASE WHEN e.emission_kind = 'actual' AND e.scope = 3 THEN e.co2e_kg ELSE 0 END), 0) as scope3_kg,
        COALESCE(SUM(CASE WHEN e.emission_kind = 'actual' THEN e.co2e_kg ELSE 0 END), 0) as total_kg,
        COALESCE(SUM(CASE WHEN e.emission_kind = 'avoided' THEN e.co2e_kg ELSE 0 END), 0) as avoided_co2e_kg,
        COALESCE(SUM(CASE WHEN e.emission_kind = 'avoided' AND COALESCE(e.source_movement_type, t.movement_type) = 'Redeploy' THEN e.co2e_kg ELSE 0 END), 0) as avoided_redeploy_kg,
        COALESCE(SUM(CASE WHEN e.emission_kind = 'avoided' AND COALESCE(e.source_movement_type, t.movement_type) = 'Recycle' THEN e.co2e_kg ELSE 0 END), 0) as avoided_recycle_kg
      FROM ghg_emission_entries e
      LEFT JOIN transactions t
        ON t.id = e.transaction_id
       AND (t.tenant_id = e.tenant_id OR (t.tenant_id IS NULL AND e.tenant_id IS NULL))
       AND (t.company_id = e.company_id OR (t.company_id IS NULL AND e.company_id IS NULL))
      ${where}
    `).bind(...params).first();

    const actualBreakdown = await c.env.DB.prepare(`
      SELECT
        e.scope,
        e.scope3_stream,
        e.category_id,
        COUNT(*) AS entry_count,
        COALESCE(SUM(e.co2e_kg), 0) AS total_co2e_kg,
        COALESCE(SUM(e.activity_data), 0) AS total_activity
      FROM ghg_emission_entries e
      ${where}
        AND e.emission_kind = 'actual'
      GROUP BY e.scope, e.scope3_stream, e.category_id
      ORDER BY e.scope, e.category_id
    `).bind(...params).all();

    const actualCount = await c.env.DB.prepare(`
      SELECT COUNT(*) AS entry_count
      FROM ghg_emission_entries e
      ${where}
        AND e.emission_kind = 'actual'
    `).bind(...params).first<{ entry_count: number }>();

    const avoidedCount = await c.env.DB.prepare(`
      SELECT COUNT(*) AS entry_count
      FROM ghg_emission_entries e
      ${where}
        AND e.emission_kind = 'avoided'
    `).bind(...params).first<{ entry_count: number }>();

    const avoidedByMovement = await c.env.DB.prepare(`
      SELECT
        COALESCE(e.source_movement_type, t.movement_type, 'Unknown') AS movement_type,
        COALESCE(SUM(e.co2e_kg), 0) AS co2e_kg,
        COUNT(*) AS entry_count
      FROM ghg_emission_entries e
      LEFT JOIN transactions t
        ON t.id = e.transaction_id
       AND (t.tenant_id = e.tenant_id OR (t.tenant_id IS NULL AND e.tenant_id IS NULL))
       AND (t.company_id = e.company_id OR (t.company_id IS NULL AND e.company_id IS NULL))
      ${where}
        AND e.emission_kind = 'avoided'
      GROUP BY movement_type
      ORDER BY movement_type
    `).bind(...params).all();

    const avoidedByPart = await c.env.DB.prepare(`
      SELECT
        e.part_id,
        p.part_number,
        p.model_name AS part_name,
        COALESCE(SUM(e.co2e_kg), 0) AS co2e_kg,
        COALESCE(SUM(e.activity_data), 0) AS quantity,
        COUNT(*) AS entry_count
      FROM ghg_emission_entries e
      LEFT JOIN parts p
        ON p.id = e.part_id
       AND (p.tenant_id = e.tenant_id OR (p.tenant_id IS NULL AND e.tenant_id IS NULL))
       AND (p.company_id = e.company_id OR (p.company_id IS NULL AND e.company_id IS NULL))
      ${where}
        AND e.emission_kind = 'avoided'
      GROUP BY e.part_id, p.part_number, p.model_name
      ORDER BY co2e_kg DESC, p.part_number
      LIMIT 20
    `).bind(...params).all();

    const t = totals as any;
    const actualTotal = Number(t?.total_kg || 0);
    const avoidedTotal = Number(t?.avoided_co2e_kg || 0);

    return c.json({
      success: true,
      breakdown: results || [],
      totals: {
        scope1_kg: Number(t?.scope1_kg || 0),
        scope2_kg: Number(t?.scope2_kg || 0),
        scope3_kg: Number(t?.scope3_kg || 0),
        total_kg: actualTotal,
        avoided_co2e_kg: avoidedTotal,
        avoided_redeploy_kg: Number(t?.avoided_redeploy_kg || 0),
        avoided_recycle_kg: Number(t?.avoided_recycle_kg || 0),
      },
      actual: {
        total_co2e_kg: actualTotal,
        scope1_kg: Number(t?.scope1_kg || 0),
        scope2_kg: Number(t?.scope2_kg || 0),
        scope3_kg: Number(t?.scope3_kg || 0),
        entry_count: actualCount?.entry_count || 0,
        breakdown: actualBreakdown.results || [],
      },
      avoided: {
        total_co2e_kg: avoidedTotal,
        entry_count: avoidedCount?.entry_count || 0,
        by_movement_type: avoidedByMovement.results || [],
        by_part: avoidedByPart.results || [],
      },
      net: {
        actual_minus_avoided_co2e_kg: actualTotal - avoidedTotal,
      },
    });
  } catch (err: any) {
    console.error('GET /ghg/report error:', err);
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});
