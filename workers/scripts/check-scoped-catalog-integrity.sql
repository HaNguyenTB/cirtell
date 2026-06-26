-- Scoped catalog integrity checks.
-- Run locally with:
--   npx wrangler d1 execute cirtell-db --local --file scripts/check-scoped-catalog-integrity.sql

SELECT 'parts_total' AS check_name, COUNT(*) AS value FROM parts;
SELECT 'vendors_total' AS check_name, COUNT(*) AS value FROM vendors;
SELECT 'markets_total' AS check_name, COUNT(*) AS value FROM markets;
SELECT 'warehouses_total' AS check_name, COUNT(*) AS value FROM warehouses;

SELECT 'parts_vendor_scope_mismatch' AS check_name, COUNT(*) AS violation_count
FROM parts p
LEFT JOIN vendors v ON v.id = p.vendor_id
WHERE p.vendor_id IS NOT NULL
  AND (
    v.id IS NULL
    OR COALESCE(v.tenant_id, '') <> COALESCE(p.tenant_id, '')
    OR COALESCE(v.company_id, '') <> COALESCE(p.company_id, '')
  );

SELECT 'duplicate_part_number_in_scope' AS check_name, COUNT(*) AS violation_groups
FROM (
  SELECT tenant_id, company_id, LOWER(TRIM(part_number)) AS normalized_value
  FROM parts
  GROUP BY tenant_id, company_id, normalized_value
  HAVING COUNT(*) > 1
);

SELECT 'duplicate_vendor_name_in_scope' AS check_name, COUNT(*) AS violation_groups
FROM (
  SELECT tenant_id, company_id, LOWER(TRIM(vendor_name)) AS normalized_value
  FROM vendors
  GROUP BY tenant_id, company_id, normalized_value
  HAVING COUNT(*) > 1
);

SELECT 'duplicate_market_name_in_scope' AS check_name, COUNT(*) AS violation_groups
FROM (
  SELECT tenant_id, company_id, LOWER(TRIM(market_name)) AS normalized_value
  FROM markets
  GROUP BY tenant_id, company_id, normalized_value
  HAVING COUNT(*) > 1
);

SELECT 'duplicate_warehouse_code_in_scope' AS check_name, COUNT(*) AS violation_groups
FROM (
  SELECT tenant_id, company_id, UPPER(TRIM(code)) AS normalized_value
  FROM warehouses
  GROUP BY tenant_id, company_id, normalized_value
  HAVING COUNT(*) > 1
);

PRAGMA foreign_key_check;
