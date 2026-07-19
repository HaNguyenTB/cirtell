-- Add lifecycle and classification for transaction-derived carbon entries.
-- Transaction date is the effective reporting date. Generated history is retained
-- while reports include active entries only.

ALTER TABLE ghg_emission_entries ADD COLUMN emission_kind TEXT NOT NULL DEFAULT 'actual'
  CHECK (emission_kind IN ('actual', 'avoided'));
ALTER TABLE ghg_emission_entries ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1
  CHECK (is_active IN (0, 1));
ALTER TABLE ghg_emission_entries ADD COLUMN invalidated_at TEXT;
ALTER TABLE ghg_emission_entries ADD COLUMN invalidated_by TEXT;
ALTER TABLE ghg_emission_entries ADD COLUMN invalidation_reason TEXT;
ALTER TABLE ghg_emission_entries ADD COLUMN source_transaction_version INTEGER;

UPDATE ghg_emission_entries
SET emission_kind = 'avoided'
WHERE source_type = 'transaction'
  AND (
    calculation_method = 'avoided_emissions_v1'
    OR source_movement_type IN ('Redeploy', 'Recycle')
  );

UPDATE ghg_emission_entries
SET
  is_active = 0,
  invalidated_at = COALESCE((
    SELECT t.voided_at FROM transactions t WHERE t.id = ghg_emission_entries.transaction_id
  ), datetime('now')),
  invalidation_reason = 'transaction_voided'
WHERE source_type = 'transaction'
  AND EXISTS (
    SELECT 1
    FROM transactions t
    WHERE t.id = ghg_emission_entries.transaction_id
      AND t.voided_at IS NOT NULL
  );

DROP INDEX IF EXISTS ux_ghg_avoided_transaction_part_method;

CREATE UNIQUE INDEX IF NOT EXISTS ux_ghg_active_transaction_part_method
ON ghg_emission_entries(
  COALESCE(tenant_id, '__GLOBAL__'),
  COALESCE(company_id, '__TENANT__'),
  transaction_id,
  part_id,
  calculation_method
)
WHERE source_type = 'transaction'
  AND is_active = 1
  AND transaction_id IS NOT NULL
  AND part_id IS NOT NULL
  AND calculation_method IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ghg_active_scope_period
ON ghg_emission_entries(
  tenant_id,
  company_id,
  is_active,
  emission_kind,
  scope,
  reporting_period_start,
  reporting_period_end
);

WITH eligible_transactions AS (
  SELECT
    t.id,
    t.tenant_id,
    t.company_id,
    t.date,
    t.part_id,
    t.quantity,
    t.created_by,
    t.inventory_sync_version
  FROM transactions t
  WHERE t.movement_type = 'Purchase'
    AND t.voided_at IS NULL
    AND t.inventory_sync_status = 'synced'
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
    t.created_by,
    t.inventory_sync_version,
    ai.part_id,
    ai.quantity
  FROM eligible_transactions t
  JOIN active_items ai ON ai.transaction_id = t.id

  UNION ALL

  SELECT
    t.id,
    t.tenant_id,
    t.company_id,
    t.date,
    t.created_by,
    t.inventory_sync_version,
    t.part_id,
    t.quantity
  FROM eligible_transactions t
  WHERE t.part_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM active_items ai WHERE ai.transaction_id = t.id
    )
)
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
)
SELECT
  lower(
    hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' ||
    hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6))
  ),
  c.tenant_id,
  c.company_id,
  c.created_by,
  3,
  1,
  'upstream',
  'Scope 3 purchased goods from transaction ' || c.transaction_id,
  c.quantity,
  'unit',
  p.emission_factor_kg,
  'kgCO2e/unit',
  'parts.emission_factor_kg',
  c.quantity * p.emission_factor_kg,
  c.date,
  c.date,
  'estimated',
  'Generated from Purchase: scope3_co2e_kg = quantity * part.emission_factor_kg',
  'transaction',
  c.transaction_id,
  c.part_id,
  'purchase_scope3_v1',
  'parts.emission_factor_kg',
  NULL,
  'actual',
  1,
  c.inventory_sync_version
FROM candidates c
JOIN parts p
  ON p.id = c.part_id
 AND COALESCE(p.tenant_id, '') = COALESCE(c.tenant_id, '')
 AND COALESCE(p.company_id, '') = COALESCE(c.company_id, '')
WHERE c.quantity > 0
  AND p.emission_factor_kg > 0
  AND NOT EXISTS (
    SELECT 1
    FROM ghg_emission_entries e
    WHERE e.source_type = 'transaction'
      AND e.is_active = 1
      AND e.transaction_id = c.transaction_id
      AND e.part_id = c.part_id
      AND e.calculation_method = 'purchase_scope3_v1'
  );


WITH eligible_transactions AS (
  SELECT t.id, t.tenant_id, t.company_id, t.date, t.movement_type,
    t.part_id, t.quantity, t.created_by, t.inventory_sync_version
  FROM transactions t
  WHERE t.movement_type IN ('Redeploy', 'Recycle')
    AND t.voided_at IS NULL
    AND t.inventory_sync_status = 'synced'
),
active_items AS (
  SELECT ti.transaction_id, ti.part_id, SUM(ti.quantity) AS quantity
  FROM transaction_items ti
  JOIN eligible_transactions t ON t.id = ti.transaction_id
  WHERE ti.superseded_at IS NULL AND ti.part_id IS NOT NULL
  GROUP BY ti.transaction_id, ti.part_id
),
candidates AS (
  SELECT t.id AS transaction_id, t.tenant_id, t.company_id, t.date,
    t.movement_type, t.created_by, t.inventory_sync_version,
    ai.part_id, ai.quantity
  FROM eligible_transactions t
  JOIN active_items ai ON ai.transaction_id = t.id
  UNION ALL
  SELECT t.id, t.tenant_id, t.company_id, t.date, t.movement_type,
    t.created_by, t.inventory_sync_version, t.part_id, t.quantity
  FROM eligible_transactions t
  WHERE t.part_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM active_items ai WHERE ai.transaction_id = t.id)
)
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
)
SELECT
  lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' ||
    hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6))),
  c.tenant_id, c.company_id, c.created_by,
  3, NULL, NULL,
  'Avoided emissions from ' || c.movement_type || ' transaction ' || c.transaction_id,
  c.quantity, 'unit', p.emission_factor_kg, 'kgCO2e/unit',
  'parts.emission_factor_kg', c.quantity * p.emission_factor_kg,
  c.date, c.date, 'estimated',
  'Generated from circular transaction: avoided_co2e_kg = quantity * part.emission_factor_kg',
  'transaction', c.transaction_id, c.part_id, 'avoided_emissions_v1',
  'parts.emission_factor_kg', c.movement_type,
  'avoided', 1, c.inventory_sync_version
FROM candidates c
JOIN parts p
  ON p.id = c.part_id
 AND COALESCE(p.tenant_id, '') = COALESCE(c.tenant_id, '')
 AND COALESCE(p.company_id, '') = COALESCE(c.company_id, '')
WHERE c.quantity > 0
  AND p.emission_factor_kg > 0
  AND NOT EXISTS (
    SELECT 1 FROM ghg_emission_entries e
    WHERE e.source_type = 'transaction'
      AND e.is_active = 1
      AND e.transaction_id = c.transaction_id
      AND e.part_id = c.part_id
      AND e.calculation_method = 'avoided_emissions_v1'
  );
