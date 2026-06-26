import { beforeEach, describe, expect, it } from 'vitest';
import {
  all,
  apiRequest,
  first,
  resetAndSeedBackend,
  run,
  type SeededBackend,
} from './helpers';

let seeded: SeededBackend;

beforeEach(async () => {
  seeded = await resetAndSeedBackend();
  await seedTenantIsolationFixtures();
});

async function seedTenantIsolationFixtures() {
  await run(`
    INSERT INTO warehouse_zones (
      id, tenant_id, company_id, warehouse_id, name, zone_type, capacity_units
    ) VALUES
      ('zone_a_source_floor', 'tenant_a', 'company_a1', 'wh_a_source', 'A Source Floor', 'storage', 100),
      ('zone_b_source_floor', 'tenant_b', 'company_b1', 'wh_b_source', 'B Source Floor', 'storage', 100)
  `);

  await run(`
    INSERT INTO transaction_items (
      id, transaction_id, tenant_id, company_id, part_id, condition, quantity,
      unit_price_usd, destination_warehouse_id
    ) VALUES
      ('txi_a_existing', 'tx_a_existing', 'tenant_a', 'company_a1', 'part_a_router', 'Good', 2, 100, 'wh_a_source'),
      ('txi_b_existing', 'tx_b_existing', 'tenant_b', 'company_b1', 'part_b_router', 'Good', 5, 200, 'wh_b_source')
  `);

  await run(`
    UPDATE ghg_emission_entries
    SET co2e_kg = 100, activity_data = 40, emission_factor = 2.5
    WHERE id = 'ghg_a_scope1'
  `);
  await run(`
    UPDATE ghg_emission_entries
    SET co2e_kg = 900, activity_data = 300, emission_factor = 3
    WHERE id = 'ghg_b_scope3'
  `);
}

function ids(rows: any[], field = 'id') {
  return rows.map((row) => row[field]);
}

function expectNoTenantBText(value: unknown) {
  const text = JSON.stringify(value);
  expect(text).not.toContain('tenant_b');
  expect(text).not.toContain('company_b1');
  expect(text).not.toContain('part_b_router');
  expect(text).not.toContain('RTR-B-100');
  expect(text).not.toContain('tx_b_existing');
  expect(text).not.toContain('project_b');
}

