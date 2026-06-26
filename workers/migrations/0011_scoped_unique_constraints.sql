-- Scope business uniqueness for the multi-tenant schema.
-- Inline UNIQUE constraints from early single-tenant migrations cannot be dropped
-- directly in SQLite/D1, so the affected tables are rebuilt without global
-- uniqueness and then protected by tenant/company-scoped unique indexes.

PRAGMA foreign_keys = off;

-- ---------------------------------------------------------------------------
-- Vendors: move from global vendor_name uniqueness to scoped uniqueness.
-- Existing global vendors are assigned to the first scope found through parts,
-- falling back to the default Cirtell company used by legacy demo data.
-- ---------------------------------------------------------------------------
CREATE TABLE vendors_scoped (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  company_id TEXT,
  vendor_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO vendors_scoped (id, tenant_id, company_id, vendor_name, created_at)
SELECT
  v.id,
  COALESCE(
    (SELECT p.tenant_id FROM parts p WHERE p.vendor_id = v.id AND p.tenant_id IS NOT NULL LIMIT 1),
    'tenant_cirtell_default'
  ) AS tenant_id,
  COALESCE(
    (SELECT p.company_id FROM parts p WHERE p.vendor_id = v.id AND p.company_id IS NOT NULL LIMIT 1),
    'company_cirtell_default'
  ) AS company_id,
  v.vendor_name,
  v.created_at
FROM vendors v;

DROP TABLE vendors;
ALTER TABLE vendors_scoped RENAME TO vendors;

CREATE INDEX IF NOT EXISTS idx_vendors_tenant_company
  ON vendors(tenant_id, company_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendors_name_scope
  ON vendors(COALESCE(tenant_id, 'global'), COALESCE(company_id, 'tenant'), LOWER(vendor_name));

-- ---------------------------------------------------------------------------
-- Parts: replace global part_number uniqueness with scoped uniqueness.
-- ---------------------------------------------------------------------------
CREATE TABLE parts_scoped (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  company_id TEXT,
  part_number TEXT NOT NULL,
  manufacturer_part_number TEXT,
  model_name TEXT,
  vendor_id TEXT REFERENCES vendors(id),
  technology_type TEXT,
  weight_kg REAL,
  emission_factor_kg REAL,
  manufacture_start_year INTEGER,
  manufacture_end_year INTEGER,
  category TEXT,
  subcategory TEXT,
  description TEXT,
  needs_review INTEGER NOT NULL DEFAULT 0,
  review_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO parts_scoped (
  id, tenant_id, company_id, part_number, manufacturer_part_number, model_name, vendor_id,
  technology_type, weight_kg, emission_factor_kg, manufacture_start_year, manufacture_end_year,
  category, subcategory, description, needs_review, review_notes, created_at, updated_at
)
SELECT
  id, tenant_id, company_id, part_number, manufacturer_part_number, model_name, vendor_id,
  technology_type, weight_kg, emission_factor_kg, manufacture_start_year, manufacture_end_year,
  category, subcategory, description, needs_review, review_notes, created_at, updated_at
FROM parts;

DROP TABLE parts;
ALTER TABLE parts_scoped RENAME TO parts;

CREATE UNIQUE INDEX IF NOT EXISTS idx_parts_part_number_scope
  ON parts(COALESCE(tenant_id, 'global'), COALESCE(company_id, 'tenant'), LOWER(part_number));
CREATE INDEX IF NOT EXISTS idx_parts_part_number ON parts(part_number);
CREATE INDEX IF NOT EXISTS idx_parts_category ON parts(category);
CREATE INDEX IF NOT EXISTS idx_parts_vendor ON parts(vendor_id);
CREATE INDEX IF NOT EXISTS idx_parts_tenant_company ON parts(tenant_id, company_id);

-- ---------------------------------------------------------------------------
-- Warehouses: code is unique inside a tenant/company scope; names are labels.
-- ---------------------------------------------------------------------------
CREATE TABLE warehouses_scoped (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  company_id TEXT,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  address TEXT,
  city TEXT,
  country TEXT,
  capacity_units INTEGER,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO warehouses_scoped (
  id, tenant_id, company_id, name, code, address, city, country,
  capacity_units, status, notes, created_at, updated_at
)
SELECT
  id, tenant_id, company_id, name, code, address, city, country,
  capacity_units, status, notes, created_at, updated_at
FROM warehouses;

DROP TABLE warehouses;
ALTER TABLE warehouses_scoped RENAME TO warehouses;

CREATE INDEX IF NOT EXISTS idx_warehouses_tenant_company
  ON warehouses(tenant_id, company_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_warehouses_code_scope
  ON warehouses(COALESCE(tenant_id, 'global'), COALESCE(company_id, 'tenant'), UPPER(code));
CREATE INDEX IF NOT EXISTS idx_warehouses_name_scope
  ON warehouses(tenant_id, company_id, name);

-- ---------------------------------------------------------------------------
-- Markets: market names can repeat across tenant/company scopes.
-- ---------------------------------------------------------------------------
CREATE TABLE markets_scoped (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  company_id TEXT,
  market_name TEXT NOT NULL,
  country TEXT,
  region TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO markets_scoped (
  id, tenant_id, company_id, market_name, country, region, created_at, updated_at
)
SELECT
  id, tenant_id, company_id, market_name, country, region, created_at, updated_at
FROM markets;

DROP TABLE markets;
ALTER TABLE markets_scoped RENAME TO markets;

CREATE INDEX IF NOT EXISTS idx_markets_tenant_company
  ON markets(tenant_id, company_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_markets_name_scope
  ON markets(COALESCE(tenant_id, 'global'), COALESCE(company_id, 'tenant'), LOWER(market_name));

-- ---------------------------------------------------------------------------
-- Combined indexes used by scoped list/detail/report queries.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_transactions_scope_created_at
  ON transactions(tenant_id, company_id, created_at);
CREATE INDEX IF NOT EXISTS idx_transaction_items_transaction
  ON transaction_items(transaction_id);
CREATE INDEX IF NOT EXISTS idx_inventory_lookup
  ON inventory(warehouse_id, zone_id, part_id, condition);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_bucket_scope
  ON inventory(
    COALESCE(tenant_id, 'global'),
    COALESCE(company_id, 'tenant'),
    warehouse_id,
    COALESCE(zone_id, ''),
    part_id,
    condition
  );
CREATE INDEX IF NOT EXISTS idx_inventory_movements_scope_created_at
  ON inventory_movements(tenant_id, company_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ghg_scope_period
  ON ghg_emission_entries(tenant_id, company_id, reporting_period_start, reporting_period_end);
CREATE INDEX IF NOT EXISTS idx_audit_log_scope_created_at
  ON audit_log(tenant_id, company_id, created_at);
CREATE INDEX IF NOT EXISTS idx_contacts_scope_company_name
  ON contacts(tenant_id, company_id, company_name);

PRAGMA foreign_keys = on;
