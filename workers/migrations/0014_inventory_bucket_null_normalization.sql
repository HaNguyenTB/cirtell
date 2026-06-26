-- Inventory buckets are unique per tenant/company/warehouse/zone/part/condition.
-- SQLite treats NULL values as distinct in normal UNIQUE constraints, so warehouse-level
-- buckets use a normalized zone sentinel in the unique expression index.

DROP INDEX IF EXISTS idx_inventory_bucket_scope;
DROP INDEX IF EXISTS ux_inventory_bucket_scope;

DROP TABLE IF EXISTS __inventory_bucket_canonical;

CREATE TABLE __inventory_bucket_canonical AS
SELECT
  MIN(id) AS canonical_id,
  tenant_id,
  company_id,
  warehouse_id,
  COALESCE(zone_id, '__WAREHOUSE_LEVEL__') AS normalized_zone_id,
  part_id,
  condition,
  SUM(quantity) AS total_quantity,
  MAX(last_counted_at) AS latest_counted_at,
  COALESCE(MAX(updated_at), datetime('now')) AS latest_updated_at
FROM inventory
GROUP BY
  tenant_id,
  company_id,
  warehouse_id,
  COALESCE(zone_id, '__WAREHOUSE_LEVEL__'),
  part_id,
  condition;

UPDATE inventory
SET
  quantity = (
    SELECT total_quantity
    FROM __inventory_bucket_canonical c
    WHERE c.canonical_id = inventory.id
  ),
  last_counted_at = (
    SELECT latest_counted_at
    FROM __inventory_bucket_canonical c
    WHERE c.canonical_id = inventory.id
  ),
  updated_at = (
    SELECT latest_updated_at
    FROM __inventory_bucket_canonical c
    WHERE c.canonical_id = inventory.id
  )
WHERE id IN (SELECT canonical_id FROM __inventory_bucket_canonical);

DELETE FROM inventory
WHERE id NOT IN (SELECT canonical_id FROM __inventory_bucket_canonical);

DROP TABLE IF EXISTS __inventory_bucket_duplicates;

CREATE TABLE __inventory_bucket_duplicates AS
SELECT
  tenant_id,
  company_id,
  warehouse_id,
  COALESCE(zone_id, '__WAREHOUSE_LEVEL__') AS normalized_zone_id,
  part_id,
  condition,
  COUNT(*) AS bucket_count
FROM inventory
GROUP BY
  tenant_id,
  company_id,
  warehouse_id,
  COALESCE(zone_id, '__WAREHOUSE_LEVEL__'),
  part_id,
  condition
HAVING COUNT(*) > 1;

CREATE TABLE __inventory_bucket_guard (
  ok INTEGER NOT NULL CHECK (ok = 1)
);

INSERT INTO __inventory_bucket_guard (ok)
SELECT CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END
FROM __inventory_bucket_duplicates;

DROP TABLE __inventory_bucket_guard;
DROP TABLE __inventory_bucket_duplicates;
DROP TABLE __inventory_bucket_canonical;

CREATE UNIQUE INDEX IF NOT EXISTS ux_inventory_bucket_scope
ON inventory (
  tenant_id,
  company_id,
  warehouse_id,
  COALESCE(zone_id, '__WAREHOUSE_LEVEL__'),
  part_id,
  condition
);

CREATE INDEX IF NOT EXISTS idx_inventory_bucket_lookup
ON inventory (
  tenant_id,
  company_id,
  warehouse_id,
  zone_id,
  part_id,
  condition
);
