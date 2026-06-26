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
});

describe('tenant/company scoped catalog uniqueness', () => {
  it('allows the same part number in different companies and rejects case-insensitive duplicates in one company', async () => {
    const companyA = await apiRequest('POST', '/api/parts', {
      token: seeded.tokens.userA,
      body: {
        part_number: 'RRU-001',
        model_name: 'Radio Unit A',
        vendor: 'Ericsson',
        category: 'Radio',
      },
    });
    expect(companyA.response.status).toBe(201);

    const companyB = await apiRequest('POST', '/api/parts', {
      token: seeded.tokens.userB,
      body: {
        part_number: 'RRU-001',
        model_name: 'Radio Unit B',
        vendor: 'Ericsson',
        category: 'Radio',
      },
    });
    expect(companyB.response.status).toBe(201);

    const duplicateA = await apiRequest('POST', '/api/parts', {
      token: seeded.tokens.userA,
      body: {
        part_number: ' rru-001 ',
        model_name: 'Duplicate Radio Unit A',
      },
    });
    expect(duplicateA.response.status).toBe(409);
    expect(duplicateA.json?.code).toBe('DUPLICATE_PART_NUMBER');

    const scopedParts = await all<{ company_id: string; part_number: string }>(`
      SELECT company_id, part_number
      FROM parts
      WHERE LOWER(TRIM(part_number)) = 'rru-001'
      ORDER BY company_id
    `);
    expect(scopedParts).toEqual([
      { company_id: 'company_a1', part_number: 'RRU-001' },
      { company_id: 'company_b1', part_number: 'RRU-001' },
    ]);
  });

  it('scopes vendor names by company and enforces normalized vendor uniqueness', async () => {
    await apiRequest('POST', '/api/parts', {
      token: seeded.tokens.userA,
      body: {
        part_number: 'VENDOR-A-001',
        model_name: 'Vendor A Part',
        vendor: 'Ericsson',
      },
    });
    await apiRequest('POST', '/api/parts', {
      token: seeded.tokens.userB,
      body: {
        part_number: 'VENDOR-B-001',
        model_name: 'Vendor B Part',
        vendor: 'Ericsson',
      },
    });

    const vendors = await all<{ tenant_id: string; company_id: string; vendor_name: string }>(`
      SELECT tenant_id, company_id, vendor_name
      FROM vendors
      WHERE LOWER(TRIM(vendor_name)) = 'ericsson'
      ORDER BY company_id
    `);
    expect(vendors).toEqual([
      { tenant_id: 'tenant_a', company_id: 'company_a1', vendor_name: 'Ericsson' },
      { tenant_id: 'tenant_b', company_id: 'company_b1', vendor_name: 'Ericsson' },
    ]);

    await expect(run(`
      INSERT INTO vendors (id, tenant_id, company_id, vendor_name)
      VALUES ('vendor_a_duplicate_ericsson', 'tenant_a', 'company_a1', ' ERICSSON ')
    `)).rejects.toThrow();
  });

  it('allows the same warehouse code in different companies and rejects duplicates in one company', async () => {
    const warehouseA = await apiRequest('POST', '/api/warehouses', {
      token: seeded.tokens.userA,
      body: {
        name: 'Company A WH-01',
        code: 'WH-01',
        city: 'Hanoi',
        country: 'Vietnam',
      },
    });
    expect(warehouseA.response.status).toBe(201);

    const warehouseB = await apiRequest('POST', '/api/warehouses', {
      token: seeded.tokens.userB,
      body: {
        name: 'Company B WH-01',
        code: 'WH-01',
        city: 'Hanoi',
        country: 'Vietnam',
      },
    });
    expect(warehouseB.response.status).toBe(201);

    const duplicateA = await apiRequest('POST', '/api/warehouses', {
      token: seeded.tokens.userA,
      body: {
        name: 'Company A Duplicate WH-01',
        code: ' wh-01 ',
      },
    });
    expect(duplicateA.response.status).toBe(409);
    expect(duplicateA.json?.code).toBe('DUPLICATE_WAREHOUSE_CODE');
  });

  it('blocks parts from referencing a vendor outside their company scope', async () => {
    const crossScopeVendor = await apiRequest('POST', '/api/parts', {
      token: seeded.tokens.userA,
      body: {
        part_number: 'CROSS-VENDOR-001',
        model_name: 'Cross Vendor Part',
        vendor_id: 'vendor_b',
      },
    });

    expect(crossScopeVendor.response.status).toBe(400);
    expect(crossScopeVendor.json?.error).toBe('Vendor not found');

    const inserted = await first<{ id: string }>(
      'SELECT id FROM parts WHERE part_number = ?',
      'CROSS-VENDOR-001',
    );
    expect(inserted).toBeNull();
  });

  it('scopes market names by company and keeps transaction market creation in scope', async () => {
    const transactionA = await apiRequest('POST', '/api/transactions', {
      token: seeded.tokens.userA,
      body: {
        date: '2026-04-01',
        movement_type: 'Purchase',
        part_id: 'part_a_router',
        quantity: 1,
        destination_warehouse_id: 'wh_a_dest',
        market_name: 'Enterprise',
      },
    });
    expect(transactionA.response.status).toBe(201);

    const transactionB = await apiRequest('POST', '/api/transactions', {
      token: seeded.tokens.userB,
      body: {
        date: '2026-04-01',
        movement_type: 'Purchase',
        part_id: 'part_b_router',
        quantity: 1,
        destination_warehouse_id: 'wh_b_source',
        market_name: 'enterprise',
      },
    });
    expect(transactionB.response.status).toBe(201);

    const markets = await all<{ tenant_id: string; company_id: string; market_name: string }>(`
      SELECT tenant_id, company_id, market_name
      FROM markets
      WHERE LOWER(TRIM(market_name)) = 'enterprise'
      ORDER BY company_id
    `);
    expect(markets).toEqual([
      { tenant_id: 'tenant_a', company_id: 'company_a1', market_name: 'Enterprise' },
      { tenant_id: 'tenant_b', company_id: 'company_b1', market_name: 'enterprise' },
    ]);

    await expect(run(`
      INSERT INTO markets (id, tenant_id, company_id, market_name)
      VALUES ('market_a_duplicate_enterprise', 'tenant_a', 'company_a1', ' ENTERPRISE ')
    `)).rejects.toThrow();
  });
});
