import { env } from 'cloudflare:workers';
import { applyD1Migrations, reset, SELF, type D1Migration } from 'cloudflare:test';
import type { Env } from '../src';
import { createAppSessionToken } from '../src/services/auth/sessionCookie';

export type JsonMap = Record<string, any>;
export type TestEnv = Env & { TEST_MIGRATIONS: D1Migration[] };

export interface SeededBackend {
  tokens: {
    userA: string;
    viewerA: string;
    adminA: string;
    userB: string;
    adminB: string;
    superAdmin: string;
  };
}

export const testEnv = env as unknown as TestEnv;

export async function run(sql: string, ...params: unknown[]) {
  return testEnv.DB.prepare(sql).bind(...params).run();
}

export async function first<T = JsonMap>(sql: string, ...params: unknown[]): Promise<T | null> {
  return testEnv.DB.prepare(sql).bind(...params).first<T>();
}

export async function all<T = JsonMap>(sql: string, ...params: unknown[]): Promise<T[]> {
  const { results } = await testEnv.DB.prepare(sql).bind(...params).all<T>();
  return results || [];
}

export async function apiRequest(
  method: string,
  path: string,
  options: {
    token?: string | null;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
) {
  const headers = new Headers(options.headers || {});
  headers.set('CF-Connecting-IP', headers.get('CF-Connecting-IP') || '127.0.0.42');

  if (options.token) headers.set('Authorization', `Bearer ${options.token}`);

  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    if (options.body instanceof FormData) {
      body = options.body;
    } else {
      headers.set('Content-Type', headers.get('Content-Type') || 'application/json');
      body = JSON.stringify(options.body);
    }
  }

  const response = await SELF.fetch(`http://localhost${path}`, { method, headers, body });
  const contentType = response.headers.get('Content-Type') || '';
  const json = contentType.includes('application/json')
    ? await response.clone().json<JsonMap>().catch(() => ({}))
    : null;
  return { response, json };
}

async function tokenFor(userId: string, email: string, name: string) {
  return createAppSessionToken(testEnv, {
    userId,
    email,
    name,
    sessionVersion: 0,
  });
}

