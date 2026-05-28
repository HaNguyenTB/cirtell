import { Hono } from 'hono';
import type { Env } from '../index';
import { authMiddleware, logAudit, type User } from '../middleware/auth';
import { requirePermission, Permission } from '../middleware/permissions';

type Variables = { user: User };

export const adminRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

adminRoutes.use('*', authMiddleware);
adminRoutes.use('*', requirePermission(Permission.MANAGE_USERS));

function isSuperAdmin(user: User) {
  return user.is_super_admin === true;
}

function requireSuperAdmin(user: User) {
  if (!isSuperAdmin(user)) {
    throw new Response(JSON.stringify({
      success: false,
      error: 'Forbidden',
      message: 'Only SuperAdmin can manage tenant hierarchy',
    }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
}

function text(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

async function safeHandle<T>(fn: () => Promise<T>, c: any) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('Admin route error:', err);
    return c.json({ success: false, error: 'Internal Server Error' }, 500);
  }
}

adminRoutes.get('/tenants', async (c) => safeHandle(async () => {
  const user = c.get('user');
  const params: string[] = [];
  let where = 'WHERE t.is_active = 1';

  if (!isSuperAdmin(user)) {
    where += ' AND t.id = ?';
    params.push(user.tenant_id || '');
  }

  const { results } = await c.env.DB.prepare(`
    SELECT
      t.id,
      t.name,
      t.domain,
      t.is_active,
      t.is_platform_tenant,
      t.parent_tenant_id,
      t.group_type,
      p.name AS parent_name,
      COUNT(c.id) AS company_count,
      t.created_at
    FROM tenants t
    LEFT JOIN tenants p ON p.id = t.parent_tenant_id
    LEFT JOIN companies c ON c.tenant_id = t.id
    ${where}
    GROUP BY t.id, t.name, t.domain, t.is_active, t.is_platform_tenant,
             t.parent_tenant_id, t.group_type, p.name, t.created_at
    ORDER BY t.is_platform_tenant DESC, t.name
  `).bind(...params).all();

  const appAccess = await c.env.DB.prepare('SELECT tenant_id, app_id FROM tenant_app_access').all();
  const accessMap: Record<string, string[]> = {};
  for (const row of appAccess.results || []) {
    const tenantId = String((row as any).tenant_id);
    if (!accessMap[tenantId]) accessMap[tenantId] = [];
    accessMap[tenantId].push(String((row as any).app_id));
  }

  return c.json({
    success: true,
    tenants: (results || []).map((tenant: any) => ({
      ...tenant,
      allowed_apps: accessMap[tenant.id] || [],
    })),
  });
}, c));

adminRoutes.post('/tenants', async (c) => safeHandle(async () => {
  const user = c.get('user');
  requireSuperAdmin(user);

  const body = await c.req.json();
  const name = text(body.name);
  const domain = text(body.domain);
  const parentTenantId = text(body.parent_tenant_id);
  const groupType = text(body.group_type);

  if (!name || !domain) {
    return c.json({ success: false, error: 'Name and domain are required' }, 400);
  }
  if (groupType && !['telco', 'si', 'vendor'].includes(groupType)) {
    return c.json({ success: false, error: 'group_type must be telco, si, or vendor' }, 400);
  }
  if (parentTenantId) {
    const parent = await c.env.DB.prepare('SELECT id FROM tenants WHERE id = ?').bind(parentTenantId).first();
    if (!parent) return c.json({ success: false, error: 'Parent group not found' }, 400);
  }

  const id = `tenant_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  await c.env.DB.prepare(`
    INSERT INTO tenants (id, name, domain, is_active, parent_tenant_id, group_type)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(id, name, domain, body.is_active === false ? 0 : 1, parentTenantId, groupType).run();

  await logAudit(c.env.DB, user.id, 'CREATE_TENANT', 'tenants', id, JSON.stringify({ name, domain }));
  return c.json({ success: true, tenant_id: id }, 201);
}, c));

adminRoutes.put('/tenants/:id', async (c) => safeHandle(async () => {
  const user = c.get('user');
  requireSuperAdmin(user);

  const id = c.req.param('id');
  const body = await c.req.json();
  const name = text(body.name);
  const domain = text(body.domain);
  const parentTenantId = text(body.parent_tenant_id);
  const groupType = text(body.group_type);

  if (!name || !domain) {
    return c.json({ success: false, error: 'Name and domain are required' }, 400);
  }
  if (parentTenantId === id) {
    return c.json({ success: false, error: 'A group cannot be its own parent' }, 400);
  }
  if (groupType && !['telco', 'si', 'vendor'].includes(groupType)) {
    return c.json({ success: false, error: 'group_type must be telco, si, or vendor' }, 400);
  }

  await c.env.DB.prepare(`
    UPDATE tenants
    SET name = ?, domain = ?, is_active = ?, parent_tenant_id = ?, group_type = ?, updated_at = ?
    WHERE id = ?
  `).bind(name, domain, body.is_active === false ? 0 : 1, parentTenantId, groupType, new Date().toISOString(), id).run();

  await logAudit(c.env.DB, user.id, 'UPDATE_TENANT', 'tenants', id, JSON.stringify({ name, domain }));
  return c.json({ success: true });
}, c));

adminRoutes.delete('/tenants/:id', async (c) => safeHandle(async () => {
  const user = c.get('user');
  requireSuperAdmin(user);
  const id = c.req.param('id');

  const tenant = await c.env.DB.prepare('SELECT is_platform_tenant FROM tenants WHERE id = ?')
    .bind(id)
    .first<{ is_platform_tenant: number }>();
  if (!tenant) return c.json({ success: false, error: 'Tenant not found' }, 404);
  if (tenant.is_platform_tenant === 1) {
    return c.json({ success: false, error: 'Platform group cannot be deactivated' }, 400);
  }

  await c.env.DB.prepare('UPDATE tenants SET is_active = 0, updated_at = ? WHERE id = ?')
    .bind(new Date().toISOString(), id)
    .run();
  await logAudit(c.env.DB, user.id, 'DEACTIVATE_TENANT', 'tenants', id);
  return c.json({ success: true });
}, c));

adminRoutes.get('/companies', async (c) => safeHandle(async () => {
  const user = c.get('user');
  const tenantId = text(c.req.query('tenant_id'));
  const params: string[] = [];
  let where = 'WHERE 1=1';

  if (isSuperAdmin(user)) {
    if (tenantId) {
      where += ' AND c.tenant_id = ?';
      params.push(tenantId);
    }
  } else {
    where += ' AND c.tenant_id = ?';
    params.push(user.tenant_id || '');
  }

  const { results } = await c.env.DB.prepare(`
    SELECT c.id, c.tenant_id, c.code, c.name, c.logo_url, c.created_at,
           t.name AS tenant_name, t.domain AS tenant_domain
    FROM companies c
    LEFT JOIN tenants t ON t.id = c.tenant_id
    ${where}
    ORDER BY t.name, c.name
  `).bind(...params).all();
  return c.json({ success: true, companies: results || [] });
}, c));

adminRoutes.post('/companies', async (c) => safeHandle(async () => {
  const user = c.get('user');
  const body = await c.req.json();
  const tenantId = text(body.tenant_id) || user.tenant_id;
  const code = text(body.code)?.toUpperCase();
  const name = text(body.name);

  if (!tenantId || !code || !name) {
    return c.json({ success: false, error: 'tenant_id, code, and name are required' }, 400);
  }
  if (!isSuperAdmin(user) && tenantId !== user.tenant_id) {
    return c.json({ success: false, error: 'Cannot create companies outside your tenant' }, 403);
  }

  const id = `company_${crypto.randomUUID()}`;
  await c.env.DB.prepare(`
    INSERT INTO companies (id, tenant_id, code, name, logo_url)
    VALUES (?, ?, ?, ?, ?)
  `).bind(id, tenantId, code, name, text(body.logo_url)).run();

  await logAudit(c.env.DB, user.id, 'CREATE_COMPANY', 'companies', id, JSON.stringify({ tenantId, code, name }));
  return c.json({ success: true, company_id: id }, 201);
}, c));

adminRoutes.patch('/companies/:id', async (c) => safeHandle(async () => {
  const user = c.get('user');
  const id = c.req.param('id');
  const company = await c.env.DB.prepare('SELECT id, tenant_id FROM companies WHERE id = ?')
    .bind(id)
    .first<{ id: string; tenant_id: string }>();
  if (!company) return c.json({ success: false, error: 'Company not found' }, 404);
  if (!isSuperAdmin(user) && company.tenant_id !== user.tenant_id) {
    return c.json({ success: false, error: 'Company not found' }, 404);
  }

  const body = await c.req.json();
  const updates: string[] = [];
  const params: string[] = [];
  const name = text(body.name);
  const code = text(body.code)?.toUpperCase();
  const logoUrl = body.logo_url === undefined ? undefined : text(body.logo_url);

  if (name) { updates.push('name = ?'); params.push(name); }
  if (code) { updates.push('code = ?'); params.push(code); }
  if (logoUrl !== undefined) { updates.push('logo_url = ?'); params.push(logoUrl || ''); }
  if (updates.length === 0) return c.json({ success: false, error: 'No fields to update' }, 400);
  updates.push('updated_at = ?');
  params.push(new Date().toISOString(), id);

  await c.env.DB.prepare(`UPDATE companies SET ${updates.join(', ')} WHERE id = ?`).bind(...params).run();
  await logAudit(c.env.DB, user.id, 'UPDATE_COMPANY', 'companies', id);
  return c.json({ success: true });
}, c));
