-- User invitations for admin-created app access.

CREATE TABLE IF NOT EXISTS user_invitations (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'User' CHECK (role IN ('Admin', 'User', 'Viewer')),
  tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
  invited_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  invited_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'cancelled', 'expired')),
  expires_at TEXT,
  accepted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_user_invitations_email ON user_invitations(LOWER(email));
CREATE INDEX IF NOT EXISTS idx_user_invitations_scope ON user_invitations(tenant_id, company_id);
CREATE INDEX IF NOT EXISTS idx_user_invitations_status ON user_invitations(status);
