-- Finalize catalog uniqueness for tenant/company-scoped Cirtell data.
-- Rebuilds early single-tenant catalog tables without global UNIQUE constraints
-- and enforces normalized scoped uniqueness with expression indexes.

PRAGMA foreign_keys = off;

DROP TABLE IF EXISTS __scoped_catalog_guard;
DROP TABLE IF EXISTS __vendor_scope_map;

CREATE TABLE __scoped_catalog_guard (
  ok INTEGER NOT NULL CHECK (ok = 1),
  reason TEXT
);

-- Unreferenced legacy vendors may only be assigned to the default Cirtell scope
-- when that scope is present. Otherwise this migration stops instead of guessing.
INSERT INTO __scoped_catalog_guard (ok, reason)
SELECT
  CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END,
  'Unreferenced vendors without scope require a trusted default tenant/company'
FROM vendors v
WHERE NOT EXISTS (SELECT 1 FROM parts p WHERE p.vendor_id = v.id)
  AND (v.tenant_id IS NULL OR v.company_id IS NULL)
  AND NOT EXISTS (
    SELECT 1
    FROM companies c
    WHERE c.id = 'company_cirtell_default'
      AND c.tenant_id = 'tenant_cirtell_default'
  );

-- Map every old vendor id to one vendor per tenant/company scope inferred from
-- parts. The first scope keeps the original id; additional scopes receive stable
-- deterministic ids so parts can be repointed without data loss.
CREATE TABLE __vendor_scope_map (
  old_vendor_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  new_vendor_id TEXT NOT NULL,
  PRIMARY KEY (old_vendor_id, tenant_id, company_id)
);

INSERT INTO __vendor_scope_map (old_vendor_id, tenant_id, company_id, new_vendor_id)
WITH referenced_scopes AS (
  SELECT
    v.id AS old_vendor_id,
    COALESCE(p.tenant_id, v.tenant_id, 'tenant_cirtell_default') AS tenant_id,
    COALESCE(p.company_id, v.company_id, 'company_cirtell_default') AS company_id
  FROM vendors v
  JOIN parts p ON p.vendor_id = v.id
  GROUP BY
    v.id,
    COALESCE(p.tenant_id, v.tenant_id, 'tenant_cirtell_default'),
    COALESCE(p.company_id, v.company_id, 'company_cirtell_default')
),
ranked_scopes AS (
  SELECT
    old_vendor_id,
    tenant_id,
    company_id,
    ROW_NUMBER() OVER (
      PARTITION BY old_vendor_id
      ORDER BY tenant_id, company_id
    ) AS scope_rank
  FROM referenced_scopes
)
SELECT
  old_vendor_id,
  tenant_id,
  company_id,
  CASE
    WHEN scope_rank = 1 THEN old_vendor_id
    ELSE 'vendor_scope__' || old_vendor_id || '__' || tenant_id || '__' || company_id
  END AS new_vendor_id
FROM ranked_scopes;

INSERT INTO __vendor_scope_map (old_vendor_id, tenant_id, company_id, new_vendor_id)
SELECT
  v.id,
  COALESCE(v.tenant_id, 'tenant_cirtell_default'),
  COALESCE(v.company_id, 'company_cirtell_default'),
  v.id
FROM vendors v
WHERE NOT EXISTS (SELECT 1 FROM parts p WHERE p.vendor_id = v.id)
  AND NOT EXISTS (
    SELECT 1
    FROM __vendor_scope_map m
    WHERE m.old_vendor_id = v.id
  );

UPDATE parts
SET vendor_id = (
  SELECT m.new_vendor_id
  FROM __vendor_scope_map m
  WHERE m.old_vendor_id = parts.vendor_id
    AND m.tenant_id = parts.tenant_id
    AND m.company_id = parts.company_id
  LIMIT 1
)
WHERE vendor_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM __vendor_scope_map m
    WHERE m.old_vendor_id = parts.vendor_id
      AND m.tenant_id = parts.tenant_id
      AND m.company_id = parts.company_id
  );

