-- Transaction enhancements for Cirtell.
-- Adds reference markets, buyer contacts, warehouse/project links, PO metadata,
-- and transaction line items while keeping Cirtell single-tenant.

-- ============================================================================
-- Markets
-- ============================================================================
CREATE TABLE IF NOT EXISTS markets (
  id TEXT PRIMARY KEY,
  market_name TEXT NOT NULL UNIQUE,
  country TEXT,
  region TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO markets (id, market_name, country, region)
VALUES
  ('global', 'Global', 'Global', 'Global'),
  ('vietnam', 'Vietnam', 'Vietnam', 'APAC');

-- ============================================================================
-- Buyer / Customer Contacts
-- ============================================================================
CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  company_name TEXT NOT NULL,
  contact_person_name TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  city TEXT,
  country TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_contacts_company ON contacts(company_name);

-- ============================================================================
-- Transaction enrichment columns
-- ============================================================================
ALTER TABLE transactions ADD COLUMN market_id TEXT REFERENCES markets(id);
ALTER TABLE transactions ADD COLUMN source_warehouse_id TEXT REFERENCES warehouses(id);
ALTER TABLE transactions ADD COLUMN destination_warehouse_id TEXT REFERENCES warehouses(id);
ALTER TABLE transactions ADD COLUMN project_id TEXT;
ALTER TABLE transactions ADD COLUMN po_file_key TEXT;
ALTER TABLE transactions ADD COLUMN po_file_name TEXT;
ALTER TABLE transactions ADD COLUMN contact_id TEXT REFERENCES contacts(id);

CREATE INDEX IF NOT EXISTS idx_transactions_market ON transactions(market_id);
CREATE INDEX IF NOT EXISTS idx_transactions_source_warehouse ON transactions(source_warehouse_id);
CREATE INDEX IF NOT EXISTS idx_transactions_destination_warehouse ON transactions(destination_warehouse_id);
CREATE INDEX IF NOT EXISTS idx_transactions_contact ON transactions(contact_id);

-- ============================================================================
-- Transaction line items
-- ============================================================================
CREATE TABLE IF NOT EXISTS transaction_items (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  part_id TEXT REFERENCES parts(id),
  serial_number TEXT,
  condition TEXT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_usd REAL NOT NULL DEFAULT 0,
  source_warehouse_id TEXT REFERENCES warehouses(id),
  destination_warehouse_id TEXT REFERENCES warehouses(id),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_transaction_items_transaction ON transaction_items(transaction_id);
CREATE INDEX IF NOT EXISTS idx_transaction_items_part ON transaction_items(part_id);

-- ============================================================================
-- PO file storage
-- ============================================================================
CREATE TABLE IF NOT EXISTS transaction_po_files (
  transaction_id TEXT PRIMARY KEY REFERENCES transactions(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  file_data BLOB NOT NULL,
  uploaded_by TEXT REFERENCES users(id),
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
