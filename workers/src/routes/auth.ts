/**
 * Auth routes - Google SSO validate + tenant context.
 */

import { Hono } from 'hono';
import type { Env } from '../index';
import { validateGoogleToken, authMiddleware, logAudit, type User } from '../middleware/auth';

type Variables = { user: User };

export const authRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

interface DbUser {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  tenant_id: string | null;
  company_id: string | null;
  is_super_admin: number | null;
  tenant_name: string | null;
  tenant_domain: string | null;
  is_platform_tenant: number | null;
  parent_tenant_id: string | null;
  group_type: string | null;
  company_name: string | null;
  company_code: string | null;
}

async function loadDbUser(db: D1Database, email: string): Promise<DbUser | null> {
  return db.prepare(`
    SELECT
      u.id, u.email, u.name, u.role, u.status,
      u.tenant_id, u.company_id, u.is_super_admin,
      t.name AS tenant_name,
      t.domain AS tenant_domain,
      t.is_platform_tenant,
      t.parent_tenant_id,
      t.group_type,
      c.name AS company_name,
      c.code AS company_code
    FROM users u
    LEFT JOIN tenants t ON t.id = u.tenant_id
    LEFT JOIN companies c ON c.id = u.company_id
    WHERE LOWER(u.email) = LOWER(?)
  `).bind(email).first<DbUser>();
}

async function loadCompanies(db: D1Database, user: DbUser) {
  const isSuperAdmin = user.is_super_admin === 1;
  const query = isSuperAdmin
    ? `
      SELECT c.id, c.tenant_id, c.code, c.name, c.logo_url, c.created_at,
             t.name AS tenant_name, t.domain AS tenant_domain
      FROM companies c
      LEFT JOIN tenants t ON t.id = c.tenant_id
      ORDER BY t.name, c.name
    `
    : `
      SELECT DISTINCT c.id, c.tenant_id, c.code, c.name, c.logo_url, c.created_at,
             t.name AS tenant_name, t.domain AS tenant_domain,
             COALESCE(uca.role, ?) AS role
      FROM companies c
      LEFT JOIN tenants t ON t.id = c.tenant_id
      LEFT JOIN user_company_assignments uca ON uca.company_id = c.id AND uca.user_id = ?
      WHERE uca.id IS NOT NULL OR c.id = ?
      ORDER BY t.name, c.name
    `;
  const stmt = isSuperAdmin
    ? db.prepare(query)
    : db.prepare(query).bind(user.role, user.id, user.company_id || '');
  const { results } = await stmt.all();
  return results || [];
}

async function loadTenantContext(db: D1Database, user: DbUser) {
  const companies = await loadCompanies(db, user);
  const companyIds = companies.map((company: any) => company.id);
  const tenant = user.tenant_id
    ? {
      id: user.tenant_id,
      name: user.tenant_name,
      domain: user.tenant_domain,
      is_platform_tenant: user.is_platform_tenant === 1,
      parent_tenant_id: user.parent_tenant_id,
      group_type: user.group_type,
    }
    : null;

  return {
    tenant,
    company_ids: companyIds,
    companies,
    managed_tenants: user.is_super_admin === 1 ? await loadManagedTenants(db) : [],
  };
}

async function loadManagedTenants(db: D1Database) {
  const { results } = await db.prepare(`
    SELECT id, name, domain, parent_tenant_id, group_type, is_platform_tenant
    FROM tenants
    WHERE is_active = 1
    ORDER BY is_platform_tenant DESC, name
  `).all();
  return results || [];
}

function publicUser(user: DbUser | User) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    tenant_id: user.tenant_id,
    company_id: user.company_id,
    tenant_name: 'tenant_name' in user ? user.tenant_name : undefined,
    company_name: 'company_name' in user ? user.company_name : undefined,
    is_super_admin: user.is_super_admin === true || user.is_super_admin === 1,
  };
}

/**
 * POST /api/auth/validate
 * Validates Google ID token and returns the user record
 */
authRoutes.post('/validate', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized', message: 'No token provided' }, 401);
  }

  const tokenUser = await validateGoogleToken(authHeader.substring(7), c.env);
  if (!tokenUser) {
    return c.json({ error: 'Unauthorized', message: 'Invalid token' }, 401);
  }

  try {
    const dbUser = await loadDbUser(c.env.DB, tokenUser.email);

    if (!dbUser) {
      return c.json({
        error: 'Access Denied',
        message: 'Your account has not been set up. Contact admin.',
        code: 'USER_NOT_REGISTERED',
      }, 403);
    }

    if (dbUser.status === 'deleted' || dbUser.status === 'suspended') {
      return c.json({ error: 'Access Denied', message: `Account ${dbUser.status}.` }, 403);
    }

    // Update last login
    await c.env.DB.prepare('UPDATE users SET last_login = ? WHERE id = ?')
      .bind(new Date().toISOString(), dbUser.id).run();

    await logAudit(c.env.DB, dbUser.id, 'LOGIN', 'users', dbUser.id);
    const context = await loadTenantContext(c.env.DB, dbUser);

    return c.json({
      success: true,
      user: publicUser(dbUser),
      ...context,
    });
  } catch (err: any) {
    console.error('Auth validate error:', err);
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

/**
 * GET /api/auth/me - returns current user info
 */
authRoutes.get('/me', authMiddleware, async (c) => {
  const user = c.get('user');
  const dbUser = await loadDbUser(c.env.DB, user.email);
  if (!dbUser) return c.json({ success: false, error: 'User not found' }, 404);
  const context = await loadTenantContext(c.env.DB, dbUser);
  return c.json({ success: true, user: publicUser(dbUser), ...context });
});