export async function resetAndSeedBackend(): Promise<SeededBackend> {
  await reset();
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);

  await run(`
    INSERT INTO tenants (id, name, domain, is_active)
    VALUES
      ('tenant_a', 'Tenant A', 'tenant-a.cirtell.test', 1),
      ('tenant_b', 'Tenant B', 'tenant-b.cirtell.test', 1)
  `);
  await run(`
    INSERT INTO companies (id, tenant_id, code, name)
    VALUES
      ('company_a1', 'tenant_a', 'A1', 'Company A1'),
      ('company_b1', 'tenant_b', 'B1', 'Company B1')
  `);
  await run(`
    INSERT INTO users (
      id, email, name, role, status, tenant_id, company_id, is_super_admin, session_version
    ) VALUES
      ('user_a', 'user.a@example.com', 'User A', 'User', 'active', 'tenant_a', 'company_a1', 0, 0),
      ('viewer_a', 'viewer.a@example.com', 'Viewer A', 'Viewer', 'active', 'tenant_a', 'company_a1', 0, 0),
      ('admin_a', 'admin.a@example.com', 'Admin A', 'Admin', 'active', 'tenant_a', 'company_a1', 0, 0),
      ('user_b', 'user.b@example.com', 'User B', 'User', 'active', 'tenant_b', 'company_b1', 0, 0),
      ('admin_b', 'admin.b@example.com', 'Admin B', 'Admin', 'active', 'tenant_b', 'company_b1', 0, 0),
      ('super_admin_test', 'superadmin.test@example.com', 'Super Admin Test', 'Admin', 'active', 'tenant_a', 'company_a1', 1, 0)
  `);
  await run(`
    INSERT INTO user_company_assignments (id, user_id, tenant_id, company_id, role)
    VALUES
      ('assign_user_a', 'user_a', 'tenant_a', 'company_a1', 'User'),
      ('assign_viewer_a', 'viewer_a', 'tenant_a', 'company_a1', 'Viewer'),
      ('assign_admin_a', 'admin_a', 'tenant_a', 'company_a1', 'Admin'),
      ('assign_user_b', 'user_b', 'tenant_b', 'company_b1', 'User'),
      ('assign_admin_b', 'admin_b', 'tenant_b', 'company_b1', 'Admin')
  `);

  await run(`
    INSERT INTO vendors (id, tenant_id, company_id, vendor_name)
    VALUES
      ('vendor_a', 'tenant_a', 'company_a1', 'Vendor A'),
      ('vendor_b', 'tenant_b', 'company_b1', 'Vendor B')
  `);
  await run(`
    INSERT INTO parts (
      id, tenant_id, company_id, part_number, model_name, vendor_id, category,
      weight_kg, emission_factor_kg, created_at, updated_at
    ) VALUES
      ('part_a_router', 'tenant_a', 'company_a1', 'RTR-A-100', 'Router A 100', 'vendor_a', 'Network Equipment', 10, 25, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      ('part_a_radio', 'tenant_a', 'company_a1', 'RAD-A-200', 'Radio A 200', 'vendor_a', 'Radio', 8, 20, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      ('part_a_shared', 'tenant_a', 'company_a1', 'SHARED-100', 'Shared A', 'vendor_a', 'Network Equipment', 3, 9, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      ('part_b_router', 'tenant_b', 'company_b1', 'RTR-B-100', 'Router B 100', 'vendor_b', 'Network Equipment', 10, 25, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      ('part_b_shared', 'tenant_b', 'company_b1', 'SHARED-100', 'Shared B', 'vendor_b', 'Network Equipment', 4, 10, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
  `);

  await run(`
    INSERT INTO warehouses (
      id, tenant_id, company_id, name, code, city, country, status, created_at, updated_at
    ) VALUES
      ('wh_a_source', 'tenant_a', 'company_a1', 'A Source Warehouse', 'A-SRC', 'Hanoi', 'Vietnam', 'active', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      ('wh_a_dest', 'tenant_a', 'company_a1', 'A Destination Warehouse', 'A-DST', 'Hanoi', 'Vietnam', 'active', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      ('wh_b_source', 'tenant_b', 'company_b1', 'B Source Warehouse', 'B-SRC', 'Hanoi', 'Vietnam', 'active', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
  `);
  await run(`
    INSERT INTO inventory (
      id, tenant_id, company_id, warehouse_id, zone_id, part_id, quantity, condition, updated_at
    ) VALUES
      ('inv_a_router', 'tenant_a', 'company_a1', 'wh_a_source', NULL, 'part_a_router', 10, 'Good', '2026-01-01T00:00:00.000Z'),
      ('inv_b_router', 'tenant_b', 'company_b1', 'wh_b_source', NULL, 'part_b_router', 50, 'Good', '2026-01-01T00:00:00.000Z')
  `);

  await run(`
    INSERT INTO telecom_vendors (id, tenant_id, company_id, name, category, region)
    VALUES
      ('telecom_vendor_a', 'tenant_a', 'company_a1', 'Telecom Vendor A', 'RAN', 'APAC'),
      ('telecom_vendor_b', 'tenant_b', 'company_b1', 'Telecom Vendor B', 'RAN', 'APAC')
  `);
  await run(`
    INSERT INTO telecom_technologies (id, tenant_id, company_id, name, generation, description)
    VALUES
      ('telecom_tech_a', 'tenant_a', 'company_a1', 'Private 5G A', '5G', 'Tenant A technology'),
      ('telecom_tech_b', 'tenant_b', 'company_b1', 'Private 5G B', '5G', 'Tenant B technology')
  `);
  await run(`
    INSERT INTO projects (id, tenant_id, company_id, name, source_warehouse_id, created_by, created_at, updated_at)
    VALUES
      ('project_a', 'tenant_a', 'company_a1', 'Project A', 'wh_a_source', 'user_a', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      ('project_b', 'tenant_b', 'company_b1', 'Project B', 'wh_b_source', 'user_b', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
  `);
  await run(`
    INSERT INTO project_vendors (project_id, vendor_id)
    VALUES
      ('project_a', 'telecom_vendor_a'),
      ('project_b', 'telecom_vendor_b')
  `);
  await run(`
    INSERT INTO project_technologies (project_id, technology_id)
    VALUES
      ('project_a', 'telecom_tech_a'),
      ('project_b', 'telecom_tech_b')
  `);
  await run(`
    INSERT INTO project_evidence (
      id, project_id, tenant_id, company_id, title, evidence_type, stage, file_url,
      file_name, file_size, content_type, uploaded_by, uploaded_at
    ) VALUES
      ('evidence_a', 'project_a', 'tenant_a', 'company_a1', 'Evidence A', 'document', 'assessment', 'https://example.test/a.pdf',
       'evidence-a.pdf', 128, 'application/pdf', 'user_a', '2026-01-02T00:00:00.000Z'),
      ('evidence_b', 'project_b', 'tenant_b', 'company_b1', 'Evidence B', 'document', 'assessment', 'https://example.test/b.pdf',
       'evidence-b.pdf', 256, 'application/pdf', 'user_b', '2026-01-02T00:00:00.000Z')
  `);
  await run(`
    INSERT INTO transactions (
      id, tenant_id, company_id, date, movement_type, quantity, unit_price_usd,
      part_id, destination_warehouse_id, project_id, po_file_key, po_file_name,
      created_by, created_at, updated_at, inventory_sync_status, inventory_sync_version
    ) VALUES
      ('tx_a_existing', 'tenant_a', 'company_a1', '2026-02-01', 'Purchase', 2, 100,
       'part_a_router', 'wh_a_source', 'project_a', 'tx_a_existing', 'po-a.pdf',
       'user_a', '2026-02-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z', 'not_ready', 0),
      ('tx_b_existing', 'tenant_b', 'company_b1', '2026-02-01', 'Purchase', 5, 200,
       'part_b_router', 'wh_b_source', 'project_b', 'tx_b_existing', 'po-b.pdf',
       'user_b', '2026-02-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z', 'not_ready', 0)
  `);
  await run(`
    INSERT INTO transaction_po_files (
      transaction_id, file_name, content_type, file_data, uploaded_by, uploaded_at
    ) VALUES
      ('tx_a_existing', 'po-a.pdf', 'application/pdf', ?, 'user_a', '2026-02-01T00:00:00.000Z'),
      ('tx_b_existing', 'po-b.pdf', 'application/pdf', ?, 'user_b', '2026-02-01T00:00:00.000Z')
  `, new Uint8Array([80, 79, 45, 65]).buffer, new Uint8Array([80, 79, 45, 66]).buffer);

  await run(`
    INSERT INTO ghg_emission_entries (
      id, tenant_id, company_id, created_by, scope, category_id, scope3_stream,
      source_description, activity_data, activity_unit, emission_factor,
      emission_factor_unit, co2e_kg, reporting_period_start, reporting_period_end
    ) VALUES
      ('ghg_a_scope1', 'tenant_a', 'company_a1', 'user_a', 1, NULL, NULL,
       'A diesel generator', 10, 'liter', 2.5, 'kgCO2e/liter', 25, '2026-01-01', '2026-01-31'),
      ('ghg_b_scope3', 'tenant_b', 'company_b1', 'user_b', 3, 1, 'upstream',
       'B purchased goods', 20, 'kg', 3, 'kgCO2e/kg', 60, '2026-01-01', '2026-01-31')
  `);
  await run(`
    INSERT INTO audit_log (id, user_id, action, resource_type, resource_id, tenant_id, company_id, created_at)
    VALUES
      ('audit_a', 'user_a', 'CREATE_PART', 'parts', 'part_a_router', 'tenant_a', 'company_a1', '2026-01-01T00:00:00.000Z'),
      ('audit_b', 'user_b', 'CREATE_PART', 'parts', 'part_b_router', 'tenant_b', 'company_b1', '2026-01-01T00:00:00.000Z')
  `);

  return {
    tokens: {
      userA: await tokenFor('user_a', 'user.a@example.com', 'User A'),
      viewerA: await tokenFor('viewer_a', 'viewer.a@example.com', 'Viewer A'),
      adminA: await tokenFor('admin_a', 'admin.a@example.com', 'Admin A'),
      userB: await tokenFor('user_b', 'user.b@example.com', 'User B'),
      adminB: await tokenFor('admin_b', 'admin.b@example.com', 'Admin B'),
      superAdmin: await tokenFor('super_admin_test', 'superadmin.test@example.com', 'Super Admin Test'),
    },
  };
}

export async function inventoryQty(warehouseId: string, partId: string, condition = 'Good') {
  const row = await first<{ quantity: number }>(`
    SELECT quantity
    FROM inventory
    WHERE warehouse_id = ? AND part_id = ? AND condition = ? AND zone_id IS NULL
  `, warehouseId, partId, condition);
  return row?.quantity || 0;
}
