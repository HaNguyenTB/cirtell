-- Cirveris-style Project & Value-Chain Execution Module for Cirtell.
-- Adds tenant-scoped telecom decommissioning/circularity project records.

-- ============================================================================
-- Project lookups
-- ============================================================================
CREATE TABLE IF NOT EXISTS telecom_vendors (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  company_id TEXT,
  name TEXT NOT NULL,
  category TEXT,
  region TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_telecom_vendors_scope ON telecom_vendors(tenant_id, company_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_telecom_vendors_name_scope ON telecom_vendors(COALESCE(tenant_id, 'global'), LOWER(name));

CREATE TABLE IF NOT EXISTS telecom_technologies (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  company_id TEXT,
  name TEXT NOT NULL,
  generation TEXT,
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_telecom_technologies_scope ON telecom_technologies(tenant_id, company_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_telecom_technologies_name_scope ON telecom_technologies(COALESCE(tenant_id, 'global'), LOWER(name));

INSERT OR IGNORE INTO telecom_vendors (id, name, category, region)
VALUES
  ('vendor_ericsson', 'Ericsson', 'RAN & Core', 'Global'),
  ('vendor_nokia', 'Nokia', 'RAN & Core', 'Global'),
  ('vendor_huawei', 'Huawei', 'RAN & Core', 'Global'),
  ('vendor_zte', 'ZTE', 'RAN & Transport', 'Global'),
  ('vendor_cisco', 'Cisco', 'IP & Transport', 'Global'),
  ('vendor_samsung', 'Samsung Networks', 'RAN', 'Global');

INSERT OR IGNORE INTO telecom_technologies (id, name, generation, description)
VALUES
  ('tech_2g', '2G', 'Legacy', 'Second-generation mobile network equipment'),
  ('tech_3g', '3G', 'Legacy', 'Third-generation mobile network equipment'),
  ('tech_4g_lte', '4G LTE', 'Current', 'LTE radio, core, and transport equipment'),
  ('tech_5g_nr', '5G NR', 'Current', '5G new radio, core, and edge equipment'),
  ('tech_fiber', 'Fiber Transport', 'Transport', 'Optical transport and fiber infrastructure'),
  ('tech_power', 'Power & Cooling', 'Infrastructure', 'Batteries, rectifiers, racks, and cooling assets');

-- ============================================================================
-- Projects
-- ============================================================================
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  company_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  internal_reference TEXT,
  operator TEXT,
  region TEXT,
  country TEXT,
  site_name TEXT,
  site_id TEXT,
  location_type TEXT NOT NULL DEFAULT 'on_site'
    CHECK (location_type IN ('on_site', 'local_warehouse', 'regional_warehouse')),
  source_warehouse_id TEXT REFERENCES warehouses(id) ON DELETE SET NULL,
  location_address TEXT,
  requires_dismantling INTEGER NOT NULL DEFAULT 1,
  timeframe_start TEXT,
  timeframe_end TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  esg_methodology_version TEXT,
  compliance_regime TEXT,
  contains_sensitive_data INTEGER NOT NULL DEFAULT 0,
  contains_restricted_goods INTEGER NOT NULL DEFAULT 0,
  compliance_notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'assessment', 'in-progress', 'on-hold', 'completed', 'cancelled')),
  budget_total REAL NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_projects_scope ON projects(tenant_id, company_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_created_by ON projects(created_by);
CREATE INDEX IF NOT EXISTS idx_projects_source_warehouse ON projects(source_warehouse_id);

CREATE TABLE IF NOT EXISTS project_vendors (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  vendor_id TEXT NOT NULL REFERENCES telecom_vendors(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, vendor_id)
);

CREATE TABLE IF NOT EXISTS project_technologies (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  technology_id TEXT NOT NULL REFERENCES telecom_technologies(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, technology_id)
);

-- ============================================================================
-- Materials & assets
-- ============================================================================
CREATE TABLE IF NOT EXISTS project_equipment (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  tenant_id TEXT,
  company_id TEXT,
  item_name TEXT NOT NULL,
  asset_tag TEXT,
  serial_number TEXT,
  vendor TEXT,
  category TEXT,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  condition TEXT NOT NULL DEFAULT 'Used',
  current_stage TEXT NOT NULL DEFAULT 'assessment',
  weight_kg REAL,
  estimated_reuse_value REAL,
  co2_avoided_kg REAL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_project_equipment_project ON project_equipment(project_id);
CREATE INDEX IF NOT EXISTS idx_project_equipment_scope ON project_equipment(tenant_id, company_id);
CREATE INDEX IF NOT EXISTS idx_project_equipment_stage ON project_equipment(current_stage);

-- ============================================================================
-- Workflow
-- ============================================================================
CREATE TABLE IF NOT EXISTS project_workflow_stages (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started', 'in_progress', 'completed', 'blocked')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(project_id, stage)
);

CREATE INDEX IF NOT EXISTS idx_project_workflow_project ON project_workflow_stages(project_id);

CREATE TABLE IF NOT EXISTS project_workflow_tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage_id TEXT NOT NULL REFERENCES project_workflow_stages(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  due_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_project_workflow_tasks_project ON project_workflow_tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_project_workflow_tasks_stage ON project_workflow_tasks(stage_id);

-- ============================================================================
-- Execution tabs
-- ============================================================================
CREATE TABLE IF NOT EXISTS project_financials (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  tenant_id TEXT,
  company_id TEXT,
  type TEXT NOT NULL DEFAULT 'cost' CHECK (type IN ('cost', 'revenue', 'credit')),
  category TEXT NOT NULL,
  description TEXT,
  amount REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  stage TEXT,
  incurred_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_project_financials_project ON project_financials(project_id);
CREATE INDEX IF NOT EXISTS idx_project_financials_scope ON project_financials(tenant_id, company_id);

CREATE TABLE IF NOT EXISTS project_logistics (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  tenant_id TEXT,
  company_id TEXT,
  shipment_type TEXT NOT NULL DEFAULT 'collection',
  status TEXT NOT NULL DEFAULT 'planned',
  carrier TEXT,
  origin TEXT,
  destination TEXT,
  scheduled_date TEXT,
  tracking_reference TEXT,
  estimated_cost REAL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_project_logistics_project ON project_logistics(project_id);
CREATE INDEX IF NOT EXISTS idx_project_logistics_scope ON project_logistics(tenant_id, company_id);

CREATE TABLE IF NOT EXISTS project_evidence (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  tenant_id TEXT,
  company_id TEXT,
  title TEXT NOT NULL,
  evidence_type TEXT NOT NULL DEFAULT 'document',
  stage TEXT,
  file_url TEXT,
  notes TEXT,
  uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_project_evidence_project ON project_evidence(project_id);
CREATE INDEX IF NOT EXISTS idx_project_evidence_scope ON project_evidence(tenant_id, company_id);

CREATE TABLE IF NOT EXISTS project_comments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_project_comments_project ON project_comments(project_id, created_at);

CREATE TABLE IF NOT EXISTS project_activity (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  user_name TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_project_activity_project ON project_activity(project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_transactions_project ON transactions(project_id);
