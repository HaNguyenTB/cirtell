import { normalizeInventoryCondition, type InventoryCondition } from './inventorySync';

type SQLValue = string | number | null;

export type ProjectTransactionMovementType = 'Purchase' | 'Sale' | 'Redeploy' | 'Recycle';
export type ProjectMaterialStage = 'acquisition' | 'sold' | 'redeployment' | 'recycling';
export type ProjectFinancialType = 'cost' | 'revenue' | 'credit';

export interface ProjectProjectionScope {
  tenantId: string | null;
  companyId: string | null;
}

export interface ProjectProjectionWarning {
  code: 'MISSING_PART' | 'MISSING_EMISSION_FACTOR' | 'INVALID_CONDITION';
  message: string;
  transactionId: string;
  transactionItemId: string | null;
  partId: string | null;
}

export interface ProjectedEquipment {
  id: string;
  projectId: string;
  partId: string;
  partNumber: string | null;
  itemName: string;
  vendor: string | null;
  category: string | null;
  serialNumber: string | null;
  condition: InventoryCondition;
  quantity: number;
  currentStage: ProjectMaterialStage;
  weightKg: number | null;
  estimatedReuseValue: number;
  transactionValue: number;
  co2AvoidedKg: number | null;
  source: 'transaction';
  readOnly: true;
  transactionIds: string[];
  inventorySyncStatuses: string[];
}

export interface ProjectedFinancial {
  id: string;
  projectId: string;
  transactionId: string;
  movementType: ProjectTransactionMovementType;
  type: ProjectFinancialType;
  category: string;
  description: string;
  amount: number;
  currency: string;
  stage: ProjectMaterialStage;
  incurredAt: string;
  source: 'transaction';
  readOnly: true;
}

export interface ProjectTransactionProjection {
  projectedEquipment: ProjectedEquipment[];
  projectedFinancials: ProjectedFinancial[];
  transactionSummary: {
    transactionCount: number;
    lineCount: number;
    totalTransactionValue: number;
    purchaseCost: number;
    salesRevenue: number;
    redeploymentCredit: number;
    recyclingRevenue: number;
    projectedCo2AvoidedKg: number;
  };
  reconciliationWarnings: ProjectProjectionWarning[];
}

export interface BuildProjectTransactionProjectionInput {
  db: D1Database;
  projectId: string;
  scope: ProjectProjectionScope;
}

interface ProjectRow {
  id: string;
  currency: string | null;
}

interface ProjectionLineRow {
  transaction_id: string;
  transaction_item_id: string | null;
  date: string;
  movement_type: ProjectTransactionMovementType;
  quantity: number;
  unit_price_usd: number | null;
  part_id: string | null;
  serial_number: string | null;
  condition: string | null;
  inventory_sync_status: string;
  created_at: string;
  part_number: string | null;
  model_name: string | null;
  category: string | null;
  weight_kg: number | null;
  emission_factor_kg: number | null;
  vendor_name: string | null;
}

interface EquipmentAccumulator extends ProjectedEquipment {
  transactionIdSet: Set<string>;
  inventorySyncStatusSet: Set<string>;
  missingEmissionFactor: boolean;
}

interface FinancialAccumulator {
  transactionId: string;
  movementType: ProjectTransactionMovementType;
  date: string;
  amount: number;
}

export class ProjectTransactionProjectionError extends Error {
  constructor(message: string, public readonly code: 'INVALID_SCOPE' | 'PROJECT_NOT_FOUND') {
    super(message);
    this.name = 'ProjectTransactionProjectionError';
  }
}

const MOVEMENT_STAGE: Record<ProjectTransactionMovementType, ProjectMaterialStage> = {
  Purchase: 'acquisition',
  Sale: 'sold',
  Redeploy: 'redeployment',
  Recycle: 'recycling',
};

const FINANCIAL_MAPPING: Record<ProjectTransactionMovementType, {
  type: ProjectFinancialType;
  category: string;
  description: string;
}> = {
  Purchase: { type: 'cost', category: 'Transaction purchase', description: 'Purchase transaction' },
  Sale: { type: 'revenue', category: 'Transaction sale', description: 'Sale transaction' },
  Redeploy: { type: 'credit', category: 'Redeployment value', description: 'Redeployment transaction value' },
  Recycle: { type: 'revenue', category: 'Material recovery', description: 'Recycling recovery value' },
};

function scopeClause(scope: ProjectProjectionScope, alias: string): { clause: string; params: SQLValue[] } {
  const prefix = alias ? `${alias}.` : '';
  if (scope.tenantId && scope.companyId) {
    return {
      clause: `${prefix}tenant_id = ? AND ${prefix}company_id = ?`,
      params: [scope.tenantId, scope.companyId],
    };
  }
  if (scope.companyId) return { clause: `${prefix}company_id = ?`, params: [scope.companyId] };
  if (scope.tenantId) return { clause: `${prefix}tenant_id = ?`, params: [scope.tenantId] };
  throw new ProjectTransactionProjectionError('A tenant or company scope is required', 'INVALID_SCOPE');
}

