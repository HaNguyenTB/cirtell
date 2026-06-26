-- Complete transaction-derived avoided emissions provenance.
-- Prior migrations introduced the main columns; this migration adds the source
-- movement type and standardizes the idempotency index used by sync.

ALTER TABLE ghg_emission_entries ADD COLUMN source_movement_type TEXT
  CHECK (
    source_movement_type IN ('Redeploy', 'Recycle')
    OR source_movement_type IS NULL
  );

UPDATE ghg_emission_entries
SET source_type = 'manual'
WHERE source_type IS NULL;

DROP INDEX IF EXISTS idx_ghg_avoided_transaction_part_method;
DROP INDEX IF EXISTS ux_ghg_avoided_transaction_part_method;

CREATE INDEX IF NOT EXISTS idx_ghg_source_type
ON ghg_emission_entries(
  tenant_id,
  company_id,
  source_type
);

CREATE INDEX IF NOT EXISTS idx_ghg_transaction_part
ON ghg_emission_entries(
  transaction_id,
  part_id
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_ghg_avoided_transaction_part_method
ON ghg_emission_entries(
  tenant_id,
  company_id,
  transaction_id,
  part_id,
  calculation_method
)
WHERE
  source_type = 'transaction'
  AND transaction_id IS NOT NULL
  AND part_id IS NOT NULL
  AND calculation_method IS NOT NULL;
