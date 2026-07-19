import { env } from 'cloudflare:workers';
import { applyD1Migrations, reset, type D1Migration } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src';
import { buildProjectTransactionProjection } from '../src/services/projectTransactionProjection';

type TestEnv = Env & { TEST_MIGRATIONS: D1Migration[] };
const testEnv = env as unknown as TestEnv;

async function run(sql: string, ...params: unknown[]) {
  return testEnv.DB.prepare(sql).bind(...params).run();
}

async function seedScope() {
  await run(`
    INSERT INTO tenants (id, name, domain, is_active)
    VALUES
      ('projection_tenant', 'Projection Tenant', 'projection.test', 1),
      ('projection_other_tenant', 'Other Tenant', 'projection-other.test', 1)
  `);
  await run(`
    INSERT INTO companies (id, tenant_id, code, name)
    VALUES
      ('projection_company', 'projection_tenant', 'PROJ', 'Projection Company'),
      ('projection_other_company', 'projection_other_tenant', 'OTHER', 'Other Company')
  `);
  await run(`
    INSERT INTO vendors (id, tenant_id, company_id, vendor_name)
    VALUES ('projection_vendor', 'projection_tenant', 'projection_company', 'Projection Vendor')
  `);
  await run(`
    INSERT INTO parts (
      id, tenant_id, company_id, part_number, model_name, vendor_id, category,
      weight_kg, emission_factor_kg, created_at, updated_at
    ) VALUES
      ('projection_part', 'projection_tenant', 'projection_company', 'PROJ-100',
       'Projection Radio', 'projection_vendor', 'Radio', 8, 20,
       '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      ('projection_part_no_factor', 'projection_tenant', 'projection_company', 'PROJ-200',
       'No Factor Radio', 'projection_vendor', 'Radio', 9, NULL,
       '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
  `);
  await run(`
    INSERT INTO projects (
      id, tenant_id, company_id, name, currency, status, created_at, updated_at
    ) VALUES (
      'projection_project', 'projection_tenant', 'projection_company',
      'Projection Project', 'USD', 'in-progress',
      '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
    )
  `);
}

