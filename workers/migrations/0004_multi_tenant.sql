-- Cirveris-style multi-tenant foundation for Cirtell.
-- Adds platform/group/company hierarchy and tenant/company ownership columns.

-- ============================================================================
-- Tenant hierarchy
-- ============================================================================
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  is_platform_tenant INTEGER NOT NULL DEFAULT 0,
  parent_tenant_id TEXT REFERENCES tenants(id) ON DELETE SET NULL,
  group_type TEXT CHECK (group_type IN ('telco', 'si', 'vendor') OR group_type IS NULL),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tenants_parent ON tenants(parent_tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenants_active ON tenants(is_active);

CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  logo_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_companies_tenant ON companies(tenant_id);

CREATE TABLE IF NOT EXISTS user_company_assignments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'User',
  assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, company_id)
);

CREATE INDEX IF NOT EXISTS idx_user_company_user ON user_company_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_user_company_tenant ON user_company_assignments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_user_company_company ON user_company_assignments(company_id);

CREATE TABLE IF NOT EXISTS tenant_app_access (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  app_id TEXT NOT NULL,
  granted_by TEXT REFERENCES users(id),
  granted_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(tenant_id, app_id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_app_access_tenant ON tenant_app_access(tenant_id);

-- Seed the Cirveris-style group tree.
INSERT OR IGNORE INTO tenants (id, name, domain, is_active, is_platform_tenant, parent_tenant_id, group_type)
VALUES
  ('tenant_cirtell_platform', 'Cirtell Platform', 'cirtell.pages.dev', 1, 1, NULL, NULL),
  ('tenant_cirtell_telco', 'Telecommunication Groups', 'telco.cirtell.pages.dev', 1, 0, 'tenant_cirtell_platform', 'telco'),
  ('tenant_cirtell_si', 'System Integrators', 'si.cirtell.pages.dev', 1, 0, 'tenant_cirtell_platform', 'si'),
  ('tenant_cirtell_vendor', 'Vendors', 'vendors.cirtell.pages.dev', 1, 0, 'tenant_cirtell_platform', 'vendor'),
  ('tenant_cirtell_default', 'Cirtell Default Group', 'default.cirtell.pages.dev', 1, 0, 'tenant_cirtell_si', NULL);

INSERT OR IGNORE INTO companies (id, tenant_id, code, name, logo_url)
VALUES ('company_cirtell_default', 'tenant_cirtell_default', 'CIRTELL', 'Cirtell', NULL);

-- ============================================================================
-- User tenant ownership
-- ============================================================================
ALTER TABLE users ADD COLUMN tenant_id TEXT;
ALTER TABLE users ADD COLUMN company_id TEXT;
ALTER TABLE users ADD COLUMN is_super_admin INTEGER NOT NULL DEFAULT 0;

UPDATE users
SET tenant_id = COALESCE(tenant_id, 'tenant_cirtell_default'),
    company_id = COALESCE(company_id, 'company_cirtell_default'),
    is_super_admin = CASE WHEN role = 'Admin' THEN 1 ELSE is_super_admin END;

INSERT OR IGNORE INTO user_company_assignments (id, user_id, tenant_id, company_id, role)
SELECT lower(hex(randomblob(16))), id, tenant_id, company_id, role
FROM users
WHERE tenant_id IS NOT NULL AND company_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_company ON users(company_id);
CREATE INDEX IF NOT EXISTS idx_users_super_admin ON users(is_super_admin);

-- ============================================================================
-- Business data ownership
-- ============================================================================
ALTER TABLE parts ADD COLUMN tenant_id TEXT;
ALTER TABLE parts ADD COLUMN company_id TEXT;
ALTER TABLE transactions ADD COLUMN tenant_id TEXT;
ALTER TABLE transactions ADD COLUMN company_id TEXT;
ALTER TABLE transaction_items ADD COLUMN tenant_id TEXT;
ALTER TABLE transaction_items ADD COLUMN company_id TEXT;
ALTER TABLE ghg_emission_entries ADD COLUMN tenant_id TEXT;
ALTER TABLE ghg_emission_entries ADD COLUMN company_id TEXT;
ALTER TABLE warehouses ADD COLUMN tenant_id TEXT;
ALTER TABLE warehouses ADD COLUMN company_id TEXT;
ALTER TABLE warehouse_zones ADD COLUMN tenant_id TEXT;
ALTER TABLE warehouse_zones ADD COLUMN company_id TEXT;
ALTER TABLE inventory ADD COLUMN tenant_id TEXT;
ALTER TABLE inventory ADD COLUMN company_id TEXT;
ALTER TABLE inventory_movements ADD COLUMN tenant_id TEXT;
ALTER TABLE inventory_movements ADD COLUMN company_id TEXT;
ALTER TABLE markets ADD COLUMN tenant_id TEXT;
ALTER TABLE markets ADD COLUMN company_id TEXT;
ALTER TABLE contacts ADD COLUMN tenant_id TEXT;
ALTER TABLE contacts ADD COLUMN company_id TEXT;
ALTER TABLE audit_log ADD COLUMN tenant_id TEXT;
ALTER TABLE audit_log ADD COLUMN company_id TEXT;

UPDATE parts SET tenant_id = COALESCE(tenant_id, 'tenant_cirtell_default'), company_id = COALESCE(company_id, 'company_cirtell_default');
UPDATE transactions SET tenant_id = COALESCE(tenant_id, 'tenant_cirtell_default'), company_id = COALESCE(company_id, 'company_cirtell_default');
UPDATE transaction_items SET tenant_id = COALESCE(tenant_id, 'tenant_cirtell_default'), company_id = COALESCE(company_id, 'company_cirtell_default');
UPDATE ghg_emission_entries SET tenant_id = COALESCE(tenant_id, 'tenant_cirtell_default'), company_id = COALESCE(company_id, 'company_cirtell_default');
UPDATE warehouses SET tenant_id = COALESCE(tenant_id, 'tenant_cirtell_default'), company_id = COALESCE(company_id, 'company_cirtell_default');
UPDATE warehouse_zones SET tenant_id = COALESCE(tenant_id, 'tenant_cirtell_default'), company_id = COALESCE(company_id, 'company_cirtell_default');
UPDATE inventory SET tenant_id = COALESCE(tenant_id, 'tenant_cirtell_default'), company_id = COALESCE(company_id, 'company_cirtell_default');
UPDATE inventory_movements SET tenant_id = COALESCE(tenant_id, 'tenant_cirtell_default'), company_id = COALESCE(company_id, 'company_cirtell_default');
UPDATE markets SET tenant_id = COALESCE(tenant_id, 'tenant_cirtell_default'), company_id = COALESCE(company_id, 'company_cirtell_default');
UPDATE contacts SET tenant_id = COALESCE(tenant_id, 'tenant_cirtell_default'), company_id = COALESCE(company_id, 'company_cirtell_default');

CREATE INDEX IF NOT EXISTS idx_parts_tenant_company ON parts(tenant_id, company_id);
CREATE INDEX IF NOT EXISTS idx_transactions_tenant_company ON transactions(tenant_id, company_id);
CREATE INDEX IF NOT EXISTS idx_transaction_items_tenant_company ON transaction_items(tenant_id, company_id);
CREATE INDEX IF NOT EXISTS idx_ghg_tenant_company ON ghg_emission_entries(tenant_id, company_id);
CREATE INDEX IF NOT EXISTS idx_warehouses_tenant_company ON warehouses(tenant_id, company_id);
CREATE INDEX IF NOT EXISTS idx_inventory_tenant_company ON inventory(tenant_id, company_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_tenant_company ON inventory_movements(tenant_id, company_id);
CREATE INDEX IF NOT EXISTS idx_markets_tenant_company ON markets(tenant_id, company_id);
CREATE INDEX IF NOT EXISTS idx_contacts_tenant_company ON contacts(tenant_id, company_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_company ON audit_log(tenant_id, company_id);
