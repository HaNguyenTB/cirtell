import { beforeEach, describe, expect, it } from 'vitest';
import { apiRequest, first, resetAndSeedBackend, run, type SeededBackend } from './helpers';

let seeded: SeededBackend;

beforeEach(async () => {
  seeded = await resetAndSeedBackend();
});

describe('project transaction projection route', () => {
  it('returns transaction-derived materials and financials separately from manual project records', async () => {
    await run(`
      INSERT INTO project_equipment (
        id, project_id, tenant_id, company_id, item_name, quantity, condition,
        current_stage, estimated_reuse_value, co2_avoided_kg
      ) VALUES (
        'manual_equipment_a', 'project_a', 'tenant_a', 'company_a1',
        'Manual project asset', 1, 'Good', 'assessment', 50, 5
      )
    `);
    await run(`
      INSERT INTO project_financials (
        id, project_id, tenant_id, company_id, type, category, amount, currency
      ) VALUES (
        'manual_financial_a', 'project_a', 'tenant_a', 'company_a1',
        'cost', 'Manual inspection', 25, 'USD'
      )
    `);

    const result = await apiRequest('GET', '/api/projects/project_a', {
      token: seeded.tokens.adminA,
    });

    expect(result.response.status).toBe(200);
    expect(result.json?.equipment).toHaveLength(1);
    expect(result.json?.equipment[0]).toMatchObject({
      id: 'manual_equipment_a',
      item_name: 'Manual project asset',
    });
    expect(result.json?.financials).toHaveLength(1);
    expect(result.json?.financials[0]).toMatchObject({
      id: 'manual_financial_a',
      category: 'Manual inspection',
    });

    expect(result.json?.transactionProjection.transactionSummary).toMatchObject({
      transactionCount: 1,
      lineCount: 1,
      totalTransactionValue: 200,
      purchaseCost: 200,
    });
    expect(result.json?.transactionProjection.projectedEquipment).toEqual([
      expect.objectContaining({
        projectId: 'project_a',
        partId: 'part_a_router',
        itemName: 'Router A 100',
        quantity: 2,
        currentStage: 'acquisition',
        source: 'transaction',
        readOnly: true,
        transactionIds: ['tx_a_existing'],
      }),
    ]);
    expect(result.json?.transactionProjection.projectedFinancials).toEqual([
      expect.objectContaining({
        projectId: 'project_a',
        transactionId: 'tx_a_existing',
        movementType: 'Purchase',
        type: 'cost',
        amount: 200,
        source: 'transaction',
        readOnly: true,
      }),
    ]);
    expect(JSON.stringify(result.json?.transactionProjection)).not.toContain('part_b_router');
    expect(JSON.stringify(result.json?.transactionProjection)).not.toContain('tx_b_existing');
  });

  it('reflects transaction changes on the next project read without persisting duplicate project rows', async () => {
    const before = await apiRequest('GET', '/api/projects/project_a', {
      token: seeded.tokens.adminA,
    });
    expect(before.response.status).toBe(200);
    expect(before.json?.transactionProjection.transactionSummary.transactionCount).toBe(1);

    await run(`
      UPDATE transactions
      SET voided_at = '2026-07-19T00:00:00.000Z', inventory_sync_status = 'voided'
      WHERE id = 'tx_a_existing'
    `);

    const after = await apiRequest('GET', '/api/projects/project_a', {
      token: seeded.tokens.adminA,
    });
    expect(after.response.status).toBe(200);
    expect(after.json?.transactionProjection).toMatchObject({
      projectedEquipment: [],
      projectedFinancials: [],
      transactionSummary: {
        transactionCount: 0,
        lineCount: 0,
        totalTransactionValue: 0,
      },
    });

    const equipmentRows = await first<{ count: number }>(
      'SELECT COUNT(*) AS count FROM project_equipment WHERE project_id = ?',
      'project_a',
    );
    const financialRows = await first<{ count: number }>(
      'SELECT COUNT(*) AS count FROM project_financials WHERE project_id = ?',
      'project_a',
    );
    expect(equipmentRows?.count).toBe(0);
    expect(financialRows?.count).toBe(0);
  });

  it('reprojects stage and financial type after a not-ready transaction changes movement type', async () => {
    const created = await apiRequest('POST', '/api/transactions', {
      token: seeded.tokens.adminA,
      body: {
        date: '2026-07-11',
        movement_type: 'Purchase',
        part_id: 'part_a_radio',
        quantity: 2,
        unit_price_usd: 75,
        condition: 'Good',
        project_id: 'project_a',
      },
    });
    expect(created.response.status).toBe(201);
    expect(created.json?.inventorySyncStatus).toBe('not_ready');
    const transactionId = String(created.json?.id);

    const purchaseProjection = await apiRequest('GET', '/api/projects/project_a', {
      token: seeded.tokens.adminA,
    });
    expect(purchaseProjection.response.status).toBe(200);
    expect(purchaseProjection.json?.transactionProjection.projectedEquipment).toContainEqual(
      expect.objectContaining({
        currentStage: 'acquisition',
        transactionIds: [transactionId],
        inventorySyncStatuses: ['not_ready'],
      }),
    );
    expect(purchaseProjection.json?.transactionProjection.projectedFinancials).toContainEqual(
      expect.objectContaining({ transactionId, movementType: 'Purchase', type: 'cost', amount: 150 }),
    );

    const updated = await apiRequest('PUT', `/api/transactions/${transactionId}`, {
      token: seeded.tokens.adminA,
      body: { movement_type: 'Sale' },
    });
    expect(updated.response.status).toBe(200);
    expect(updated.json?.inventorySyncStatus).toBe('not_ready');

    const saleProjection = await apiRequest('GET', '/api/projects/project_a', {
      token: seeded.tokens.adminA,
    });
    expect(saleProjection.response.status).toBe(200);
    expect(saleProjection.json?.transactionProjection.projectedEquipment).toContainEqual(
      expect.objectContaining({
        currentStage: 'sold',
        transactionIds: [transactionId],
        inventorySyncStatuses: ['not_ready'],
      }),
    );
    expect(saleProjection.json?.transactionProjection.projectedEquipment).not.toContainEqual(
      expect.objectContaining({ currentStage: 'acquisition', transactionIds: [transactionId] }),
    );
    expect(saleProjection.json?.transactionProjection.projectedFinancials).toContainEqual(
      expect.objectContaining({ transactionId, movementType: 'Sale', type: 'revenue', amount: 150 }),
    );
  });

  it('tracks create, update, and void through transaction routes without duplicating project tables', async () => {
    await run(`
      INSERT INTO projects (
        id, tenant_id, company_id, name, currency, status, created_by, created_at, updated_at
      ) VALUES (
        'projection_route_project', 'tenant_a', 'company_a1',
        'Projection Route Project', 'USD', 'in-progress', 'admin_a',
        '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z'
      )
    `);

    const created = await apiRequest('POST', '/api/transactions', {
      token: seeded.tokens.adminA,
      body: {
        date: '2026-07-10',
        movement_type: 'Purchase',
        part_id: 'part_a_radio',
        quantity: 3,
        unit_price_usd: 100,
        condition: 'Good',
        destination_warehouse_id: 'wh_a_dest',
        project_id: 'projection_route_project',
      },
    });
    expect(created.response.status).toBe(201);
    expect(created.json?.inventorySyncStatus).toBe('synced');
    const transactionId = String(created.json?.id);

    const afterCreate = await apiRequest('GET', '/api/projects/projection_route_project', {
      token: seeded.tokens.adminA,
    });
    expect(afterCreate.response.status).toBe(200);
    expect(afterCreate.json?.transactionProjection.projectedEquipment).toEqual([
      expect.objectContaining({
        partId: 'part_a_radio',
        quantity: 3,
        transactionValue: 300,
        transactionIds: [transactionId],
      }),
    ]);
    expect(afterCreate.json?.transactionProjection.projectedFinancials).toEqual([
      expect.objectContaining({ transactionId, type: 'cost', amount: 300 }),
    ]);

    const updated = await apiRequest('PUT', `/api/transactions/${transactionId}`, {
      token: seeded.tokens.adminA,
      body: { quantity: 4, unit_price_usd: 125 },
    });
    expect(updated.response.status).toBe(200);
    expect(updated.json?.inventorySyncStatus).toBe('synced');

    const afterUpdate = await apiRequest('GET', '/api/projects/projection_route_project', {
      token: seeded.tokens.adminA,
    });
    expect(afterUpdate.response.status).toBe(200);
    expect(afterUpdate.json?.transactionProjection.projectedEquipment[0]).toMatchObject({
      quantity: 4,
      transactionValue: 500,
    });
    expect(afterUpdate.json?.transactionProjection.projectedFinancials[0]).toMatchObject({
      transactionId,
      amount: 500,
    });

    const removed = await apiRequest('DELETE', `/api/transactions/${transactionId}`, {
      token: seeded.tokens.adminA,
    });
    expect(removed.response.status).toBe(200);
    expect(removed.json?.inventorySyncStatus).toBe('voided');

    const afterVoid = await apiRequest('GET', '/api/projects/projection_route_project', {
      token: seeded.tokens.adminA,
    });
    expect(afterVoid.response.status).toBe(200);
    expect(afterVoid.json?.transactionProjection.projectedEquipment).toEqual([]);
    expect(afterVoid.json?.transactionProjection.projectedFinancials).toEqual([]);

    const equipmentRows = await first<{ count: number }>(
      'SELECT COUNT(*) AS count FROM project_equipment WHERE project_id = ?',
      'projection_route_project',
    );
    const financialRows = await first<{ count: number }>(
      'SELECT COUNT(*) AS count FROM project_financials WHERE project_id = ?',
      'projection_route_project',
    );
    expect(equipmentRows?.count).toBe(0);
    expect(financialRows?.count).toBe(0);
  });

  it('returns 404 without writes when create or update references a project outside scope', async () => {
    const beforeTransactions = await first<{ count: number }>(
      "SELECT COUNT(*) AS count FROM transactions WHERE tenant_id = 'tenant_a' AND company_id = 'company_a1'",
    );

    const created = await apiRequest('POST', '/api/transactions', {
      token: seeded.tokens.adminA,
      body: {
        date: '2026-07-20',
        movement_type: 'Purchase',
        part_id: 'part_a_radio',
        quantity: 1,
        unit_price_usd: 100,
        condition: 'Good',
        destination_warehouse_id: 'wh_a_dest',
        project_id: 'project_b',
      },
    });
    expect(created.response.status).toBe(404);
    expect(created.json).toEqual({ success: false, error: 'Project not found' });

    const afterTransactions = await first<{ count: number }>(
      "SELECT COUNT(*) AS count FROM transactions WHERE tenant_id = 'tenant_a' AND company_id = 'company_a1'",
    );
    expect(afterTransactions).toEqual(beforeTransactions);

    const updated = await apiRequest('PUT', '/api/transactions/tx_a_existing', {
      token: seeded.tokens.adminA,
      body: { project_id: 'project_b' },
    });
    expect(updated.response.status).toBe(404);
    expect(updated.json).toEqual({ success: false, error: 'Project not found' });

    const stored = await first<{ project_id: string | null }>(
      'SELECT project_id FROM transactions WHERE id = ?',
      'tx_a_existing',
    );
    expect(stored?.project_id).toBe('project_a');

    const leakedAudit = await first<{ count: number }>(
      "SELECT COUNT(*) AS count FROM audit_log WHERE user_id = 'admin_a' AND details LIKE '%project_b%'",
    );
    expect(leakedAudit?.count).toBe(0);
  });

  it('moves the projection between same-scope projects when project_id changes', async () => {
    await run(`
      INSERT INTO projects (
        id, tenant_id, company_id, name, currency, status, created_by, created_at, updated_at
      ) VALUES (
        'project_a2', 'tenant_a', 'company_a1', 'Project A2', 'USD', 'assessment',
        'admin_a', '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z'
      )
    `);

    const beforeSource = await apiRequest('GET', '/api/projects/project_a', {
      token: seeded.tokens.adminA,
    });
    const beforeDestination = await apiRequest('GET', '/api/projects/project_a2', {
      token: seeded.tokens.adminA,
    });
    expect(beforeSource.response.status).toBe(200);
    expect(beforeSource.json?.transactionProjection.transactionSummary.transactionCount).toBe(1);
    expect(beforeDestination.response.status).toBe(200);
    expect(beforeDestination.json?.transactionProjection.transactionSummary.transactionCount).toBe(0);

    const updated = await apiRequest('PUT', '/api/transactions/tx_a_existing', {
      token: seeded.tokens.adminA,
      body: { project_id: 'project_a2' },
    });
    expect(updated.response.status).toBe(200);

    const afterSource = await apiRequest('GET', '/api/projects/project_a', {
      token: seeded.tokens.adminA,
    });
    const afterDestination = await apiRequest('GET', '/api/projects/project_a2', {
      token: seeded.tokens.adminA,
    });
    expect(afterSource.response.status).toBe(200);
    expect(afterSource.json?.transactionProjection.transactionSummary.transactionCount).toBe(0);
    expect(afterDestination.response.status).toBe(200);
    expect(afterDestination.json?.transactionProjection.transactionSummary.transactionCount).toBe(1);
    expect(afterDestination.json?.transactionProjection.projectedEquipment).toEqual([
      expect.objectContaining({
        projectId: 'project_a2',
        transactionIds: ['tx_a_existing'],
      }),
    ]);

    const stored = await first<{ project_id: string | null }>(
      'SELECT project_id FROM transactions WHERE id = ?',
      'tx_a_existing',
    );
    expect(stored?.project_id).toBe('project_a2');

    const projectRows = await first<{ equipment_count: number; financial_count: number }>(`
      SELECT
        (SELECT COUNT(*) FROM project_equipment WHERE project_id IN ('project_a', 'project_a2')) AS equipment_count,
        (SELECT COUNT(*) FROM project_financials WHERE project_id IN ('project_a', 'project_a2')) AS financial_count
    `);
    expect(projectRows).toEqual({ equipment_count: 0, financial_count: 0 });
  });

  it('returns matched projection metadata and reconciled KPIs without double counting manual mirrors', async () => {
    await run(`
      INSERT INTO project_equipment (
        id, project_id, tenant_id, company_id, part_id, item_name, quantity,
        condition, current_stage, estimated_reuse_value, co2_avoided_kg
      ) VALUES (
        'matched_equipment_a', 'project_a', 'tenant_a', 'company_a1', 'part_a_router',
        'Router A mirror', 2, 'Good', 'acquisition', 200, 0
      )
    `);
    await run(`
      INSERT INTO project_financials (
        id, project_id, tenant_id, company_id, type, category, amount, currency,
        stage, incurred_at, created_at
      ) VALUES (
        'matched_financial_a', 'project_a', 'tenant_a', 'company_a1', 'cost',
        'Transaction purchase', 200, 'USD', 'acquisition', '2026-02-01',
        '2026-02-01T00:00:00.000Z'
      )
    `);

    const result = await apiRequest('GET', '/api/projects/project_a', {
      token: seeded.tokens.adminA,
    });

    expect(result.response.status).toBe(200);
    expect(result.json?.transactionProjection.matchedEquipmentProjectionIds).toHaveLength(1);
    expect(result.json?.transactionProjection.matchedFinancialTransactionIds).toEqual(['tx_a_existing']);
    expect(result.json?.kpis).toEqual({
      equipment_count: 2,
      co2_avoided_kg: 0,
      reuse_value: 0,
      revenue_credits: 0,
      costs: 200,
      net_financial: -200,
    });
  });

  it('lists transaction-projected quantities without double counting legacy equipment mirrors', async () => {
    await run(`
      INSERT INTO project_equipment (
        id, project_id, tenant_id, company_id, part_id, item_name, quantity,
        condition, current_stage, estimated_reuse_value, co2_avoided_kg
      ) VALUES (
        'list_mirror_a', 'project_a', 'tenant_a', 'company_a1', 'part_a_router',
        'Router A legacy mirror', 2, 'Good', 'acquisition', 200, 0
      )
    `);

    const list = await apiRequest('GET', '/api/projects', {
      token: seeded.tokens.adminA,
    });

    expect(list.response.status).toBe(200);
    expect(list.json?.projects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'project_a',
        equipment_count: 2,
      }),
    ]));
  });
  it('filters transaction deep links by id without bypassing tenant scope', async () => {
    const own = await apiRequest('GET', '/api/transactions?transaction_id=tx_a_existing', {
      token: seeded.tokens.adminA,
    });
    expect(own.response.status).toBe(200);
    expect(own.json?.transactions).toEqual([
      expect.objectContaining({ id: 'tx_a_existing', projectId: 'project_a' }),
    ]);
    expect(own.json?.total).toBe(1);

    const crossScope = await apiRequest('GET', '/api/transactions?transaction_id=tx_b_existing', {
      token: seeded.tokens.adminA,
    });
    expect(crossScope.response.status).toBe(200);
    expect(crossScope.json?.transactions).toEqual([]);
    expect(crossScope.json?.total).toBe(0);
    expect(JSON.stringify(crossScope.json)).not.toContain('project_b');
  });
});