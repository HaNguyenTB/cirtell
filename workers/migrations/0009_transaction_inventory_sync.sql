-- Transaction to inventory sync metadata.
-- Adds traceability, idempotency, reversal links, and void/sync state.

-- ============================================================================
-- Inventory movement traceability
-- ============================================================================
ALTER TABLE inventory_movements ADD COLUMN transaction_id TEXT REFERENCES transactions(id);
ALTER TABLE inventory_movements ADD COLUMN transaction_item_id TEXT REFERENCES transaction_items(id);
ALTER TABLE inventory_movements ADD COLUMN condition TEXT CHECK (condition IN ('New', 'Good', 'Fair', 'Poor', 'Scrap') OR condition IS NULL);
ALTER TABLE inventory_movements ADD COLUMN sync_source TEXT NOT NULL DEFAULT 'manual'
  CHECK (sync_source IN ('manual', 'transaction', 'backfill', 'reversal'));
ALTER TABLE inventory_movements ADD COLUMN sync_version INTEGER NOT NULL DEFAULT 0
  CHECK (sync_version >= 0);
ALTER TABLE inventory_movements ADD COLUMN reversal_of_movement_id TEXT REFERENCES inventory_movements(id);
ALTER TABLE inventory_movements ADD COLUMN idempotency_key TEXT;
ALTER TABLE inventory_movements ADD COLUMN effective_at TEXT;

CREATE INDEX IF NOT EXISTS idx_inv_movements_transaction
  ON inventory_movements(transaction_id);
CREATE INDEX IF NOT EXISTS idx_inv_movements_transaction_item
  ON inventory_movements(transaction_item_id);
CREATE INDEX IF NOT EXISTS idx_inv_movements_reversal
  ON inventory_movements(reversal_of_movement_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_movements_idempotency
  ON inventory_movements(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ============================================================================
-- Transaction inventory sync state and void metadata
-- ============================================================================
ALTER TABLE transactions ADD COLUMN inventory_sync_status TEXT NOT NULL DEFAULT 'not_ready'
  CHECK (inventory_sync_status IN ('not_ready', 'synced', 'failed', 'voided', 'backfill_pending'));
ALTER TABLE transactions ADD COLUMN inventory_sync_version INTEGER NOT NULL DEFAULT 0
  CHECK (inventory_sync_version >= 0);
ALTER TABLE transactions ADD COLUMN inventory_synced_at TEXT;
ALTER TABLE transactions ADD COLUMN inventory_sync_error TEXT;
ALTER TABLE transactions ADD COLUMN voided_at TEXT;
ALTER TABLE transactions ADD COLUMN voided_by TEXT REFERENCES users(id);
ALTER TABLE transactions ADD COLUMN void_reason TEXT;