describe('tenant and company isolation', () => {
  it('scopes the parts list to Admin A even when B scope parameters and headers are supplied', async () => {
    const list = await apiRequest('GET', '/api/parts', {
      token: seeded.tokens.adminA,
    });
    expect(list.response.status).toBe(200);
    expect(ids(list.json?.parts || [])).toEqual(expect.arrayContaining([
      'part_a_router',
      'part_a_radio',
      'part_a_shared',
    ]));
    expect(ids(list.json?.parts || [])).not.toContain('part_b_router');
    expect(list.json?.total).toBe(3);
    expectNoTenantBText(list.json);

    const tampered = await apiRequest('GET', '/api/parts?tenant_id=tenant_b&company_id=company_b1', {
      token: seeded.tokens.adminA,
      headers: {
        'x-acting-tenant': 'tenant_b',
        'x-acting-company': 'company_b1',
      },
    });
    expect(tampered.response.status).toBe(200);
    expect(ids(tampered.json?.parts || [])).toEqual(expect.arrayContaining([
      'part_a_router',
      'part_a_radio',
      'part_a_shared',
    ]));
    expect(ids(tampered.json?.parts || [])).not.toContain('part_b_router');
    expect(tampered.json?.total).toBe(3);
    expectNoTenantBText(tampered.json);
  });

  it('hides part B detail and blocks creating a transaction that references part B', async () => {
    const detail = await apiRequest('GET', '/api/parts/part_b_router', {
      token: seeded.tokens.adminA,
    });
    expect(detail.response.status).toBe(404);
    expectNoTenantBText(detail.json);

    const create = await apiRequest('POST', '/api/transactions?tenant_id=tenant_b&company_id=company_b1', {
      token: seeded.tokens.adminA,
      headers: {
        'x-acting-tenant': 'tenant_b',
        'x-acting-company': 'company_b1',
      },
      body: {
        date: '2026-06-01',
        movement_type: 'Purchase',
        part_id: 'part_b_router',
        quantity: 1,
        destination_warehouse_id: 'wh_a_source',
      },
    });
    expect(create.response.status).toBe(400);
    expect(create.json?.error).toBe('Part not found');
    expectNoTenantBText(create.json);

    const created = await first<{ count: number }>(
      "SELECT COUNT(*) AS count FROM transactions WHERE date = '2026-06-01'",
    );
    expect(created?.count).toBe(0);
    const leakedAudit = await first<{ count: number }>(`
      SELECT COUNT(*) AS count
      FROM audit_log
      WHERE user_id = 'admin_a' AND details LIKE '%part_b_router%'
    `);
    expect(leakedAudit?.count).toBe(0);
  });

  it('isolates transaction list, detail, update, and delete operations by tenant/company', async () => {
    const list = await apiRequest('GET', '/api/transactions?tenant_id=tenant_b&company_id=company_b1', {
      token: seeded.tokens.adminA,
      headers: {
        'x-acting-tenant': 'tenant_b',
        'x-acting-company': 'company_b1',
      },
    });
    expect(list.response.status).toBe(200);
    expect(ids(list.json?.transactions || [])).toContain('tx_a_existing');
    expect(ids(list.json?.transactions || [])).not.toContain('tx_b_existing');
    expectNoTenantBText(list.json);

    const detail = await apiRequest('GET', '/api/transactions/tx_b_existing', {
      token: seeded.tokens.adminA,
    });
    expect(detail.response.status).toBe(404);

    const before = await first<{ updated_at: string; voided_at: string | null; inventory_sync_status: string }>(
      'SELECT updated_at, voided_at, inventory_sync_status FROM transactions WHERE id = ?',
      'tx_b_existing',
    );

    const update = await apiRequest('PUT', '/api/transactions/tx_b_existing', {
      token: seeded.tokens.adminA,
      body: { quantity: 9 },
    });
    expect(update.response.status).toBe(404);

    const remove = await apiRequest('DELETE', '/api/transactions/tx_b_existing', {
      token: seeded.tokens.adminA,
    });
    expect(remove.response.status).toBe(404);

    const after = await first<{ updated_at: string; voided_at: string | null; inventory_sync_status: string }>(
      'SELECT updated_at, voided_at, inventory_sync_status FROM transactions WHERE id = ?',
      'tx_b_existing',
    );
    expect(after).toEqual(before);
    const crossMovements = await first<{ count: number }>(`
      SELECT COUNT(*) AS count
      FROM inventory_movements
      WHERE created_by = 'admin_a' AND tenant_id = 'tenant_b'
    `);
    expect(crossMovements?.count).toBe(0);
  });

  it('isolates project list, detail, and child writes for projects outside scope', async () => {
    const list = await apiRequest('GET', '/api/projects?tenant_id=tenant_b&company_id=company_b1', {
      token: seeded.tokens.adminA,
      headers: {
        'x-acting-tenant': 'tenant_b',
        'x-acting-company': 'company_b1',
      },
    });
    expect(list.response.status).toBe(200);
    expect(ids(list.json?.projects || [])).toContain('project_a');
    expect(ids(list.json?.projects || [])).not.toContain('project_b');
    expectNoTenantBText(list.json);

    const detail = await apiRequest('GET', '/api/projects/project_b', {
      token: seeded.tokens.adminA,
    });
    expect(detail.response.status).toBe(404);
    expectNoTenantBText(detail.json);

    const beforeComments = await first<{ count: number }>(
      'SELECT COUNT(*) AS count FROM project_comments WHERE project_id = ?',
      'project_b',
    );
    const comment = await apiRequest('POST', '/api/projects/project_b/comments', {
      token: seeded.tokens.adminA,
      body: { body: 'Admin A must not write to Project B' },
    });
    expect(comment.response.status).toBe(404);
    expectNoTenantBText(comment.json);

    const afterComments = await first<{ count: number }>(
      'SELECT COUNT(*) AS count FROM project_comments WHERE project_id = ?',
      'project_b',
    );
    expect(afterComments).toEqual(beforeComments);
    const childRows = await first<{ count: number }>(`
      SELECT COUNT(*) AS count
      FROM project_comments
      WHERE body LIKE '%Project B%'
    `);
    expect(childRows?.count).toBe(0);
  });

  it('isolates warehouse inventory reads and blocks movements with B warehouse or part references', async () => {
    const list = await apiRequest('GET', '/api/warehouses/inventory/all?tenant_id=tenant_b&company_id=company_b1', {
      token: seeded.tokens.adminA,
      headers: {
        'x-acting-tenant': 'tenant_b',
        'x-acting-company': 'company_b1',
      },
    });
    expect(list.response.status).toBe(200);
    expect(ids(list.json?.inventory || [], 'part_number')).toContain('RTR-A-100');
    expect(ids(list.json?.inventory || [], 'part_number')).not.toContain('RTR-B-100');
    expectNoTenantBText(list.json);

    const beforeB = await first<{ quantity: number }>(
      'SELECT quantity FROM inventory WHERE id = ?',
      'inv_b_router',
    );

    const crossWarehouse = await apiRequest('POST', '/api/warehouses/inventory/move', {
      token: seeded.tokens.adminA,
      body: {
        movement_type: 'Transfer',
        part_id: 'part_a_router',
        quantity: 1,
        from_warehouse_id: 'wh_a_source',
        to_warehouse_id: 'wh_b_source',
      },
    });
    expect(crossWarehouse.response.status).toBe(400);
    expect(crossWarehouse.json?.code).toBe('WAREHOUSE_NOT_FOUND');

    const crossPart = await apiRequest('POST', '/api/warehouses/inventory/move', {
      token: seeded.tokens.adminA,
      body: {
        movement_type: 'Receive',
        part_id: 'part_b_router',
        quantity: 1,
        to_warehouse_id: 'wh_a_source',
      },
    });
    expect(crossPart.response.status).toBe(400);
    expect(crossPart.json?.code).toBe('PART_NOT_FOUND');

    const afterB = await first<{ quantity: number }>(
      'SELECT quantity FROM inventory WHERE id = ?',
      'inv_b_router',
    );
    expect(afterB).toEqual(beforeB);
    const movementRows = await first<{ count: number }>(`
      SELECT COUNT(*) AS count
      FROM inventory_movements
      WHERE tenant_id = 'tenant_b' AND created_by = 'admin_a'
    `);
    expect(movementRows?.count).toBe(0);
  });

  it('isolates carbon reports and dashboard KPIs from tenant B emissions', async () => {
    const report = await apiRequest('GET', '/api/ghg/report?tenant_id=tenant_b&company_id=company_b1', {
      token: seeded.tokens.adminA,
      headers: {
        'x-acting-tenant': 'tenant_b',
        'x-acting-company': 'company_b1',
      },
    });
    expect(report.response.status).toBe(200);
    expect(report.json?.totals.total_kg).toBe(100);
    expect(report.json?.totals.actual_co2e_kg ?? report.json?.actual?.total_co2e_kg).not.toBe(900);
    expect(JSON.stringify(report.json?.breakdown || [])).not.toContain('ghg_b_scope3');
    expect(report.json?.breakdown).toEqual(expect.arrayContaining([
      expect.objectContaining({ total_co2e_kg: 100 }),
    ]));

    const dashboard = await apiRequest('GET', '/api/overview/headline?tenant_id=tenant_b&company_id=company_b1', {
      token: seeded.tokens.adminA,
      headers: {
        'x-acting-tenant': 'tenant_b',
        'x-acting-company': 'company_b1',
      },
    });
    expect(dashboard.response.status).toBe(200);
    expect(dashboard.json?.data.total_co2e_kg).toBe(100);
    expect(dashboard.json?.data.actual_co2e_kg).toBe(100);
    expect(dashboard.json?.data.total_co2e_kg).not.toBe(900);
    expectNoTenantBText(dashboard.json);
  });

  it('blocks tenant B PO download and limits audit logs to Admin A tenant', async () => {
    const download = await apiRequest('GET', '/api/transactions/tx_b_existing/po-download', {
      token: seeded.tokens.adminA,
    });
    expect(download.response.status).toBe(404);
    expect(download.response.headers.get('Content-Type')).toContain('application/json');
    expectNoTenantBText(download.json);

    const audit = await apiRequest('GET', '/api/admin/audit-log?tenant_id=tenant_b&company_id=company_b1', {
      token: seeded.tokens.adminA,
      headers: {
        'x-acting-tenant': 'tenant_b',
        'x-acting-company': 'company_b1',
      },
    });
    expect(audit.response.status).toBe(200);
    expect(ids(audit.json?.audit || [])).toContain('audit_a');
    expect(ids(audit.json?.audit || [])).not.toContain('audit_b');
    expect(JSON.stringify(audit.json?.audit || [])).not.toContain('user.b@example.com');
    expect(JSON.stringify(audit.json?.audit || [])).not.toContain('Tenant B');
  });
});
