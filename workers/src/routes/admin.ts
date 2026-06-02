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

function statusText(value: unknown): string | null {
  const normalized = text(value);
  if (!normalized) return null;
  return ['active', 'suspended', 'deleted'].includes(normalized) ? normalized : null;
}

function roleText(value: unknown): string | null {
  const normalized = text(value);
  if (!normalized) return null;
  return ['Admin', 'User', 'Viewer'].includes(normalized) ? normalized : null;
}

function scopeTenantCondition(user: User, alias = '') {
  const prefix = alias ? `${alias}.` : '';
  if (isSuperAdmin(user)) return { clause: '1=1', params: [] as string[] };
  return { clause: `${prefix}tenant_id = ?`, params: [user.tenant_id || ''] };
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

adminRoutes.get('/stats', async (c) => safeHandle(async () => {
  const user = c.get('user');
  const userScope = scopeTenantCondition(user);
  const scopedWhere = `WHERE ${userScope.clause}`;
  const userParams = userScope.params;

  const [totalUsers, activeUsers, adminUsers, recentLogins, tenants, companies, projects, auditEvents] = await Promise.all([
    c.env.DB.prepare(`SELECT COUNT(*) AS count FROM users ${scopedWhere}`).bind(...userParams).first<{ count: number }>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS count FROM users ${scopedWhere} AND status = 'active'`).bind(...userParams).first<{ count: number }>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS count FROM users ${scopedWhere} AND (role = 'Admin' OR is_super_admin = 1)`).bind(...userParams).first<{ count: number }>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS count FROM users ${scopedWhere} AND last_login > datetime('now', '-7 days')`).bind(...userParams).first<{ count: number }>(),
    isSuperAdmin(user)
      ? c.env.DB.prepare('SELECT COUNT(*) AS count FROM tenants WHERE is_active = 1').first<{ count: number }>()
      : c.env.DB.prepare('SELECT COUNT(*) AS count FROM tenants WHERE id = ? AND is_active = 1').bind(user.tenant_id || '').first<{ count: number }>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS count FROM companies ${scopedWhere.replaceAll('tenant_id', 'tenant_id')}`).bind(...userParams).first<{ count: number }>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS count FROM projects ${scopedWhere}`).bind(...userParams).first<{ count: number }>().catch(() => ({ count: 0 })),
    isSuperAdmin(user)
      ? c.env.DB.prepare('SELECT COUNT(*) AS count FROM audit_log').first<{ count: number }>()
      : c.env.DB.prepare(`
          SELECT COUNT(*) AS count
          FROM audit_log a
          LEFT JOIN users u ON u.id = a.user_id
          WHERE a.tenant_id = ? OR u.tenant_id = ?
        `).bind(user.tenant_id || '', user.tenant_id || '').first<{ count: number }>(),
  ]);

  return c.json({
    success: true,
    stats: {
      totalUsers: totalUsers?.count || 0,
      activeUsers: activeUsers?.count || 0,
      adminUsers: adminUsers?.count || 0,
      recentLogins: recentLogins?.count || 0,
      tenants: tenants?.count || 0,
      companies: companies?.count || 0,
      projects: projects?.count || 0,
      auditEvents: auditEvents?.count || 0,
    },
  });
}, c));

adminRoutes.get('/users', async (c) => safeHandle(async () => {
  const user = c.get('user');
  const tenantId = text(c.req.query('tenant_id'));
  const search = text(c.req.query('search'));
  const params: string[] = [];
  const conditions: string[] = ['u.status != ?'];
  params.push('deleted');

  if (isSuperAdmin(user)) {
    if (tenantId) {
      conditions.push('u.tenant_id = ?');
      params.push(tenantId);
    }
  } else {
    conditions.push('u.tenant_id = ?');
    params.push(user.tenant_id || '');
  }

  if (search) {
    conditions.push('(u.name LIKE ? OR u.email LIKE ? OR u.role LIKE ? OR t.name LIKE ? OR c.name LIKE ?)');
    const term = `%${search}%`;
    params.push(term, term, term, term, term);
  }

  const { results } = await c.env.DB.prepare(`
    SELECT
      u.id,
      u.email,
      u.name,
      u.role,
      u.status,
      u.last_login,
      u.created_at,
      u.tenant_id,
      u.company_id,
      u.is_super_admin,
      t.name AS tenant_name,
      c.name AS company_name,
      COALESCE(uca.assignment_count, 0) AS company_count
    FROM users u
    LEFT JOIN tenants t ON t.id = u.tenant_id
    LEFT JOIN companies c ON c.id = u.company_id
    LEFT JOIN (
      SELECT user_id, COUNT(*) AS assignment_count
      FROM user_company_assignments
      GROUP BY user_id
    ) uca ON uca.user_id = u.id
    WHERE ${conditions.join(' AND ')}
    ORDER BY u.is_super_admin DESC, u.role = 'Admin' DESC, u.name
    LIMIT 500
  `).bind(...params).all();

  return c.json({ success: true, users: results || [] });
}, c));

adminRoutes.patch('/users/:id', async (c) => safeHandle(async () => {
  const adminUser = c.get('user');
  const id = c.req.param('id');
  const body = await c.req.json();

  const target = await c.env.DB.prepare('SELECT id, tenant_id, is_super_admin FROM users WHERE id = ?')
    .bind(id)
    .first<{ id: string; tenant_id: string | null; is_super_admin: number | null }>();
  if (!target) return c.json({ success: false, error: 'User not found' }, 404);
  if (!isSuperAdmin(adminUser) && target.tenant_id !== adminUser.tenant_id) {
    return c.json({ success: false, error: 'User not found' }, 404);
  }
  if (id === adminUser.id && statusText(body.status) && statusText(body.status) !== 'active') {
    return c.json({ success: false, error: 'You cannot deactivate your own account' }, 400);
  }

  const updates: string[] = [];
  const params: Array<string | number | null> = [];
  const nextRole = roleText(body.role);
  const nextStatus = statusText(body.status);
  const nextCompanyId = text(body.company_id);
  const nextName = text(body.name);

  if (nextName) {
    updates.push('name = ?');
    params.push(nextName);
  }
  if (nextRole) {
    updates.push('role = ?');
    params.push(nextRole);
  }
  if (nextStatus) {
    updates.push('status = ?');
    params.push(nextStatus);
  }
  if (body.company_id !== undefined) {
    if (nextCompanyId) {
      const company = await c.env.DB.prepare('SELECT id, tenant_id FROM companies WHERE id = ?')
        .bind(nextCompanyId)
        .first<{ id: string; tenant_id: string }>();
      if (!company) return c.json({ success: false, error: 'Company not found' }, 400);
      if (!isSuperAdmin(adminUser) && company.tenant_id !== adminUser.tenant_id) {
        return c.json({ success: false, error: 'Company not found' }, 400);
      }
      updates.push('company_id = ?', 'tenant_id = ?');
      params.push(company.id, company.tenant_id);
    } else {
      updates.push('company_id = ?');
      params.push(null);
    }
  }
  if (body.is_super_admin !== undefined) {
    if (!isSuperAdmin(adminUser)) {
      return c.json({ success: false, error: 'Only SuperAdmin can change platform admin access' }, 403);
    }
    updates.push('is_super_admin = ?');
    params.push(body.is_super_admin === true || body.is_super_admin === 1 ? 1 : 0);
  }

  if (updates.length === 0) return c.json({ success: false, error: 'No fields to update' }, 400);
  updates.push('updated_at = ?');
  params.push(new Date().toISOString(), id);

  await c.env.DB.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).bind(...params).run();
  await logAudit(c.env.DB, adminUser.id, 'UPDATE_USER', 'users', id, JSON.stringify({ fields: Object.keys(body) }));
  return c.json({ success: true });
}, c));

adminRoutes.get('/audit-log', async (c) => safeHandle(async () => {
  const user = c.get('user');
  const limit = Math.min(parseInt(c.req.query('limit') || '80', 10), 200);
  const params: Array<string | number> = [];
  let where = 'WHERE 1=1';

  if (!isSuperAdmin(user)) {
    where += ' AND (a.tenant_id = ? OR u.tenant_id = ?)';
    params.push(user.tenant_id || '', user.tenant_id || '');
  }

  const { results } = await c.env.DB.prepare(`
    SELECT
      a.id,
      a.action,
      a.resource_type,
      a.resource_id,
      a.details,
      a.created_at,
      u.name AS user_name,
      u.email AS user_email,
      t.name AS tenant_name
    FROM audit_log a
    LEFT JOIN users u ON u.id = a.user_id
    LEFT JOIN tenants t ON t.id = COALESCE(a.tenant_id, u.tenant_id)
    ${where}
    ORDER BY a.created_at DESC
    LIMIT ?
  `).bind(...params, limit).all();

  return c.json({ success: true, audit: results || [] });
}, c));

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
