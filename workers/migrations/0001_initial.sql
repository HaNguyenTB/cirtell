-- Cirtell Initial Schema
-- Single-tenant: no tenant_id / company_id columns needed

-- ============================================================================
-- Users
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'User' CHECK (role IN ('Admin', 'User', 'Viewer')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
  last_login TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================================
-- Vendors
-- ============================================================================
CREATE TABLE IF NOT EXISTS vendors (
  id TEXT PRIMARY KEY,
  vendor_name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================================
-- Parts Catalog
-- ============================================================================
CREATE TABLE IF NOT EXISTS parts (
  id TEXT PRIMARY KEY,
  part_number TEXT NOT NULL UNIQUE,
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

CREATE INDEX IF NOT EXISTS idx_parts_part_number ON parts(part_number);
CREATE INDEX IF NOT EXISTS idx_parts_category ON parts(category);
CREATE INDEX IF NOT EXISTS idx_parts_vendor ON parts(vendor_id);

-- ============================================================================
-- Transactions
-- ============================================================================
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('Purchase', 'Sale', 'Redeploy', 'Recycle')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_usd REAL NOT NULL DEFAULT 0,
  vendor TEXT,
  part_id TEXT REFERENCES parts(id),
  serial_number TEXT,
  condition TEXT,
  po_number TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_movement_type ON transactions(movement_type);
CREATE INDEX IF NOT EXISTS idx_transactions_part_id ON transactions(part_id);

-- ============================================================================
-- GHG Emission Entries (Carbon Accounting)
-- ============================================================================
CREATE TABLE IF NOT EXISTS ghg_emission_entries (
  id TEXT PRIMARY KEY,
  created_by TEXT REFERENCES users(id),
  scope INTEGER NOT NULL CHECK (scope BETWEEN 1 AND 3),
  category_id INTEGER,
  scope3_stream TEXT CHECK (scope3_stream IN ('upstream', 'downstream', NULL)),
  source_description TEXT NOT NULL,
  activity_data REAL NOT NULL CHECK (activity_data > 0),
  activity_unit TEXT NOT NULL,
  emission_factor REAL NOT NULL CHECK (emission_factor >= 0),
  emission_factor_unit TEXT NOT NULL DEFAULT 'kgCO2e',
  emission_factor_source TEXT,
  co2e_kg REAL NOT NULL,
  reporting_period_start TEXT NOT NULL,
  reporting_period_end TEXT NOT NULL,
  data_quality TEXT DEFAULT 'estimated',
  methodology_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ghg_scope ON ghg_emission_entries(scope);
CREATE INDEX IF NOT EXISTS idx_ghg_period ON ghg_emission_entries(reporting_period_start, reporting_period_end);

-- ============================================================================
-- Audit Log
-- ============================================================================
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);

-- ============================================================================
-- Rate Limits (for D1-backed rate limiting)
-- ============================================================================
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  request_count INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL
);

-- ============================================================================
-- Seed: Create initial admin user (update email before deploying!)
-- ============================================================================
-- INSERT INTO users (id, email, name, role) VALUES ('admin-001', 'you@example.com', 'Admin', 'Admin');
