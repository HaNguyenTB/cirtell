-- Store project evidence files in R2. D1 keeps only searchable metadata.

ALTER TABLE project_evidence ADD COLUMN r2_key TEXT;
ALTER TABLE project_evidence ADD COLUMN file_name TEXT;
ALTER TABLE project_evidence ADD COLUMN file_size INTEGER;
ALTER TABLE project_evidence ADD COLUMN content_type TEXT;

CREATE INDEX IF NOT EXISTS idx_project_evidence_r2_key ON project_evidence(r2_key);
