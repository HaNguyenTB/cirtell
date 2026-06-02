-- Cirveris-style security hardening for Cirtell.
-- Binds Google SSO identity to users and enables server-issued app sessions.

ALTER TABLE users ADD COLUMN google_sub TEXT;
ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_session_version ON users(session_version);
