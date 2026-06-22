-- Preserve transaction line item history when synced transactions are rebuilt.

ALTER TABLE transaction_items ADD COLUMN superseded_at TEXT;

CREATE INDEX IF NOT EXISTS idx_transaction_items_active
  ON transaction_items(transaction_id, superseded_at);
