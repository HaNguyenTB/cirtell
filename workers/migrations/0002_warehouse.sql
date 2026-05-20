-- Warehouse Management
-- Locations (warehouses/sites), zones within them, and inventory tracking

-- ============================================================================
-- Warehouse Locations
-- ============================================================================
CREATE TABLE IF NOT EXISTS warehouses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,
  address TEXT,
  city TEXT,
  country TEXT,
  capacity_units INTEGER,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================================
-- Warehouse Zones (e.g. Rack A, Shelf B, Staging Area)
-- ============================================================================
CREATE TABLE IF NOT EXISTS warehouse_zones (
  id TEXT PRIMARY KEY,
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  zone_type TEXT DEFAULT 'storage' CHECK (zone_type IN ('storage', 'staging', 'inspection', 'shipping', 'receiving')),
  capacity_units INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_zones_warehouse ON warehouse_zones(warehouse_id);

-- ============================================================================
-- Inventory — tracks part quantities per warehouse/zone
-- ============================================================================
CREATE TABLE IF NOT EXISTS inventory (
  id TEXT PRIMARY KEY,
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  zone_id TEXT REFERENCES warehouse_zones(id),
  part_id TEXT NOT NULL REFERENCES parts(id),
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  condition TEXT DEFAULT 'Good' CHECK (condition IN ('New', 'Good', 'Fair', 'Poor', 'Scrap')),
  last_counted_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(warehouse_id, zone_id, part_id, condition)
);

CREATE INDEX IF NOT EXISTS idx_inventory_warehouse ON inventory(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_inventory_part ON inventory(part_id);

-- ============================================================================
-- Inventory Movements — transfer log between warehouses/zones
-- ============================================================================
CREATE TABLE IF NOT EXISTS inventory_movements (
  id TEXT PRIMARY KEY,
  from_warehouse_id TEXT REFERENCES warehouses(id),
  from_zone_id TEXT REFERENCES warehouse_zones(id),
  to_warehouse_id TEXT REFERENCES warehouses(id),
  to_zone_id TEXT REFERENCES warehouse_zones(id),
  part_id TEXT NOT NULL REFERENCES parts(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  movement_type TEXT NOT NULL CHECK (movement_type IN ('Transfer', 'Receive', 'Ship', 'Adjust')),
  reference TEXT,
  notes TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_inv_movements_part ON inventory_movements(part_id);
CREATE INDEX IF NOT EXISTS idx_inv_movements_date ON inventory_movements(created_at);
