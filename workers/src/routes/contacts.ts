import { Hono } from 'hono';
import type { Env } from '../index';
import { authMiddleware, logAudit, type User } from '../middleware/auth';
import { Permission, requirePermission } from '../middleware/permissions';
import { resolveTenantScope, scopedWhere, scopeInsertValues } from '../middleware/tenantScope';

type Variables = { user: User };
type ContactBody = Record<string, unknown>;

export const contactRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
contactRoutes.use('*', authMiddleware);

function text(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function field(body: ContactBody, snake: string, camel: string): unknown {
  return Object.prototype.hasOwnProperty.call(body, snake) ? body[snake] : body[camel];
}

function contactInput(body: ContactBody) {
  const companyName = text(field(body, 'company_name', 'companyName'));
  if (!companyName) throw new Error('COMPANY_NAME_REQUIRED');
  const email = text(body.email);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('INVALID_EMAIL');
  return {
    companyName,
    contactPersonName: text(field(body, 'contact_person_name', 'contactPersonName')),
    email,
    phone: text(body.phone),
    address: text(body.address),
    city: text(body.city),
    country: text(body.country),
    notes: text(body.notes),
  };
}

function inputError(error: unknown) {
  if (error instanceof Error && error.message === 'COMPANY_NAME_REQUIRED') return 'Company name is required';
  if (error instanceof Error && error.message === 'INVALID_EMAIL') return 'Email address is invalid';
  return null;
}

contactRoutes.get('/', requirePermission(Permission.VIEW_TRANSACTIONS), async (c) => {
  try {
    const scope = await resolveTenantScope(c);
    const where = scopedWhere(scope, 'tenant_id', 'company_id');
    const search = text(c.req.query('search'));
    const conditions = [where.clause];
    const params: Array<string | number | null> = [...where.params];
    if (search) {
      conditions.push('(company_name LIKE ? OR contact_person_name LIKE ? OR email LIKE ? OR phone LIKE ?)');
      const pattern = `%${search}%`;
      params.push(pattern, pattern, pattern, pattern);
    }
    const { results } = await c.env.DB.prepare(`
      SELECT id, company_name AS companyName, contact_person_name AS contactPersonName,
             email, phone, address, city, country, notes, tenant_id AS tenantId,
             company_id AS companyId, created_at AS createdAt, updated_at AS updatedAt
      FROM contacts WHERE ${conditions.join(' AND ')}
      ORDER BY company_name COLLATE NOCASE, contact_person_name COLLATE NOCASE
    `).bind(...params).all();
    return c.json({ success: true, contacts: results || [] });
  } catch (error) {
    console.error('GET /contacts error:', error);
    return c.json({ success: false, error: 'Failed to fetch contacts' }, 500);
  }
});

contactRoutes.post('/', requirePermission(Permission.EDIT_TRANSACTIONS), async (c) => {
  try {
    const user = c.get('user');
    const scope = await resolveTenantScope(c);
    const ownership = scopeInsertValues(scope, user);
    if (!ownership.tenantId || !ownership.companyId) {
      return c.json({ success: false, error: 'Select a company before creating a contact' }, 400);
    }
    const input = contactInput(await c.req.json<ContactBody>());
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await c.env.DB.prepare(`
      INSERT INTO contacts (
        id, company_name, contact_person_name, email, phone, address, city, country,
        notes, tenant_id, company_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, input.companyName, input.contactPersonName, input.email, input.phone,
      input.address, input.city, input.country, input.notes,
      ownership.tenantId, ownership.companyId, now, now,
    ).run();
    await logAudit(c.env.DB, user.id, 'CREATE_CONTACT', 'contacts', id, undefined, ownership.tenantId, ownership.companyId);
    return c.json({ success: true, id }, 201);
  } catch (error) {
    const message = inputError(error);
    if (message) return c.json({ success: false, error: message }, 400);
    console.error('POST /contacts error:', error);
    return c.json({ success: false, error: 'Failed to create contact' }, 500);
  }
});

contactRoutes.put('/:id', requirePermission(Permission.EDIT_TRANSACTIONS), async (c) => {
  try {
    const user = c.get('user');
    const scope = await resolveTenantScope(c);
    const where = scopedWhere(scope, 'tenant_id', 'company_id');
    const id = c.req.param('id')!;
    const existing = await c.env.DB.prepare(`SELECT id, tenant_id, company_id FROM contacts WHERE id = ? AND ${where.clause}`)
      .bind(id, ...where.params).first<{ id: string; tenant_id: string; company_id: string }>();
    if (!existing) return c.json({ success: false, error: 'Contact not found' }, 404);
    const input = contactInput(await c.req.json<ContactBody>());
    await c.env.DB.prepare(`
      UPDATE contacts SET company_name = ?, contact_person_name = ?, email = ?, phone = ?,
        address = ?, city = ?, country = ?, notes = ?, updated_at = ?
      WHERE id = ? AND ${where.clause}
    `).bind(
      input.companyName, input.contactPersonName, input.email, input.phone,
      input.address, input.city, input.country, input.notes, new Date().toISOString(),
      id, ...where.params,
    ).run();
    await logAudit(c.env.DB, user.id, 'UPDATE_CONTACT', 'contacts', id, undefined, existing.tenant_id, existing.company_id);
    return c.json({ success: true });
  } catch (error) {
    const message = inputError(error);
    if (message) return c.json({ success: false, error: message }, 400);
    console.error('PUT /contacts/:id error:', error);
    return c.json({ success: false, error: 'Failed to update contact' }, 500);
  }
});

contactRoutes.delete('/:id', requirePermission(Permission.EDIT_TRANSACTIONS), async (c) => {
  try {
    const user = c.get('user');
    const scope = await resolveTenantScope(c);
    const where = scopedWhere(scope, 'tenant_id', 'company_id');
    const id = c.req.param('id')!;
    const existing = await c.env.DB.prepare(`SELECT id, tenant_id, company_id FROM contacts WHERE id = ? AND ${where.clause}`)
      .bind(id, ...where.params).first<{ id: string; tenant_id: string; company_id: string }>();
    if (!existing) return c.json({ success: false, error: 'Contact not found' }, 404);
    const usage = await c.env.DB.prepare(
      'SELECT COUNT(*) AS count FROM transactions WHERE contact_id = ? AND tenant_id = ? AND company_id = ?',
    ).bind(id, existing.tenant_id, existing.company_id).first<{ count: number }>();
    if (Number(usage?.count || 0) > 0) {
      return c.json({ success: false, error: 'Contact is used by existing transactions and cannot be deleted' }, 409);
    }
    await c.env.DB.prepare(`DELETE FROM contacts WHERE id = ? AND ${where.clause}`).bind(id, ...where.params).run();
    await logAudit(c.env.DB, user.id, 'DELETE_CONTACT', 'contacts', id, undefined, existing.tenant_id, existing.company_id);
    return c.json({ success: true });
  } catch (error) {
    console.error('DELETE /contacts/:id error:', error);
    return c.json({ success: false, error: 'Failed to delete contact' }, 500);
  }
});
