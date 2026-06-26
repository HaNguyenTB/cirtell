import { env } from 'cloudflare:workers';
import { applyD1Migrations, reset, SELF, type D1Migration } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src';
import { applyInventoryMovements } from '../src/services/inventorySync';
import { createAppSessionToken } from '../src/services/auth/sessionCookie';

type TestEnv = Env & { TEST_MIGRATIONS: D1Migration[] };
type JsonMap = Record<string, any>;

const testEnv = env as unknown as TestEnv;

let adminToken = '';
let superAdminToken = '';

async function run(sql: string, ...params: unknown[]) {
  return testEnv.DB.prepare(sql).bind(...params).run();
}

async function first<T = JsonMap>(sql: string, ...params: unknown[]): Promise<T | null> {
  return testEnv.DB.prepare(sql).bind(...params).first<T>();
}

async function all<T = JsonMap>(sql: string, ...params: unknown[]): Promise<T[]> {
  const { results } = await testEnv.DB.prepare(sql).bind(...params).all<T>();
  return results || [];
}

async function api(method: string, path: string, body?: unknown, token = adminToken) {
  const response = await SELF.fetch(`http://localhost${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'CF-Connecting-IP': '127.0.0.42',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json<JsonMap>().catch(() => ({}));
  return { response, json };
}

async function seedBase() {
  await run(`
    INSERT INTO tenants (id, name, domain, is_active)
    VALUES ('tenant_other', 'Other Tenant', 'other.cirtell.test', 1)
  `);
  await run(`
    INSERT INTO companies (id, tenant_id, code, name)
    VALUES ('company_other', 'tenant_other', 'OTHER', 'Other Company')
  `);
  await run(`
    INSERT INTO users (
      id, email, name, role, status, tenant_id, company_id, is_super_admin, session_version
    ) VALUES (
      'user_admin', 'admin@example.com', 'Admin User', 'Admin', 'active',
      'tenant_cirtell_default', 'company_cirtell_default', 0, 0
    ), (
      'user_super_admin', 'superadmin@example.com', 'Super Admin', 'Admin', 'active',
      'tenant_cirtell_default', 'company_cirtell_default', 1, 0
    )
  `);
  await run(`
    INSERT INTO user_company_assignments (id, user_id, tenant_id, company_id, role)
    VALUES ('assign_admin', 'user_admin', 'tenant_cirtell_default', 'company_cirtell_default', 'Admin')
  `);
  await run(`
    INSERT INTO parts (
      id, tenant_id, company_id, part_number, model_name, category, created_at, updated_at
    ) VALUES
      ('part_router', 'tenant_cirtell_default', 'company_cirtell_default', 'RTR-100', 'Router 100', 'Network Equipment', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      ('part_radio', 'tenant_cirtell_default', 'company_cirtell_default', 'RAD-200', 'Radio 200', 'Network Equipment', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      ('part_other', 'tenant_other', 'company_other', 'OTH-900', 'Other Tenant Part', 'Network Equipment', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
  `);
  await run(`
    INSERT INTO warehouses (
      id, tenant_id, company_id, name, code, city, country, status, created_at, updated_at
    ) VALUES
      ('wh_source', 'tenant_cirtell_default', 'company_cirtell_default', 'Source Warehouse', 'SRC', 'Hanoi', 'Vietnam', 'active', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      ('wh_dest', 'tenant_cirtell_default', 'company_cirtell_default', 'Destination Warehouse', 'DST', 'Hanoi', 'Vietnam', 'active', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      ('wh_other', 'tenant_other', 'company_other', 'Other Tenant Warehouse', 'OTH', 'Hanoi', 'Vietnam', 'active', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
  `);
  await run(`
    INSERT INTO warehouse_zones (
      id, tenant_id, company_id, warehouse_id, name, zone_type, created_at
    ) VALUES
      ('zone_a', 'tenant_cirtell_default', 'company_cirtell_default', 'wh_source', 'Zone A', 'storage', '2026-01-01T00:00:00.000Z'),
      ('zone_b', 'tenant_cirtell_default', 'company_cirtell_default', 'wh_source', 'Zone B', 'storage', '2026-01-01T00:00:00.000Z'),
      ('zone_dest', 'tenant_cirtell_default', 'company_cirtell_default', 'wh_dest', 'Destination Zone', 'storage', '2026-01-01T00:00:00.000Z')
  `);

  adminToken = await createAppSessionToken(testEnv, {
    userId: 'user_admin',
    email: 'admin@example.com',
    name: 'Admin User',
    sessionVersion: 0,
  });
  superAdminToken = await createAppSessionToken(testEnv, {
    userId: 'user_super_admin',
    email: 'superadmin@example.com',
    name: 'Super Admin',
    sessionVersion: 0,
  });
}

async function seedInventory(
  id: string,
  warehouseId: string,
  zoneId: string | null,
  partId: string,
  quantity: number,
  condition = 'Good',
) {
  await run(`
    INSERT INTO inventory (
      id, tenant_id, company_id, warehouse_id, zone_id, part_id, quantity, condition, updated_at
    ) VALUES (?, 'tenant_cirtell_default', 'company_cirtell_default', ?, ?, ?, ?, ?, '2026-01-01T00:00:00.000Z')
  `, id, warehouseId, zoneId, partId, quantity, condition);
}

async function inventoryQty(warehouseId: string, partId: string, condition = 'Good', zoneId: string | null = null) {
  const row = await first<{ quantity: number }>(`
    SELECT quantity
    FROM inventory
    WHERE warehouse_id = ?
      AND part_id = ?
      AND condition = ?
      AND ((zone_id IS NULL AND ? IS NULL) OR zone_id = ?)
  `, warehouseId, partId, condition, zoneId, zoneId);
  return row?.quantity || 0;
}

async function inventoryBucketCount(warehouseId: string, partId: string, condition = 'Good', zoneId?: string | null) {
  const zoneClause = zoneId === undefined
    ? ''
    : 'AND ((zone_id IS NULL AND ? IS NULL) OR zone_id = ?)';
  const params = zoneId === undefined
    ? [warehouseId, partId, condition]
    : [warehouseId, partId, condition, zoneId, zoneId];
  const row = await first<{ count: number }>(`
    SELECT COUNT(*) AS count
    FROM inventory
    WHERE warehouse_id = ?
      AND part_id = ?
      AND condition = ?
      ${zoneClause}
  `, ...params);
  return row?.count || 0;
}

async function movementCount(transactionId?: string) {
  const row = transactionId
    ? await first<{ count: number }>('SELECT COUNT(*) AS count FROM inventory_movements WHERE transaction_id = ?', transactionId)
    : await first<{ count: number }>('SELECT COUNT(*) AS count FROM inventory_movements');
  return row?.count || 0;
}

async function createTransaction(payload: JsonMap) {
  const result = await api('POST', '/api/transactions', payload);
  expect(result.response.status).toBe(201);
  expect(result.json.success).toBe(true);
  return result.json.id as string;
}

async function createWarehouseMovement(payload: JsonMap) {
  return api('POST', '/api/warehouses/inventory/move', payload);
}

beforeEach(async () => {
  await reset();
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  await seedBase();
});

describe('transaction inventory auto-sync', () => {
  it('creates Purchase, Sale, Recycle, and Redeploy movements', async () => {
    await seedInventory('inv_source_router', 'wh_source', null, 'part_router', 20);

    const purchaseId = await createTransaction({
      date: '2026-02-01',
      movement_type: 'Purchase',
      part_id: 'part_router',
      quantity: 5,
      destination_warehouse_id: 'wh_source',
    });
    expect(await inventoryQty('wh_source', 'part_router')).toBe(25);

    const saleId = await createTransaction({
      date: '2026-02-02',
      movement_type: 'Sale',
      part_id: 'part_router',
      quantity: 4,
      source_warehouse_id: 'wh_source',
    });
    expect(await inventoryQty('wh_source', 'part_router')).toBe(21);

    const recycleId = await createTransaction({
      date: '2026-02-03',
      movement_type: 'Recycle',
      part_id: 'part_router',
      quantity: 3,
      source_warehouse_id: 'wh_source',
    });
    expect(await inventoryQty('wh_source', 'part_router')).toBe(18);

    const redeployId = await createTransaction({
      date: '2026-02-04',
      movement_type: 'Redeploy',
      part_id: 'part_router',
      quantity: 8,
      source_warehouse_id: 'wh_source',
      destination_warehouse_id: 'wh_dest',
    });
    expect(await inventoryQty('wh_source', 'part_router')).toBe(10);
    expect(await inventoryQty('wh_dest', 'part_router')).toBe(8);

    const rows = await all<{ transaction_id: string; movement_type: string }>(`
      SELECT transaction_id, movement_type
      FROM inventory_movements
      WHERE transaction_id IN (?, ?, ?, ?)
      ORDER BY created_at, id
    `, purchaseId, saleId, recycleId, redeployId);
    expect(rows.map((row) => row.movement_type).sort()).toEqual(['Receive', 'Ship', 'Ship', 'Transfer']);

    const auditRows = await all<{ action: string; resource_type: string; resource_id: string }>(`
      SELECT action, resource_type, resource_id
      FROM audit_log
      WHERE action IN ('TRANSACTION_CREATE', 'INVENTORY_MOVE_AUTO')
      ORDER BY created_at, id
    `);
    expect(auditRows.filter((row) => row.action === 'TRANSACTION_CREATE')).toHaveLength(4);
    expect(new Set(
      auditRows
        .filter((row) => row.action === 'TRANSACTION_CREATE')
        .map((row) => row.resource_id),
    )).toEqual(new Set([purchaseId, saleId, recycleId, redeployId]));
    expect(auditRows.filter((row) => row.action === 'INVENTORY_MOVE_AUTO')).toHaveLength(4);
    expect(auditRows.filter((row) => row.action === 'INVENTORY_MOVE_AUTO').every((row) => row.resource_type === 'inventory_movements')).toBe(true);
  });

  it('syncs line items and marks missing part or warehouse transactions as not_ready', async () => {
    const lineItemId = await createTransaction({
      date: '2026-02-05',
      movement_type: 'Purchase',
      items: [
        { part_id: 'part_router', quantity: 2, destination_warehouse_id: 'wh_source' },
        { part_id: 'part_radio', quantity: 3, destination_warehouse_id: 'wh_dest' },
      ],
    });

    expect(await inventoryQty('wh_source', 'part_router')).toBe(2);
    expect(await inventoryQty('wh_dest', 'part_radio')).toBe(3);
    const itemMovements = await all<{ transaction_item_id: string | null }>(
      'SELECT transaction_item_id FROM inventory_movements WHERE transaction_id = ?',
      lineItemId,
    );
    expect(itemMovements).toHaveLength(2);
    expect(itemMovements.every((row) => row.transaction_item_id !== null)).toBe(true);

    const missingWarehouse = await api('POST', '/api/transactions', {
      date: '2026-02-06',
      movement_type: 'Sale',
      part_id: 'part_router',
      quantity: 1,
    });
    expect(missingWarehouse.response.status).toBe(201);
    expect(missingWarehouse.json.inventorySyncStatus).toBe('not_ready');
    expect(await movementCount(missingWarehouse.json.id)).toBe(0);

    const missingPart = await api('POST', '/api/transactions', {
      date: '2026-02-07',
      movement_type: 'Sale',
      quantity: 1,
      source_warehouse_id: 'wh_source',
    });
    expect(missingPart.response.status).toBe(201);
    expect(missingPart.json.inventorySyncStatus).toBe('not_ready');
    expect(await movementCount(missingPart.json.id)).toBe(0);
  });

  it('rejects insufficient stock without writing partial transaction or movement rows', async () => {
    await seedInventory('inv_source_router_low', 'wh_source', null, 'part_router', 2);

    const result = await api('POST', '/api/transactions', {
      date: '2026-02-08',
      movement_type: 'Sale',
      part_id: 'part_router',
      quantity: 99,
      source_warehouse_id: 'wh_source',
    });

    expect(result.response.status).toBe(409);
    expect(result.json.code).toBe('INSUFFICIENT_STOCK');
    expect((await first<{ count: number }>('SELECT COUNT(*) AS count FROM transactions'))?.count).toBe(0);
    expect(await movementCount()).toBe(0);
    expect(await inventoryQty('wh_source', 'part_router')).toBe(2);

    const failureAudit = await first<{ action: string; details: string }>(`
      SELECT action, details
      FROM audit_log
      WHERE action = 'TRANSACTION_STOCK_SYNC_FAILED'
    `);
    expect(failureAudit?.action).toBe('TRANSACTION_STOCK_SYNC_FAILED');
    expect(failureAudit?.details).toContain('INSUFFICIENT_STOCK');
  });

  it('allocates outbound inventory across default and named zones in stable order', async () => {
    await seedInventory('inv_default_zone', 'wh_source', null, 'part_router', 2);
    await seedInventory('inv_zone_a', 'wh_source', 'zone_a', 'part_router', 3);
    await seedInventory('inv_zone_b', 'wh_source', 'zone_b', 'part_router', 5);

    const transactionId = await createTransaction({
      date: '2026-02-09',
      movement_type: 'Sale',
      part_id: 'part_router',
      quantity: 7,
      source_warehouse_id: 'wh_source',
    });

    expect(await inventoryQty('wh_source', 'part_router', 'Good', null)).toBe(0);
    expect(await inventoryQty('wh_source', 'part_router', 'Good', 'zone_a')).toBe(0);
    expect(await inventoryQty('wh_source', 'part_router', 'Good', 'zone_b')).toBe(3);

    const chunks = await all<{ from_zone_id: string | null; quantity: number }>(`
      SELECT from_zone_id, quantity
      FROM inventory_movements
      WHERE transaction_id = ?
      ORDER BY CASE WHEN from_zone_id IS NULL THEN 0 WHEN from_zone_id = 'zone_a' THEN 1 ELSE 2 END
    `, transactionId);
    expect(chunks).toEqual([
      { from_zone_id: null, quantity: 2 },
      { from_zone_id: 'zone_a', quantity: 3 },
      { from_zone_id: 'zone_b', quantity: 2 },
    ]);
  });

  it('updates a synced transaction by reversing and rebuilding inventory movements', async () => {
    const transactionId = await createTransaction({
      date: '2026-02-10',
      movement_type: 'Purchase',
      part_id: 'part_router',
      quantity: 10,
      destination_warehouse_id: 'wh_source',
    });

    const update = await api('PUT', `/api/transactions/${transactionId}`, { quantity: 4 });
    expect(update.response.status).toBe(200);
    expect(update.json.inventorySyncStatus).toBe('synced');
    expect(await inventoryQty('wh_source', 'part_router')).toBe(4);

    const tx = await first<{ inventory_sync_version: number }>(
      'SELECT inventory_sync_version FROM transactions WHERE id = ?',
      transactionId,
    );
    expect(tx?.inventory_sync_version).toBe(2);
    const movements = await all<{ movement_type: string; sync_source: string; reversal_of_movement_id: string | null }>(`
      SELECT movement_type, sync_source, reversal_of_movement_id
      FROM inventory_movements
      WHERE transaction_id = ?
      ORDER BY created_at, id
    `, transactionId);
    expect(movements).toHaveLength(3);
    expect(movements.filter((row) => row.sync_source === 'reversal')).toHaveLength(1);
    expect(movements.some((row) => row.reversal_of_movement_id !== null)).toBe(true);
  });

  it('voids a synced transaction and reverses inventory without hard deleting audit rows', async () => {
    const transactionId = await createTransaction({
      date: '2026-02-11',
      movement_type: 'Purchase',
      part_id: 'part_router',
      quantity: 6,
      destination_warehouse_id: 'wh_source',
    });
    expect(await inventoryQty('wh_source', 'part_router')).toBe(6);

    const deleted = await api('DELETE', `/api/transactions/${transactionId}`);
    expect(deleted.response.status).toBe(200);
    expect(deleted.json.inventorySyncStatus).toBe('voided');
    expect(await inventoryQty('wh_source', 'part_router')).toBe(0);

    const tx = await first<{ inventory_sync_status: string; voided_at: string | null }>(
      'SELECT inventory_sync_status, voided_at FROM transactions WHERE id = ?',
      transactionId,
    );
    expect(tx?.inventory_sync_status).toBe('voided');
    expect(tx?.voided_at).toBeTruthy();
    expect(await movementCount(transactionId)).toBe(2);
  });

  it('backfills existing transactions idempotently in chronological order', async () => {
    await run(`
      INSERT INTO transactions (
        id, tenant_id, company_id, date, movement_type, quantity, unit_price_usd,
        part_id, destination_warehouse_id, created_by, created_at, updated_at,
        inventory_sync_status, inventory_sync_version
      ) VALUES (
        'bf_purchase', 'tenant_cirtell_default', 'company_cirtell_default', '2026-01-01',
        'Purchase', 5, 0, 'part_router', 'wh_source', 'user_admin',
        '2026-01-01T08:00:00.000Z', '2026-01-01T08:00:00.000Z', 'not_ready', 0
      )
    `);
    await run(`
      INSERT INTO transactions (
        id, tenant_id, company_id, date, movement_type, quantity, unit_price_usd,
        part_id, source_warehouse_id, created_by, created_at, updated_at,
        inventory_sync_status, inventory_sync_version
      ) VALUES (
        'bf_sale', 'tenant_cirtell_default', 'company_cirtell_default', '2026-01-02',
        'Sale', 3, 0, 'part_router', 'wh_source', 'user_admin',
        '2026-01-02T08:00:00.000Z', '2026-01-02T08:00:00.000Z', 'not_ready', 0
      )
    `);

    const adminDenied = await api('POST', '/api/transactions/inventory-backfill', { dryRun: true, limit: 10 });
    expect(adminDenied.response.status).toBe(403);

    const dryRun = await api('POST', '/api/transactions/inventory-backfill', { dryRun: true, limit: 10 }, superAdminToken);
    expect(dryRun.response.status).toBe(200);
    expect(dryRun.json.summary.eligible).toBe(2);
    expect(dryRun.json.results.map((row: BackfillResult) => row.transactionId)).toEqual(['bf_purchase', 'bf_sale']);

    const apply = await api('POST', '/api/transactions/inventory-backfill', { dryRun: false, limit: 10 }, superAdminToken);
    expect(apply.response.status).toBe(200);
    expect(apply.json.summary.applied).toBe(2);
    expect(await inventoryQty('wh_source', 'part_router')).toBe(2);
    expect((await first<{ count: number }>(
      "SELECT COUNT(*) AS count FROM inventory_movements WHERE sync_source = 'backfill'",
    ))?.count).toBe(2);

    const keys = await all<{ idempotency_key: string }>(
      "SELECT idempotency_key FROM inventory_movements WHERE sync_source = 'backfill' ORDER BY created_at, id",
    );
    expect(new Set(keys.map((row) => row.idempotency_key))).toEqual(new Set([
      'backfill:bf_purchase:header:0',
      'backfill:bf_sale:header:0',
    ]));

    const secondApply = await api('POST', '/api/transactions/inventory-backfill', { dryRun: false, limit: 10 }, superAdminToken);
    expect(secondApply.response.status).toBe(200);
    expect(secondApply.json.summary.applied).toBe(0);
    expect((await first<{ count: number }>(
      "SELECT COUNT(*) AS count FROM inventory_movements WHERE sync_source = 'backfill'",
    ))?.count).toBe(2);
  });

  it('blocks cross-tenant part and warehouse references', async () => {
    const crossPart = await api('POST', '/api/transactions', {
      date: '2026-02-12',
      movement_type: 'Purchase',
      part_id: 'part_other',
      quantity: 1,
      destination_warehouse_id: 'wh_source',
    });
    expect(crossPart.response.status).toBe(400);
    expect(crossPart.json.error).toBe('Part not found');

    const crossWarehouse = await api('POST', '/api/transactions', {
      date: '2026-02-13',
      movement_type: 'Purchase',
      part_id: 'part_router',
      quantity: 1,
      destination_warehouse_id: 'wh_other',
    });
    expect(crossWarehouse.response.status).toBe(400);
    expect(crossWarehouse.json.error).toBe('Destination warehouse not found');
    expect((await first<{ count: number }>('SELECT COUNT(*) AS count FROM transactions'))?.count).toBe(0);
  });
});

describe('warehouse inventory movement validation', () => {
  it('creates one warehouse-level bucket for repeated Receive with null zone', async () => {
    const firstReceive = await createWarehouseMovement({
      movement_type: 'Receive',
      part_id: 'part_router',
      quantity: 4,
      to_warehouse_id: 'wh_source',
    });
    expect(firstReceive.response.status).toBe(201);
    expect(await inventoryBucketCount('wh_source', 'part_router', 'Good', null)).toBe(1);
    expect(await inventoryQty('wh_source', 'part_router')).toBe(4);

    const secondReceive = await createWarehouseMovement({
      movement_type: 'Receive',
      part_id: 'part_router',
      quantity: 6,
      to_warehouse_id: 'wh_source',
    });
    expect(secondReceive.response.status).toBe(201);
    expect(await inventoryBucketCount('wh_source', 'part_router', 'Good', null)).toBe(1);
    expect(await inventoryQty('wh_source', 'part_router')).toBe(10);
  });

  it('keeps separate buckets for different zones', async () => {
    const zoneA = await createWarehouseMovement({
      movement_type: 'Receive',
      part_id: 'part_router',
      quantity: 3,
      to_warehouse_id: 'wh_source',
      to_zone_id: 'zone_a',
    });
    const zoneB = await createWarehouseMovement({
      movement_type: 'Receive',
      part_id: 'part_router',
      quantity: 5,
      to_warehouse_id: 'wh_source',
      to_zone_id: 'zone_b',
    });

    expect(zoneA.response.status).toBe(201);
    expect(zoneB.response.status).toBe(201);
    expect(await inventoryQty('wh_source', 'part_router', 'Good', 'zone_a')).toBe(3);
    expect(await inventoryQty('wh_source', 'part_router', 'Good', 'zone_b')).toBe(5);
    expect(await inventoryBucketCount('wh_source', 'part_router')).toBe(2);
  });

  it('keeps warehouse-level and zone buckets separate', async () => {
    await createWarehouseMovement({
      movement_type: 'Receive',
      part_id: 'part_router',
      quantity: 2,
      to_warehouse_id: 'wh_source',
    });
    await createWarehouseMovement({
      movement_type: 'Receive',
      part_id: 'part_router',
      quantity: 7,
      to_warehouse_id: 'wh_source',
      to_zone_id: 'zone_a',
    });

    expect(await inventoryQty('wh_source', 'part_router')).toBe(2);
    expect(await inventoryQty('wh_source', 'part_router', 'Good', 'zone_a')).toBe(7);
    expect(await inventoryBucketCount('wh_source', 'part_router')).toBe(2);
  });

  it('ships stock when source has enough quantity', async () => {
    await seedInventory('inv_manual_ship_ok', 'wh_source', null, 'part_router', 5);

    const result = await createWarehouseMovement({
      movement_type: 'Ship',
      part_id: 'part_router',
      quantity: 3,
      from_warehouse_id: 'wh_source',
    });

    expect(result.response.status).toBe(201);
    expect(result.json.success).toBe(true);
    expect(await inventoryQty('wh_source', 'part_router')).toBe(2);
    expect(await movementCount()).toBe(1);
    expect((await first<{ action: string }>(
      "SELECT action FROM audit_log WHERE action = 'INVENTORY_MOVE'",
    ))?.action).toBe('INVENTORY_MOVE');
  });

  it('rejects Ship when stock is missing and writes no partial data', async () => {
    await seedInventory('inv_manual_ship_low', 'wh_source', null, 'part_router', 2);

    const result = await createWarehouseMovement({
      movement_type: 'Ship',
      part_id: 'part_router',
      quantity: 3,
      from_warehouse_id: 'wh_source',
    });

    expect(result.response.status).toBe(409);
    expect(result.json.code).toBe('INSUFFICIENT_STOCK');
    expect(await inventoryQty('wh_source', 'part_router')).toBe(2);
    expect(await movementCount()).toBe(0);
  });

  it('transfers stock when source has enough quantity', async () => {
    await seedInventory('inv_manual_transfer_ok', 'wh_source', null, 'part_router', 5);

    const result = await createWarehouseMovement({
      movement_type: 'Transfer',
      part_id: 'part_router',
      quantity: 4,
      from_warehouse_id: 'wh_source',
      to_warehouse_id: 'wh_dest',
    });

    expect(result.response.status).toBe(201);
    expect(await inventoryQty('wh_source', 'part_router')).toBe(1);
    expect(await inventoryQty('wh_dest', 'part_router')).toBe(4);
    expect((await first<{ movement_type: string }>(
      'SELECT movement_type FROM inventory_movements',
    ))?.movement_type).toBe('Transfer');
  });

  it('transfers from a warehouse-level bucket into a specific zone without duplicating buckets', async () => {
    await seedInventory('inv_transfer_zone_source', 'wh_source', null, 'part_router', 8);

    const result = await createWarehouseMovement({
      movement_type: 'Transfer',
      part_id: 'part_router',
      quantity: 5,
      from_warehouse_id: 'wh_source',
      to_warehouse_id: 'wh_dest',
      to_zone_id: 'zone_dest',
    });

    expect(result.response.status).toBe(201);
    expect(await inventoryBucketCount('wh_source', 'part_router', 'Good', null)).toBe(1);
    expect(await inventoryQty('wh_source', 'part_router')).toBe(3);
    expect(await inventoryBucketCount('wh_dest', 'part_router', 'Good', 'zone_dest')).toBe(1);
    expect(await inventoryQty('wh_dest', 'part_router', 'Good', 'zone_dest')).toBe(5);
  });

  it('rejects Transfer when source stock is insufficient', async () => {
    await seedInventory('inv_manual_transfer_low', 'wh_source', null, 'part_router', 2);

    const result = await createWarehouseMovement({
      movement_type: 'Transfer',
      part_id: 'part_router',
      quantity: 3,
      from_warehouse_id: 'wh_source',
      to_warehouse_id: 'wh_dest',
    });

    expect(result.response.status).toBe(409);
    expect(result.json.code).toBe('INSUFFICIENT_STOCK');
    expect(await inventoryQty('wh_source', 'part_router')).toBe(2);
    expect(await inventoryQty('wh_dest', 'part_router')).toBe(0);
    expect(await movementCount()).toBe(0);
  });

  it('rejects outbound Adjust when it would make stock negative', async () => {
    await seedInventory('inv_manual_adjust_low', 'wh_source', null, 'part_router', 2);

    const result = await createWarehouseMovement({
      movement_type: 'Adjust',
      part_id: 'part_router',
      quantity: 3,
      from_warehouse_id: 'wh_source',
    });

    expect(result.response.status).toBe(409);
    expect(result.json.code).toBe('INSUFFICIENT_STOCK');
    expect(await inventoryQty('wh_source', 'part_router')).toBe(2);
    expect(await movementCount()).toBe(0);
  });

  it('blocks cross-tenant warehouse references for manual movement', async () => {
    await seedInventory('inv_manual_cross_scope', 'wh_source', null, 'part_router', 5);

    const result = await createWarehouseMovement({
      movement_type: 'Transfer',
      part_id: 'part_router',
      quantity: 1,
      from_warehouse_id: 'wh_source',
      to_warehouse_id: 'wh_other',
    });

    expect(result.response.status).toBe(400);
    expect(result.json.code).toBe('WAREHOUSE_NOT_FOUND');
    expect(result.json.error).toBe('Destination warehouse not found');
    expect(await inventoryQty('wh_source', 'part_router')).toBe(5);
    expect(await movementCount()).toBe(0);
  });

  it('allows another company to use an equivalent bucket key without conflict', async () => {
    await createWarehouseMovement({
      movement_type: 'Receive',
      part_id: 'part_router',
      quantity: 4,
      to_warehouse_id: 'wh_source',
    });
    const otherCompany = await api('POST', '/api/warehouses/inventory/move?company_id=company_other', {
      movement_type: 'Receive',
      part_id: 'part_other',
      quantity: 9,
      to_warehouse_id: 'wh_other',
    }, superAdminToken);

    expect(otherCompany.response.status).toBe(201);
    expect((await first<{ quantity: number }>(`
      SELECT quantity
      FROM inventory
      WHERE tenant_id = 'tenant_other'
        AND company_id = 'company_other'
        AND warehouse_id = 'wh_other'
        AND part_id = 'part_other'
        AND condition = 'Good'
        AND zone_id IS NULL
    `))?.quantity).toBe(9);
    expect(await inventoryQty('wh_source', 'part_router')).toBe(4);
  });

  it('rejects cross-tenant parts for manual movement', async () => {
    const result = await createWarehouseMovement({
      movement_type: 'Receive',
      part_id: 'part_other',
      quantity: 1,
      to_warehouse_id: 'wh_source',
    });

    expect(result.response.status).toBe(400);
    expect(result.json.code).toBe('PART_NOT_FOUND');
    expect(await inventoryBucketCount('wh_source', 'part_other')).toBe(0);
    expect(await movementCount()).toBe(0);
  });

  it('does not let a later Receive mask an earlier over-Ship in the same batch', async () => {
    await expect(applyInventoryMovements(testEnv.DB, [
      {
        movementType: 'Ship',
        partId: 'part_router',
        quantity: 5,
        fromWarehouseId: 'wh_source',
        syncSource: 'manual',
      },
      {
        movementType: 'Receive',
        partId: 'part_router',
        quantity: 5,
        toWarehouseId: 'wh_source',
        syncSource: 'manual',
      },
    ], {
      tenantId: 'tenant_cirtell_default',
      companyId: 'company_cirtell_default',
    })).rejects.toMatchObject({
      code: 'INSUFFICIENT_STOCK',
      status: 409,
    });

    expect(await movementCount()).toBe(0);
    expect(await inventoryQty('wh_source', 'part_router')).toBe(0);
  });
});

interface BackfillResult {
  transactionId: string;
}