function finiteNumber(value: number | null | undefined): number {
  return Number.isFinite(value) ? Number(value) : 0;
}

function projectionId(parts: Array<string | null>): string {
  return `projection:${parts.map((part) => encodeURIComponent(part || '')).join(':')}`;
}

function projectionCondition(
  row: ProjectionLineRow,
  warnings: ProjectProjectionWarning[],
): InventoryCondition {
  try {
    return normalizeInventoryCondition(row.condition);
  } catch {
    warnings.push({
      code: 'INVALID_CONDITION',
      message: `Transaction condition '${row.condition || ''}' is invalid; Good was used for projection`,
      transactionId: row.transaction_id,
      transactionItemId: row.transaction_item_id,
      partId: row.part_id,
    });
    return 'Good';
  }
}

function toProjectedFinancial(
  projectId: string,
  currency: string,
  item: FinancialAccumulator,
): ProjectedFinancial {
  const mapping = FINANCIAL_MAPPING[item.movementType];
  return {
    id: `transaction:${item.transactionId}`,
    projectId,
    transactionId: item.transactionId,
    movementType: item.movementType,
    type: mapping.type,
    category: mapping.category,
    description: mapping.description,
    amount: item.amount,
    currency,
    stage: MOVEMENT_STAGE[item.movementType],
    incurredAt: item.date,
    source: 'transaction',
    readOnly: true,
  };
}

