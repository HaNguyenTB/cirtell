import { beforeEach, describe, expect, it } from 'vitest';
import {
  apiRequest,
  first,
  resetAndSeedBackend,
  run,
  testEnv,
  type SeededBackend,
} from './helpers';
import { createAppSessionToken } from '../src/services/auth/sessionCookie';

let seeded: SeededBackend;

beforeEach(async () => {
  seeded = await resetAndSeedBackend();
});

const PO_LIMIT_BYTES = 10 * 1024 * 1024;

function poForm(
  bytes: Uint8Array,
  fileName = 'route-po.pdf',
  contentType = 'application/pdf',
): FormData {
  const form = new FormData();
  form.set('file', new File([bytes], fileName, { type: contentType }));
  return form;
}

describe('backend route integration coverage', () => {
  it('authenticates an active app session and returns user role and scope', async () => {
    const result = await apiRequest('GET', '/api/auth/me', { token: seeded.tokens.userA });

    expect(result.response.status).toBe(200);
    expect(result.json?.user).toMatchObject({
      id: 'user_a',
      email: 'user.a@example.com',
      role: 'User',
      tenant_id: 'tenant_a',
      company_id: 'company_a1',
    });
    expect(result.json?.company_ids).toContain('company_a1');
  });

  it('rejects missing and invalid authentication on protected APIs', async () => {
    const missing = await apiRequest('GET', '/api/parts', { token: null });
    expect(missing.response.status).toBe(401);
    expect(missing.json?.parts).toBeUndefined();

    const invalid = await apiRequest('GET', '/api/parts', { token: 'not-a-valid-jwt' });
    expect(invalid.response.status).toBe(401);
    expect(invalid.json?.parts).toBeUndefined();
  });

  it('prevents a Viewer from creating a part', async () => {
    const created = await apiRequest('POST', '/api/parts', {
      token: seeded.tokens.viewerA,
      body: {
        part_number: 'VIEWER-DENIED-001',
        model_name: 'Viewer Forbidden Part',
        category: 'Network Equipment',
      },
    });

    expect(created.response.status).toBe(403);
    const row = await first<{ count: number }>(
      'SELECT COUNT(*) AS count FROM parts WHERE part_number = ?',
      'VIEWER-DENIED-001',
    );
    expect(row?.count).toBe(0);
  });

  it('lets an Admin create a scoped part with a new vendor and audit entry', async () => {
    const created = await apiRequest('POST', '/api/parts', {
      token: seeded.tokens.adminA,
      body: {
        part_number: 'RRU-ADMIN-001',
        model_name: 'Route Level RRU',
        vendor: 'Route Vendor A',
        category: 'Radio',
        emission_factor_kg: 12.5,
      },
    });

    expect(created.response.status).toBe(201);
    expect(created.json?.success).toBe(true);

    const part = await first<{
      id: string;
      tenant_id: string;
      company_id: string;
      vendor_name: string;
      vendor_tenant_id: string;
      vendor_company_id: string;
    }>(`
      SELECT
        p.id,
        p.tenant_id,
        p.company_id,
        v.vendor_name,
        v.tenant_id AS vendor_tenant_id,
        v.company_id AS vendor_company_id
      FROM parts p
      JOIN vendors v ON v.id = p.vendor_id
      WHERE p.part_number = ?
    `, 'RRU-ADMIN-001');
    expect(part).toMatchObject({
      tenant_id: 'tenant_a',
      company_id: 'company_a1',
      vendor_name: 'Route Vendor A',
      vendor_tenant_id: 'tenant_a',
      vendor_company_id: 'company_a1',
    });

    const audit = await first<{ action: string; resource_id: string | null }>(
      "SELECT action, resource_id FROM audit_log WHERE action = 'CREATE_PART' AND resource_id = ?",
      part?.id,
    );
    expect(audit).toEqual({ action: 'CREATE_PART', resource_id: part?.id });
  });

  it('rejects duplicate part numbers in the same tenant and company scope', async () => {
    await run(`
      INSERT INTO parts (
        id, tenant_id, company_id, part_number, model_name, vendor_id, category,
        created_at, updated_at
      ) VALUES (
        'part_a_rru_001', 'tenant_a', 'company_a1', 'RRU-001',
        'Existing RRU', 'vendor_a', 'Radio',
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
      )
    `);

    const duplicate = await apiRequest('POST', '/api/parts', {
      token: seeded.tokens.adminA,
      body: {
        part_number: 'rru-001',
        model_name: 'Duplicate RRU',
        category: 'Radio',
      },
    });

    expect(duplicate.response.status).toBe(409);
    expect(duplicate.json?.code).toBe('DUPLICATE_PART_NUMBER');
  });

  it('calculates manual carbon entries and writes audit data', async () => {
    const created = await apiRequest('POST', '/api/ghg/entries', {
      token: seeded.tokens.userA,
      body: {
        scope: 1,
        source_description: 'Route manual carbon calculation',
        activity_data: 10,
        activity_unit: 'kWh',
        emission_factor: 2.5,
        emission_factor_unit: 'kgCO2e/kWh',
        reporting_period_start: '2026-05-01',
        reporting_period_end: '2026-05-31',
      },
    });

    expect(created.response.status).toBe(201);
    expect(created.json?.data.co2e_kg).toBe(25);

    const entry = await first<{ co2e_kg: number; source_type: string; tenant_id: string; company_id: string }>(`
      SELECT co2e_kg, source_type, tenant_id, company_id
      FROM ghg_emission_entries
      WHERE id = ?
    `, created.json?.data.id);
    expect(entry).toEqual({
      co2e_kg: 25,
      source_type: 'manual',
      tenant_id: 'tenant_a',
      company_id: 'company_a1',
    });

    const audit = await first<{ action: string; company_id: string | null }>(`
      SELECT action, company_id
      FROM audit_log
      WHERE action = 'CREATE_GHG_ENTRY' AND resource_id = ?
    `, created.json?.data.id);
    expect(audit).toEqual({ action: 'CREATE_GHG_ENTRY', company_id: 'company_a1' });
  });

  it('rejects invalid carbon input without inserting a row', async () => {
    const invalid = await apiRequest('POST', '/api/ghg/entries', {
      token: seeded.tokens.userA,
      body: {
        scope: 4,
        source_description: 'Invalid route carbon entry',
        activity_data: 10,
        activity_unit: 'kWh',
        emission_factor: 2.5,
        reporting_period_start: '2026-05-01',
        reporting_period_end: '2026-05-31',
      },
    });

    expect(invalid.response.status).toBe(400);
    const row = await first<{ count: number }>(
      'SELECT COUNT(*) AS count FROM ghg_emission_entries WHERE source_description = ?',
      'Invalid route carbon entry',
    );
    expect(row?.count).toBe(0);
  });

  it('returns zero dashboard KPIs for an empty scoped company', async () => {
    await run(
      "INSERT INTO tenants (id, name, domain, is_active) VALUES (?, ?, ?, ?)",
      'tenant_empty',
      'Tenant Empty',
      'empty.cirtell.test',
      1,
    );
    await run(
      'INSERT INTO companies (id, tenant_id, code, name) VALUES (?, ?, ?, ?)',
      'company_empty',
      'tenant_empty',
      'EMPTY',
      'Empty Company',
    );
    await run(`
      INSERT INTO users (
        id, email, name, role, status, tenant_id, company_id, is_super_admin, session_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      'user_empty',
      'empty.user@example.com',
      'Empty User',
      'Viewer',
      'active',
      'tenant_empty',
      'company_empty',
      0,
      0,
    );
    await run(`
      INSERT INTO user_company_assignments (id, user_id, tenant_id, company_id, role)
      VALUES (?, ?, ?, ?, ?)
    `, 'assign_user_empty', 'user_empty', 'tenant_empty', 'company_empty', 'Viewer');

    const token = await createAppSessionToken(testEnv, {
      userId: 'user_empty',
      email: 'empty.user@example.com',
      name: 'Empty User',
      sessionVersion: 0,
    });
    const dashboard = await apiRequest('GET', '/api/overview/headline', { token });

    expect(dashboard.response.status).toBe(200);
    expect(dashboard.json?.data).toMatchObject({
      total_transactions: 0,
      total_value_usd: 0,
      total_units: 0,
      reuse_rate: 0,
      total_co2e_kg: 0,
      actual_co2e_kg: 0,
      avoided_co2e_kg: 0,
      net_co2e_kg: 0,
      avoided_redeploy_co2e_kg: 0,
      avoided_recycle_co2e_kg: 0,
      scope1_kg: 0,
      scope2_kg: 0,
      scope3_kg: 0,
      total_parts: 0,
    });
  });

  it('uploads a purchase order file within scope and replaces the existing PO row', async () => {
    const bytes = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]);

    const upload = await apiRequest('POST', '/api/transactions/tx_a_existing/po-upload', {
      token: seeded.tokens.adminA,
      body: poForm(bytes),
    });

    expect(upload.response.status).toBe(200);
    expect(upload.json?.success).toBe(true);
    expect(upload.json?.data).toMatchObject({
      transactionId: 'tx_a_existing',
      fileName: 'route-po.pdf',
      contentType: 'application/pdf',
      sizeBytes: bytes.byteLength,
      replaced: true,
    });

    const stored = await first<{
      file_name: string;
      content_type: string;
      file_hex: string;
      po_file_name: string;
      po_file_key: string;
      row_count: number;
    }>(`
      SELECT
        pf.file_name,
        pf.content_type,
        hex(pf.file_data) AS file_hex,
        t.po_file_name,
        t.po_file_key,
        (SELECT COUNT(*) FROM transaction_po_files WHERE transaction_id = ?) AS row_count
      FROM transaction_po_files pf
      JOIN transactions t ON t.id = pf.transaction_id
      WHERE pf.transaction_id = ?
    `, 'tx_a_existing', 'tx_a_existing');
    expect(stored).toEqual({
      file_name: 'route-po.pdf',
      content_type: 'application/pdf',
      file_hex: '255044462D312E37',
      po_file_name: 'route-po.pdf',
      po_file_key: 'd1:tx_a_existing',
      row_count: 1,
    });

    const audit = await first<{ action: string; resource_id: string; company_id: string | null; details: string }>(`
      SELECT action, resource_id, company_id, details
      FROM audit_log
      WHERE action = 'UPLOAD_TRANSACTION_PO' AND resource_id = ?
    `, 'tx_a_existing');
    expect(audit).toMatchObject({
      action: 'UPLOAD_TRANSACTION_PO',
      resource_id: 'tx_a_existing',
      company_id: 'company_a1',
    });
    expect(JSON.parse(audit?.details || '{}')).toMatchObject({
      fileName: 'route-po.pdf',
      contentType: 'application/pdf',
      sizeBytes: bytes.byteLength,
      replacedExistingFile: true,
    });
  });

  it('downloads a purchase order file within scope with binary headers and bytes', async () => {
    const download = await apiRequest('GET', '/api/transactions/tx_a_existing/po-download', {
      token: seeded.tokens.viewerA,
    });

    expect(download.response.status).toBe(200);
    expect(download.response.headers.get('Content-Type')).toBe('application/pdf');
    expect(download.response.headers.get('Content-Disposition')).toContain('po-a.pdf');
    expect(download.response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(download.response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(Array.from(new Uint8Array(await download.response.arrayBuffer()))).toEqual([80, 79, 45, 65]);
  });

  it('allows a Viewer to download a PO but rejects Viewer PO upload', async () => {
    const denied = await apiRequest('POST', '/api/transactions/tx_a_existing/po-upload', {
      token: seeded.tokens.viewerA,
      body: poForm(new Uint8Array([1, 2, 3])),
    });
    expect(denied.response.status).toBe(403);

    const download = await apiRequest('GET', '/api/transactions/tx_a_existing/po-download', {
      token: seeded.tokens.viewerA,
    });
    expect(download.response.status).toBe(200);
    expect(Array.from(new Uint8Array(await download.response.arrayBuffer()))).toEqual([80, 79, 45, 65]);

    const stored = await first<{ file_name: string; file_hex: string }>(`
      SELECT file_name, hex(file_data) AS file_hex
      FROM transaction_po_files
      WHERE transaction_id = ?
    `, 'tx_a_existing');
    expect(stored).toEqual({ file_name: 'po-a.pdf', file_hex: '504F2D41' });
  });

  it('blocks PO upload and download for transactions outside the active scope', async () => {
    const before = await first<{ file_name: string; file_hex: string }>(`
      SELECT file_name, hex(file_data) AS file_hex
      FROM transaction_po_files
      WHERE transaction_id = ?
    `, 'tx_b_existing');

    const upload = await apiRequest('POST', '/api/transactions/tx_b_existing/po-upload', {
      token: seeded.tokens.adminA,
      body: poForm(new Uint8Array([9, 9, 9]), 'cross-scope.pdf'),
    });
    expect(upload.response.status).toBe(404);
    expect(upload.json?.code).toBe('TRANSACTION_NOT_FOUND');

    const download = await apiRequest('GET', '/api/transactions/tx_b_existing/po-download', {
      token: seeded.tokens.adminA,
    });
    expect(download.response.status).toBe(404);
    expect(download.json?.code).toBe('TRANSACTION_NOT_FOUND');
    expect(JSON.stringify(download.json)).not.toContain('po-b.pdf');

    const after = await first<{ file_name: string; file_hex: string }>(`
      SELECT file_name, hex(file_data) AS file_hex
      FROM transaction_po_files
      WHERE transaction_id = ?
    `, 'tx_b_existing');
    expect(after).toEqual(before);

    const audit = await first<{ count: number }>(`
      SELECT COUNT(*) AS count
      FROM audit_log
      WHERE user_id = 'admin_a'
        AND action = 'UPLOAD_TRANSACTION_PO'
        AND resource_id = 'tx_b_existing'
    `);
    expect(audit?.count).toBe(0);
  });

  it('returns PO_FILE_NOT_FOUND when a scoped transaction has no PO', async () => {
    await run('DELETE FROM transaction_po_files WHERE transaction_id = ?', 'tx_a_existing');
    await run(
      'UPDATE transactions SET po_file_key = NULL, po_file_name = NULL WHERE id = ?',
      'tx_a_existing',
    );

    const download = await apiRequest('GET', '/api/transactions/tx_a_existing/po-download', {
      token: seeded.tokens.viewerA,
    });

    expect(download.response.status).toBe(404);
    expect(download.json).toMatchObject({
      success: false,
      code: 'PO_FILE_NOT_FOUND',
      error: 'Purchase order file not found',
    });
  });

  it('rejects PO upload when the multipart file field is missing', async () => {
    const missing = await apiRequest('POST', '/api/transactions/tx_a_existing/po-upload', {
      token: seeded.tokens.adminA,
      body: new FormData(),
    });

    expect(missing.response.status).toBe(400);
    expect(missing.json).toMatchObject({
      success: false,
      code: 'PO_FILE_REQUIRED',
      error: 'Purchase order file is required',
    });
  });

  it('rejects empty PO files without updating the existing row', async () => {
    const empty = await apiRequest('POST', '/api/transactions/tx_a_existing/po-upload', {
      token: seeded.tokens.adminA,
      body: poForm(new Uint8Array(), 'empty.pdf'),
    });

    expect(empty.response.status).toBe(400);
    expect(empty.json).toMatchObject({
      success: false,
      code: 'PO_FILE_EMPTY',
      error: 'Purchase order file is empty',
    });

    const stored = await first<{ file_name: string; file_hex: string }>(`
      SELECT file_name, hex(file_data) AS file_hex
      FROM transaction_po_files
      WHERE transaction_id = ?
    `, 'tx_a_existing');
    expect(stored).toEqual({ file_name: 'po-a.pdf', file_hex: '504F2D41' });
  });

  it('rejects PO files over 10 MB with PO_FILE_TOO_LARGE', async () => {
    const tooLarge = await apiRequest('POST', '/api/transactions/tx_a_existing/po-upload', {
      token: seeded.tokens.adminA,
      body: poForm(new Uint8Array(PO_LIMIT_BYTES + 1), 'too-large.pdf'),
    });

    expect(tooLarge.response.status).toBe(413);
    expect(tooLarge.json).toMatchObject({
      success: false,
      code: 'PO_FILE_TOO_LARGE',
      error: 'Purchase order file exceeds the 10 MB limit',
    });
  });

  it('rejects disallowed PO MIME types', async () => {
    const invalid = await apiRequest('POST', '/api/transactions/tx_a_existing/po-upload', {
      token: seeded.tokens.adminA,
      body: poForm(new Uint8Array([1, 2, 3]), 'malware.exe', 'application/x-msdownload'),
    });

    expect(invalid.response.status).toBe(415);
    expect(invalid.json).toMatchObject({
      success: false,
      code: 'PO_FILE_TYPE_NOT_ALLOWED',
      error: 'Purchase order file type is not allowed',
    });
  });
});
