-- Carbon accounting provenance for calculated avoided emissions.
-- Manual GHG entries remain the default; transaction-derived entries are
-- idempotent by transaction, part and calculation method.

ALTER TABLE ghg_emission_entries ADD COLUMN source_type TEXT NOT NULL DEFAULT 'manual'
  CHECK (source_type IN ('manual', 'transaction', 'warehouse', 'project'));
ALTER TABLE ghg_emission_entries ADD COLUMN transaction_id TEXT;
ALTER TABLE ghg_emission_entries ADD COLUMN part_id TEXT;
ALTER TABLE ghg_emission_entries ADD COLUMN calculation_method TEXT;
ALTER TABLE ghg_emission_entries ADD COLUMN factor_source TEXT;

CREATE INDEX IF NOT EXISTS idx_ghg_source_type
  ON ghg_emission_entries(tenant_id, company_id, source_type);

CREATE INDEX IF NOT EXISTS idx_ghg_transaction_part
  ON ghg_emission_entries(transaction_id, part_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ghg_avoided_transaction_part_method
  ON ghg_emission_entries(
    COALESCE(tenant_id, 'global'),
    COALESCE(company_id, 'tenant'),
    transaction_id,
    part_id,
    calculation_method
  )
  WHERE source_type = 'transaction'
    AND transaction_id IS NOT NULL
    AND part_id IS NOT NULL
    AND calculation_method IS NOT NULL;