export async function buildProjectTransactionProjection(
  input: BuildProjectTransactionProjectionInput,
): Promise<ProjectTransactionProjection> {
  const { db, projectId, scope } = input;
  const projectScope = scopeClause(scope, 'p');
  const project = await db.prepare(`
    SELECT p.id, p.currency
    FROM projects p
    WHERE p.id = ? AND ${projectScope.clause}
    LIMIT 1
  `).bind(projectId, ...projectScope.params).first<ProjectRow>();

  if (!project) {
    throw new ProjectTransactionProjectionError('Project not found', 'PROJECT_NOT_FOUND');
  }

  const transactionScope = scopeClause(scope, 't');
  const { results } = await db.prepare(`
    WITH scoped_transactions AS (
      SELECT t.*
      FROM transactions t
      WHERE t.project_id = ?
        AND t.voided_at IS NULL
        AND ${transactionScope.clause}
    )
    SELECT
      t.id AS transaction_id, ti.id AS transaction_item_id, t.date, t.movement_type,
      ti.quantity, ti.unit_price_usd, ti.part_id, ti.serial_number, ti.condition,
      t.inventory_sync_status, t.created_at, p.part_number, p.model_name, p.category,
      p.weight_kg, p.emission_factor_kg, v.vendor_name
    FROM scoped_transactions t
    JOIN transaction_items ti ON ti.transaction_id = t.id AND ti.superseded_at IS NULL
    LEFT JOIN parts p ON p.id = ti.part_id
      AND COALESCE(p.tenant_id, '') = COALESCE(t.tenant_id, '')
      AND COALESCE(p.company_id, '') = COALESCE(t.company_id, '')
    LEFT JOIN vendors v ON v.id = p.vendor_id
      AND COALESCE(v.tenant_id, '') = COALESCE(t.tenant_id, '')
      AND COALESCE(v.company_id, '') = COALESCE(t.company_id, '')

    UNION ALL

    SELECT
      t.id, NULL, t.date, t.movement_type, t.quantity, t.unit_price_usd, t.part_id,
      t.serial_number, t.condition, t.inventory_sync_status, t.created_at, p.part_number,
      p.model_name, p.category, p.weight_kg, p.emission_factor_kg, v.vendor_name
    FROM scoped_transactions t
    LEFT JOIN parts p ON p.id = t.part_id
      AND COALESCE(p.tenant_id, '') = COALESCE(t.tenant_id, '')
      AND COALESCE(p.company_id, '') = COALESCE(t.company_id, '')
    LEFT JOIN vendors v ON v.id = p.vendor_id
      AND COALESCE(v.tenant_id, '') = COALESCE(t.tenant_id, '')
      AND COALESCE(v.company_id, '') = COALESCE(t.company_id, '')
    WHERE NOT EXISTS (
      SELECT 1 FROM transaction_items ti
      WHERE ti.transaction_id = t.id AND ti.superseded_at IS NULL
    )

    ORDER BY 3, 11, 1, 2
  `).bind(projectId, ...transactionScope.params).all<ProjectionLineRow>();

  const rows = results || [];
  const warnings: ProjectProjectionWarning[] = [];
  const equipment = new Map<string, EquipmentAccumulator>();
  const financials = new Map<string, FinancialAccumulator>();
  const transactionIds = new Set<string>();

  for (const row of rows) {
    transactionIds.add(row.transaction_id);
    const quantity = finiteNumber(row.quantity);
    const lineValue = quantity * finiteNumber(row.unit_price_usd);
    const financial = financials.get(row.transaction_id);
    if (financial) {
      financial.amount += lineValue;
    } else {
      financials.set(row.transaction_id, {
        transactionId: row.transaction_id,
        movementType: row.movement_type,
        date: row.date,
        amount: lineValue,
      });
    }

    if (!row.part_id) {
      warnings.push({
        code: 'MISSING_PART',
        message: 'Transaction line cannot be projected into Materials & Assets without a part',
        transactionId: row.transaction_id,
        transactionItemId: row.transaction_item_id,
        partId: null,
      });
      continue;
    }

    const condition = projectionCondition(row, warnings);
    const stage = MOVEMENT_STAGE[row.movement_type];
    const serial = (row.serial_number || '').trim().toLowerCase();
    const key = [row.part_id, serial, condition, stage].join('\u001f');
    const avoidedMovement = row.movement_type === 'Redeploy' || row.movement_type === 'Recycle';
    const factor = finiteNumber(row.emission_factor_kg);
    const hasFactor = factor > 0;
    const avoided = avoidedMovement && hasFactor ? quantity * factor : 0;

    if (avoidedMovement && !hasFactor) {
      warnings.push({
        code: 'MISSING_EMISSION_FACTOR',
        message: 'Avoided emissions could not be projected because the part has no emission factor',
        transactionId: row.transaction_id,
        transactionItemId: row.transaction_item_id,
        partId: row.part_id,
      });
    }

    const current = equipment.get(key);
    if (current) {
      current.quantity += quantity;
      current.transactionValue += lineValue;
      current.estimatedReuseValue += lineValue;
      if (avoidedMovement && hasFactor) current.co2AvoidedKg = (current.co2AvoidedKg || 0) + avoided;
      current.missingEmissionFactor ||= avoidedMovement && !hasFactor;
      current.transactionIdSet.add(row.transaction_id);
      current.inventorySyncStatusSet.add(row.inventory_sync_status);
      continue;
    }

    equipment.set(key, {
      id: projectionId([projectId, row.part_id, serial, condition, stage]),
      projectId,
      partId: row.part_id,
      partNumber: row.part_number,
      itemName: row.model_name || row.part_number || row.part_id,
      vendor: row.vendor_name,
      category: row.category,
      serialNumber: row.serial_number,
      condition,
      quantity,
      currentStage: stage,
      weightKg: row.weight_kg,
      estimatedReuseValue: lineValue,
      transactionValue: lineValue,
      co2AvoidedKg: avoidedMovement ? (hasFactor ? avoided : null) : 0,
      source: 'transaction',
      readOnly: true,
      transactionIds: [],
      inventorySyncStatuses: [],
      transactionIdSet: new Set([row.transaction_id]),
      inventorySyncStatusSet: new Set([row.inventory_sync_status]),
      missingEmissionFactor: avoidedMovement && !hasFactor,
    });
  }

  const projectedEquipment: ProjectedEquipment[] = [...equipment.values()].map((item) => {
    const { transactionIdSet, inventorySyncStatusSet, missingEmissionFactor, ...result } = item;
    return {
      ...result,
      co2AvoidedKg: missingEmissionFactor ? null : result.co2AvoidedKg,
      transactionIds: [...transactionIdSet],
      inventorySyncStatuses: [...inventorySyncStatusSet],
    };
  });

  const projectedFinancials = [...financials.values()].map((item) =>
    toProjectedFinancial(projectId, project.currency || 'USD', item));
  const sumMovement = (type: ProjectTransactionMovementType) => projectedFinancials
    .filter((item) => item.movementType === type)
    .reduce((sum, item) => sum + item.amount, 0);

  return {
    projectedEquipment,
    projectedFinancials,
    transactionSummary: {
      transactionCount: transactionIds.size,
      lineCount: rows.length,
      totalTransactionValue: projectedFinancials.reduce((sum, item) => sum + item.amount, 0),
      purchaseCost: sumMovement('Purchase'),
      salesRevenue: sumMovement('Sale'),
      redeploymentCredit: sumMovement('Redeploy'),
      recyclingRevenue: sumMovement('Recycle'),
      projectedCo2AvoidedKg: projectedEquipment.reduce((sum, item) => sum + (item.co2AvoidedKg || 0), 0),
    },
    reconciliationWarnings: warnings,
  };
}