-- ---------------------------------------------------------------------------
-- Vendors
-- ---------------------------------------------------------------------------
CREATE TABLE vendors_catalog_scoped (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  company_id TEXT,
  vendor_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO vendors_catalog_scoped (id, tenant_id, company_id, vendor_name, created_at)
SELECT
  m.new_vendor_id,
  m.tenant_id,
  m.company_id,
  v.vendor_name,
  v.created_at
FROM __vendor_scope_map m
JOIN vendors v ON v.id = m.old_vendor_id;

DROP TABLE vendors;
ALTER TABLE vendors_catalog_scoped RENAME TO vendors;

-- ---------------------------------------------------------------------------
-- Parts
-- ---------------------------------------------------------------------------
CREATE TABLE parts_catalog_scoped (
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

INSERT INTO parts_catalog_scoped (
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
ALTER TABLE parts_catalog_scoped RENAME TO parts;

-- ---------------------------------------------------------------------------
-- Markets
-- ---------------------------------------------------------------------------
CREATE TABLE markets_catalog_scoped (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  company_id TEXT,
  market_name TEXT NOT NULL,
  country TEXT,
  region TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO markets_catalog_scoped (
  id, tenant_id, company_id, market_name, country, region, created_at, updated_at
)
SELECT
  id, tenant_id, company_id, market_name, country, region, created_at, updated_at
FROM markets;

DROP TABLE markets;
ALTER TABLE markets_catalog_scoped RENAME TO markets;

-- ---------------------------------------------------------------------------
-- Warehouses
-- ---------------------------------------------------------------------------
CREATE TABLE warehouses_catalog_scoped (
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

INSERT INTO warehouses_catalog_scoped (
  id, tenant_id, company_id, name, code, address, city, country,
  capacity_units, status, notes, created_at, updated_at
)
SELECT
  id, tenant_id, company_id, name, code, address, city, country,
  capacity_units, status, notes, created_at, updated_at
FROM warehouses;

DROP TABLE warehouses;
ALTER TABLE warehouses_catalog_scoped RENAME TO warehouses;

-- Preflight scoped duplicates and vendor scope mismatches before creating
-- unique indexes. A CHECK failure here means existing data needs cleanup.
INSERT INTO __scoped_catalog_guard (ok, reason)
SELECT CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END, 'Duplicate vendor_name in tenant/company scope'
FROM (
  SELECT tenant_id, company_id, LOWER(TRIM(vendor_name)) AS normalized_name
  FROM vendors
  GROUP BY tenant_id, company_id, normalized_name
  HAVING COUNT(*) > 1
);

INSERT INTO __scoped_catalog_guard (ok, reason)
SELECT CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END, 'Duplicate part_number in tenant/company scope'
FROM (
  SELECT tenant_id, company_id, LOWER(TRIM(part_number)) AS normalized_part_number
  FROM parts
  GROUP BY tenant_id, company_id, normalized_part_number
  HAVING COUNT(*) > 1
);

INSERT INTO __scoped_catalog_guard (ok, reason)
SELECT CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END, 'Duplicate market_name in tenant/company scope'
FROM (
  SELECT tenant_id, company_id, LOWER(TRIM(market_name)) AS normalized_name
  FROM markets
  GROUP BY tenant_id, company_id, normalized_name
  HAVING COUNT(*) > 1
);

INSERT INTO __scoped_catalog_guard (ok, reason)
SELECT CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END, 'Duplicate warehouse code in tenant/company scope'
FROM (
  SELECT tenant_id, company_id, UPPER(TRIM(code)) AS normalized_code
  FROM warehouses
  GROUP BY tenant_id, company_id, normalized_code
  HAVING COUNT(*) > 1
);

INSERT INTO __scoped_catalog_guard (ok, reason)
SELECT CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END, 'parts.vendor_id references a vendor outside part scope'
FROM parts p
LEFT JOIN vendors v ON v.id = p.vendor_id
WHERE p.vendor_id IS NOT NULL
  AND (
    v.id IS NULL
    OR COALESCE(v.tenant_id, '') <> COALESCE(p.tenant_id, '')
    OR COALESCE(v.company_id, '') <> COALESCE(p.company_id, '')
  );

-- Final indexes used by backend lookups and D1 uniqueness enforcement.
CREATE INDEX IF NOT EXISTS idx_vendors_tenant_company
  ON vendors(tenant_id, company_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_vendors_scope_name
  ON vendors(tenant_id, company_id, LOWER(TRIM(vendor_name)));

CREATE UNIQUE INDEX IF NOT EXISTS ux_parts_scope_part_number
  ON parts(tenant_id, company_id, LOWER(TRIM(part_number)));
CREATE INDEX IF NOT EXISTS idx_parts_part_number ON parts(part_number);
CREATE INDEX IF NOT EXISTS idx_parts_category ON parts(category);
CREATE INDEX IF NOT EXISTS idx_parts_vendor ON parts(vendor_id);
CREATE INDEX IF NOT EXISTS idx_parts_tenant_company ON parts(tenant_id, company_id);

CREATE INDEX IF NOT EXISTS idx_markets_tenant_company
  ON markets(tenant_id, company_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_markets_scope_name
  ON markets(tenant_id, company_id, LOWER(TRIM(market_name)));

CREATE INDEX IF NOT EXISTS idx_warehouses_tenant_company
  ON warehouses(tenant_id, company_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_warehouses_scope_code
  ON warehouses(tenant_id, company_id, UPPER(TRIM(code)));
CREATE INDEX IF NOT EXISTS idx_warehouses_scope_name
  ON warehouses(tenant_id, company_id, LOWER(TRIM(name)));

DROP TABLE __scoped_catalog_guard;
DROP TABLE __vendor_scope_map;

PRAGMA foreign_keys = on;
