-- Link project equipment rows back to the master parts catalog.

ALTER TABLE project_equipment ADD COLUMN part_id TEXT REFERENCES parts(id);

CREATE INDEX IF NOT EXISTS idx_project_equipment_part ON project_equipment(part_id);
