import { beforeEach, describe, expect, it } from 'vitest';
import { apiRequest, first, resetAndSeedBackend, type SeededBackend } from './helpers';

describe('contact and transaction buyer routes', () => {
  let seeded: SeededBackend;

  beforeEach(async () => {
    seeded = await resetAndSeedBackend();
  });

  it('creates and lists contacts only in the authenticated company scope', async () => {
    const created = await apiRequest('POST', '/api/contacts', {
      token: seeded.tokens.adminA,
      body: {
        companyName: 'Vietnam Circular Buyer',
        contactPersonName: 'Minh Pham',
        email: 'minh@example.com',
        phone: '+84 123 456 789',
      },
    });
    expect(created.response.status).toBe(201);

    const list = await apiRequest('GET', '/api/contacts?company_id=company_b1', {
      token: seeded.tokens.adminA,
    });
    expect(list.response.status).toBe(200);
    expect(list.json?.contacts).toEqual([
      expect.objectContaining({
        companyName: 'Vietnam Circular Buyer',
        contactPersonName: 'Minh Pham',
      }),
    ]);
    expect(await first<{ tenant_id: string; company_id: string }>(
      'SELECT tenant_id, company_id FROM contacts WHERE id = ?',
      created.json?.id,
    )).toEqual({ tenant_id: 'tenant_a', company_id: 'company_a1' });
  });

  it('allows viewers to read contacts but forbids contact writes', async () => {
    const read = await apiRequest('GET', '/api/contacts', { token: seeded.tokens.viewerA });
    expect(read.response.status).toBe(200);

    const write = await apiRequest('POST', '/api/contacts', {
      token: seeded.tokens.viewerA,
      body: { companyName: 'Forbidden Buyer' },
    });
    expect(write.response.status).toBe(403);
    expect(await first('SELECT id FROM contacts WHERE company_name = ?', 'Forbidden Buyer')).toBeNull();
  });

  it('stores a selected buyer for new transactions and can change buyer on an existing transaction', async () => {
    const firstContact = await apiRequest('POST', '/api/contacts', {
      token: seeded.tokens.adminA,
      body: { companyName: 'Buyer One', contactPersonName: 'An Nguyen' },
    });
    const secondContact = await apiRequest('POST', '/api/contacts', {
      token: seeded.tokens.adminA,
      body: { companyName: 'Buyer Two', contactPersonName: 'Binh Tran' },
    });

    const created = await apiRequest('POST', '/api/transactions', {
      token: seeded.tokens.userA,
      body: {
        date: '2026-07-19',
        movement_type: 'Purchase',
        part_id: 'part_a_radio',
        quantity: 2,
        unit_price_usd: 125,
        destination_warehouse_id: 'wh_a_dest',
        contact_id: firstContact.json?.id,
      },
    });
    expect(created.response.status).toBe(201);
    expect(await first<{ contact_id: string }>(
      'SELECT contact_id FROM transactions WHERE id = ?',
      created.json?.id,
    )).toEqual({ contact_id: firstContact.json?.id });

    const updated = await apiRequest('PUT', '/api/transactions/tx_a_existing', {
      token: seeded.tokens.userA,
      body: { contact_id: secondContact.json?.id },
    });
    expect(updated.response.status).toBe(200);
    expect(await first<{ contact_id: string }>(
      'SELECT contact_id FROM transactions WHERE id = ?',
      'tx_a_existing',
    )).toEqual({ contact_id: secondContact.json?.id });

    const detail = await apiRequest('GET', '/api/transactions/tx_a_existing', {
      token: seeded.tokens.userA,
    });
    expect(detail.response.status).toBe(200);
    expect(detail.json?.transaction).toEqual(expect.objectContaining({
      contactId: secondContact.json?.id,
      contactCompanyName: 'Buyer Two',
      contactPersonName: 'Binh Tran',
    }));
  });
});
