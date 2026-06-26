import type { Context } from 'hono';
import type { Env } from '../index';
import type { User } from './auth';

type Variables = { user: User };
type ScopedContext = Context<{ Bindings: Env; Variables: Variables }>;
type SQLValue = string | number | null;

export interface TenantScope {
  tenantId: string | null;
  companyId: string | null;
  isSuperAdmin: boolean;
  isCrossTenant: boolean;
}

interface CompanyTenantRow {
  id: string;
  tenant_id: string;
}

function normalizeScopeValue(value: string | undefined | null): string | null {
  if (!value || value === '__ALL__' || value === 'all') return null;
  return value;
}

async function companyTenant(db: D1Database, companyId: string): Promise<CompanyTenantRow | null> {
  return db.prepare('SELECT id, tenant_id FROM companies WHERE id = ?')
    .bind(companyId)
    .first<CompanyTenantRow>();
}

async function userCanAccessCompany(db: D1Database, userId: string, companyId: string): Promise<CompanyTenantRow | null> {
  const row = await db.prepare(`
    SELECT c.id, c.tenant_id
    FROM companies c
    LEFT JOIN user_company_assignments uca ON uca.company_id = c.id AND uca.user_id = ?
    LEFT JOIN users u ON u.id = ?
    WHERE c.id = ?
      AND (uca.id IS NOT NULL OR u.company_id = c.id)
  `).bind(userId, userId, companyId).first<CompanyTenantRow>();
  return row || null;
}

export async function resolveTenantScope(c: ScopedContext): Promise<TenantScope> {
  const user = c.get('user');
  const requestedTenantId = normalizeScopeValue(c.req.query('tenant_id') || c.req.header('x-acting-tenant'));
  const requestedCompanyId = normalizeScopeValue(c.req.query('company_id') || c.req.header('x-acting-company'));
  const isSuperAdmin = user.is_super_admin === true;

  if (isSuperAdmin) {
    if (requestedCompanyId) {
      const company = await companyTenant(c.env.DB, requestedCompanyId);
      if (!company) throw new Error('Selected company not found');
      return {
        tenantId: company.tenant_id,
        companyId: company.id,
        isSuperAdmin,
        isCrossTenant: false,
      };
    }

    if (requestedTenantId) {
      const tenant = await c.env.DB.prepare('SELECT id FROM tenants WHERE id = ? AND is_active = 1')
        .bind(requestedTenantId)
        .first<{ id: string }>();
      if (!tenant) throw new Error('Selected tenant not found');
      return {
        tenantId: tenant.id,
        companyId: null,
        isSuperAdmin,
        isCrossTenant: false,
      };
    }

    return {
      tenantId: null,
      companyId: null,
      isSuperAdmin,
      isCrossTenant: true,
    };
  }

  if (requestedCompanyId) {
    const company = await userCanAccessCompany(c.env.DB, user.id, requestedCompanyId);
    if (company) {
      return {
        tenantId: company.tenant_id,
        companyId: company.id,
        isSuperAdmin,
        isCrossTenant: false,
      };
    }
  }

  return {
    tenantId: user.tenant_id || null,
    companyId: user.company_id || null,
    isSuperAdmin,
    isCrossTenant: false,
  };
}

export function scopedWhere(
  scope: TenantScope,
  tenantColumn: string,
  companyColumn: string,
): { clause: string; params: SQLValue[] } {
  if (scope.tenantId && scope.companyId) {
    return {
      clause: `${tenantColumn} = ? AND ${companyColumn} = ?`,
      params: [scope.tenantId, scope.companyId],
    };
  }
  if (scope.companyId) return { clause: `${companyColumn} = ?`, params: [scope.companyId] };
  if (scope.tenantId) return { clause: `${tenantColumn} = ?`, params: [scope.tenantId] };
  return { clause: '1=1', params: [] };
}

export function appendScopeCondition(
  conditions: string[],
  params: SQLValue[],
  scope: TenantScope,
  tenantColumn: string,
  companyColumn: string,
) {
  const scoped = scopedWhere(scope, tenantColumn, companyColumn);
  conditions.push(scoped.clause);
  params.push(...scoped.params);
}

export function scopeInsertValues(scope: TenantScope, user: User): { tenantId: string | null; companyId: string | null } {
  return {
    tenantId: scope.tenantId || user.tenant_id || null,
    companyId: scope.companyId || user.company_id || null,
  };
}
