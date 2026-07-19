import type { ScopeValues, TransactionMovementType } from './inventorySync';

export type TransactionEmissionKind = 'actual' | 'avoided';

export interface TransactionCarbonItemInput {
  partId?: string | null;
  quantity?: number | null;
}

export interface TransactionCarbonInput {
  id: string;
  movementType: TransactionMovementType;
  date: string;
  partId?: string | null;
  quantity?: number | null;
  inventorySyncStatus: string;
  syncVersion: number;
  items?: TransactionCarbonItemInput[];
  createdBy: string;
  createdAt: string;
}

export interface GeneratedTransactionCarbonEntry {
  id: string;
  partId: string;
  quantity: number;
  emissionFactor: number;
  co2eKg: number;
  emissionKind: TransactionEmissionKind;
  calculationMethod: 'purchase_scope3_v1' | 'avoided_emissions_v1';
}

export interface PreparedTransactionCarbonBatch {
  statements: D1PreparedStatement[];
  entries: GeneratedTransactionCarbonEntry[];
  warnings: Array<{ partId: string; code: 'MISSING_EMISSION_FACTOR' }>;
}

interface PartFactorRow {
  id: string;
  emission_factor_kg: number | null;
}

function scopeClause(ownership: ScopeValues): { clause: string; params: Array<string | null> } {
  return {
    clause: 'COALESCE(tenant_id, \'\') = COALESCE(?, \'\') AND COALESCE(company_id, \'\') = COALESCE(?, \'\')',
    params: [ownership.tenantId, ownership.companyId],
  };
}

function aggregateItems(input: TransactionCarbonInput): Map<string, number> {
  const totals = new Map<string, number>();
  const items = input.items && input.items.length > 0
    ? input.items
    : [{ partId: input.partId, quantity: input.quantity }];

  for (const item of items) {
    const partId = typeof item.partId === 'string' ? item.partId.trim() : '';
    const quantity = Number(item.quantity);
    if (!partId || !Number.isFinite(quantity) || quantity <= 0) continue;
    totals.set(partId, (totals.get(partId) || 0) + quantity);
  }
  return totals;
}

export async function prepareTransactionCarbonBatch(
  db: D1Database,
  input: TransactionCarbonInput,
  ownership: ScopeValues,
  invalidationReason: 'create' | 'update' | 'void',
): Promise<PreparedTransactionCarbonBatch> {
  const scoped = scopeClause(ownership);
  const statements: D1PreparedStatement[] = [
    db.prepare(`
      UPDATE ghg_emission_entries
      SET is_active = 0,
          invalidated_at = ?,
          invalidated_by = ?,
          invalidation_reason = ?,
          updated_at = ?
      WHERE source_type = 'transaction'
        AND transaction_id = ?
        AND is_active = 1
        AND ${scoped.clause}
    `).bind(
      input.createdAt,
      input.createdBy,
      `transaction_${invalidationReason}`,
      input.createdAt,
      input.id,
      ...scoped.params,
    ),
  ];

  if (
    invalidationReason === 'void'
    || input.inventorySyncStatus !== 'synced'
    || !['Purchase', 'Redeploy', 'Recycle'].includes(input.movementType)
  ) {
    return { statements, entries: [], warnings: [] };
  }

  const totals = aggregateItems(input);
  const partIds = [...totals.keys()];
  if (partIds.length === 0) return { statements, entries: [], warnings: [] };

  const placeholders = partIds.map(() => '?').join(', ');
  const { results } = await db.prepare(`
    SELECT id, emission_factor_kg
    FROM parts
    WHERE id IN (${placeholders})
      AND ${scoped.clause}
  `).bind(...partIds, ...scoped.params).all<PartFactorRow>();
  const factors = new Map((results || []).map((row) => [row.id, Number(row.emission_factor_kg || 0)]));

  const entries: GeneratedTransactionCarbonEntry[] = [];
  const warnings: PreparedTransactionCarbonBatch['warnings'] = [];
  const emissionKind: TransactionEmissionKind = input.movementType === 'Purchase' ? 'actual' : 'avoided';
  const calculationMethod = input.movementType === 'Purchase'
    ? 'purchase_scope3_v1' as const
    : 'avoided_emissions_v1' as const;

  for (const [partId, quantity] of totals) {
    const factor = factors.get(partId) || 0;
    if (factor <= 0) {
      warnings.push({ partId, code: 'MISSING_EMISSION_FACTOR' });
      continue;
    }

    const entry: GeneratedTransactionCarbonEntry = {
      id: crypto.randomUUID(),
      partId,
      quantity,
      emissionFactor: factor,
      co2eKg: quantity * factor,
      emissionKind,
      calculationMethod,
    };
    entries.push(entry);

    const isPurchase = input.movementType === 'Purchase';
    statements.push(db.prepare(`
      INSERT INTO ghg_emission_entries (
        id, tenant_id, company_id, created_by,
        scope, category_id, scope3_stream, source_description,
        activity_data, activity_unit, emission_factor, emission_factor_unit,
        emission_factor_source, co2e_kg,
        reporting_period_start, reporting_period_end,
        data_quality, methodology_notes,
        source_type, transaction_id, part_id, calculation_method,
        factor_source, source_movement_type,
        emission_kind, is_active, source_transaction_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      entry.id,
      ownership.tenantId,
      ownership.companyId,
      input.createdBy,
      3,
      isPurchase ? 1 : null,
      isPurchase ? 'upstream' : null,
      isPurchase
        ? `Scope 3 purchased goods from transaction ${input.id}`
        : `Avoided emissions from ${input.movementType} transaction ${input.id}`,
      quantity,
      'unit',
      factor,
      'kgCO2e/unit',
      'parts.emission_factor_kg',
      entry.co2eKg,
      input.date,
      input.date,
      'estimated',
      isPurchase
        ? 'Generated from Purchase: scope3_co2e_kg = quantity * part.emission_factor_kg'
        : 'Generated from circular transaction: avoided_co2e_kg = quantity * part.emission_factor_kg',
      'transaction',
      input.id,
      partId,
      calculationMethod,
      'parts.emission_factor_kg',
      isPurchase ? null : input.movementType,
      emissionKind,
      1,
      input.syncVersion,
    ));
  }

  return { statements, entries, warnings };
}