describe('project transaction projection service', () => {
  beforeEach(async () => {
    await reset();
    await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
    await seedScope();
  });

  it('uses active line items instead of the transaction header', async () => {
    await run(`
      INSERT INTO transactions (
        id, tenant_id, company_id, date, movement_type, quantity, unit_price_usd,
        part_id, condition, project_id, inventory_sync_status
      ) VALUES (
        'projection_tx', 'projection_tenant', 'projection_company', '2026-06-01',
        'Redeploy', 99, 999, 'projection_part_no_factor', 'Poor',
        'projection_project', 'synced'
      )
    `);
    await run(`
      INSERT INTO transaction_items (
        id, transaction_id, tenant_id, company_id, part_id, serial_number,
        condition, quantity, unit_price_usd
      ) VALUES (
        'projection_item', 'projection_tx', 'projection_tenant', 'projection_company',
        'projection_part', 'SER-100', 'Good', 2, 100
      ), (
        'projection_item_old', 'projection_tx', 'projection_tenant', 'projection_company',
        'projection_part', 'SER-OLD', 'Good', 50, 100
      )
    `);
    await run(`
      UPDATE transaction_items
      SET superseded_at = '2026-06-02T00:00:00.000Z'
      WHERE id = 'projection_item_old'
    `);

    const projection = await buildProjectTransactionProjection({
      db: testEnv.DB,
      projectId: 'projection_project',
      scope: { tenantId: 'projection_tenant', companyId: 'projection_company' },
    });

    expect(projection.transactionSummary).toMatchObject({
      transactionCount: 1,
      lineCount: 1,
      totalTransactionValue: 200,
      redeploymentCredit: 200,
      projectedCo2AvoidedKg: 40,
    });
    expect(projection.projectedEquipment).toHaveLength(1);
    expect(projection.projectedEquipment[0]).toMatchObject({
      partId: 'projection_part',
      serialNumber: 'SER-100',
      quantity: 2,
      currentStage: 'redeployment',
      co2AvoidedKg: 40,
    });
    expect(projection.reconciliationWarnings).toEqual([]);
  });

  it('uses header fallback while excluding voided and cross-scope transactions', async () => {
    await run(`
      INSERT INTO transactions (
        id, tenant_id, company_id, date, movement_type, quantity, unit_price_usd,
        part_id, condition, project_id, inventory_sync_status, voided_at
      ) VALUES
        ('projection_purchase', 'projection_tenant', 'projection_company', '2026-06-01',
         'Purchase', 3, 25, 'projection_part', 'New', 'projection_project', 'synced', NULL),
        ('projection_voided', 'projection_tenant', 'projection_company', '2026-06-02',
         'Sale', 2, 40, 'projection_part', 'Good', 'projection_project', 'voided',
         '2026-06-03T00:00:00.000Z'),
        ('projection_cross_scope', 'projection_other_tenant', 'projection_other_company', '2026-06-04',
         'Sale', 7, 50, NULL, 'Good', 'projection_project', 'synced', NULL)
    `);

    const projection = await buildProjectTransactionProjection({
      db: testEnv.DB,
      projectId: 'projection_project',
      scope: { tenantId: 'projection_tenant', companyId: 'projection_company' },
    });

    expect(projection.projectedFinancials).toHaveLength(1);
    expect(projection.projectedFinancials[0]).toMatchObject({
      movementType: 'Purchase',
      type: 'cost',
      amount: 75,
    });
    expect(projection.transactionSummary).toMatchObject({
      transactionCount: 1,
      purchaseCost: 75,
      salesRevenue: 0,
    });
  });

  it('returns a warning and null avoided emissions when the part has no factor', async () => {
    await run(`
      INSERT INTO transactions (
        id, tenant_id, company_id, date, movement_type, quantity, unit_price_usd,
        part_id, condition, project_id, inventory_sync_status
      ) VALUES (
        'projection_recycle', 'projection_tenant', 'projection_company', '2026-06-05',
        'Recycle', 4, 10, 'projection_part_no_factor', 'Scrap',
        'projection_project', 'not_ready'
      )
    `);

    const projection = await buildProjectTransactionProjection({
      db: testEnv.DB,
      projectId: 'projection_project',
      scope: { tenantId: 'projection_tenant', companyId: 'projection_company' },
    });

    expect(projection.projectedEquipment[0].co2AvoidedKg).toBeNull();
    expect(projection.projectedEquipment[0].inventorySyncStatuses).toEqual(['not_ready']);
    expect(projection.reconciliationWarnings).toContainEqual(expect.objectContaining({
      code: 'MISSING_EMISSION_FACTOR',
      transactionId: 'projection_recycle',
      partId: 'projection_part_no_factor',
    }));
  });

  it('maps every movement type while keeping missing-part financials and split dispositions', async () => {
    await run(`
      INSERT INTO transactions (
        id, tenant_id, company_id, date, movement_type, quantity, unit_price_usd,
        part_id, condition, project_id, inventory_sync_status
      ) VALUES
        ('projection_matrix_purchase', 'projection_tenant', 'projection_company', '2026-06-10',
         'Purchase', 2, 10, 'projection_part', 'New', 'projection_project', 'synced'),
        ('projection_matrix_sale', 'projection_tenant', 'projection_company', '2026-06-11',
         'Sale', 1, 15, 'projection_part', 'Good', 'projection_project', 'synced'),
        ('projection_matrix_redeploy', 'projection_tenant', 'projection_company', '2026-06-12',
         'Redeploy', 3, 20, 'projection_part', 'Good', 'projection_project', 'not_ready'),
        ('projection_matrix_recycle', 'projection_tenant', 'projection_company', '2026-06-13',
         'Recycle', 4, 5, 'projection_part', 'Scrap', 'projection_project', 'synced'),
        ('projection_matrix_missing_part', 'projection_tenant', 'projection_company', '2026-06-14',
         'Sale', 2, 7, NULL, 'Good', 'projection_project', 'not_ready')
    `);

    const projection = await buildProjectTransactionProjection({
      db: testEnv.DB,
      projectId: 'projection_project',
      scope: { tenantId: 'projection_tenant', companyId: 'projection_company' },
    });

    expect(projection.projectedEquipment).toHaveLength(4);
    expect(projection.projectedEquipment).toEqual(expect.arrayContaining([
      expect.objectContaining({ currentStage: 'acquisition', quantity: 2, co2AvoidedKg: 0 }),
      expect.objectContaining({ currentStage: 'sold', quantity: 1, co2AvoidedKg: 0 }),
      expect.objectContaining({
        currentStage: 'redeployment',
        quantity: 3,
        co2AvoidedKg: 60,
        inventorySyncStatuses: ['not_ready'],
      }),
      expect.objectContaining({ currentStage: 'recycling', quantity: 4, co2AvoidedKg: 80 }),
    ]));
    expect(projection.projectedFinancials).toEqual(expect.arrayContaining([
      expect.objectContaining({ transactionId: 'projection_matrix_purchase', type: 'cost', amount: 20 }),
      expect.objectContaining({ transactionId: 'projection_matrix_sale', type: 'revenue', amount: 15 }),
      expect.objectContaining({ transactionId: 'projection_matrix_redeploy', type: 'credit', amount: 60 }),
      expect.objectContaining({ transactionId: 'projection_matrix_recycle', type: 'revenue', amount: 20 }),
      expect.objectContaining({ transactionId: 'projection_matrix_missing_part', type: 'revenue', amount: 14 }),
    ]));
    expect(projection.transactionSummary).toEqual({
      transactionCount: 5,
      lineCount: 5,
      totalTransactionValue: 129,
      purchaseCost: 20,
      salesRevenue: 29,
      redeploymentCredit: 60,
      recyclingRevenue: 20,
      projectedCo2AvoidedKg: 140,
    });
    expect(projection.reconciliationWarnings).toContainEqual(expect.objectContaining({
      code: 'MISSING_PART',
      transactionId: 'projection_matrix_missing_part',
    }));
    expect(projection.projectedEquipment.some((item) =>
      item.transactionIds.includes('projection_matrix_missing_part'))).toBe(false);
  });
});
