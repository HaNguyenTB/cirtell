/**
 * Authentication middleware - Google SSO with JWT verification.
 * Multi-tenant: user must exist in the users table and carries tenant scope.
 */

import { jwtVerify, createRemoteJWKSet, type JWTPayload } from 'jose';
import type { Context } from 'hono';
import type { Env } from '../index';
import { getSessionCookieToken, validateSessionToken } from '../services/auth/sessionCookie';

interface GoogleTokenPayload extends JWTPayload {
  aud: string;
  iss: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  sub: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  tenant_id: string | null;
  company_id: string | null;
  tenant_name?: string | null;
  company_name?: string | null;
  is_super_admin?: boolean;
  session_version?: number | null;
}

type Variables = { user: User };

interface VerifiedIdentity {
  id: string;
  email: string;
  name: string;
  provider: 'google' | 'session';
  sessionVersion?: number | null;
}

interface DbUserRow {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  tenant_id: string | null;
  company_id: string | null;
  is_super_admin: number | null;
  tenant_name: string | null;
  company_name: string | null;
  session_version: number | null;
}

let jwksCache: ReturnType<typeof createRemoteJWKSet> | null = null;

function getGoogleJWKS(): ReturnType<typeof createRemoteJWKSet> {
  if (!jwksCache) {
    jwksCache = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
  }
  return jwksCache;
}

/**
 * Validate Google ID token cryptographically
 */
export async function validateGoogleToken(
  token: string,
  env: Env,
): Promise<VerifiedIdentity | null> {
  try {
    if (!token || typeof token !== 'string' || token.split('.').length !== 3) return null;
    if (!env.GOOGLE_CLIENT_ID) { console.error('GOOGLE_CLIENT_ID not set'); return null; }

    const JWKS = getGoogleJWKS();
    const { payload } = await jwtVerify(token, JWKS, {
      algorithms: ['RS256'],
      audience: [env.GOOGLE_CLIENT_ID],
      clockTolerance: 30,
    });
    const decoded = payload as GoogleTokenPayload;

    if (!['accounts.google.com', 'https://accounts.google.com'].includes(decoded.iss)) return null;
    if (!decoded.sub || !decoded.email) return null;
    if (decoded.email_verified === false) return null;

    return {
      id: decoded.sub,
      email: decoded.email,
      name: decoded.name || 'User',
      provider: 'google',
      sessionVersion: null,
    };
  } catch (err) {
    console.error('Google token verification failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

const SELECT_USER = `
  SELECT
    u.id, u.email, u.name, u.role, u.status,
    u.tenant_id, u.company_id, u.is_super_admin, u.session_version,
    t.name AS tenant_name,
    c.name AS company_name
  FROM users u
  LEFT JOIN tenants t ON t.id = u.tenant_id
  LEFT JOIN companies c ON c.id = u.company_id
`;

async function loadDbUserForIdentity(db: D1Database, identity: VerifiedIdentity): Promise<DbUserRow | null> {
  if (identity.provider === 'session') {
    return db.prepare(`${SELECT_USER} WHERE u.id = ?`)
      .bind(identity.id)
      .first<DbUserRow>();
  }

  const byGoogleSub = await db.prepare(`${SELECT_USER} WHERE u.google_sub = ?`)
    .bind(identity.id)
    .first<DbUserRow>();
  if (byGoogleSub) return byGoogleSub;

  return db.prepare(`${SELECT_USER} WHERE LOWER(u.email) = LOWER(?) AND u.google_sub IS NULL`)
    .bind(identity.email)
    .first<DbUserRow>();
}

/**
 * Auth middleware - attaches user to context
 */
export async function authMiddleware(c: Context<{ Bindings: Env; Variables: Variables }>, next: Function) {
  const authHeader = c.req.header('Authorization');
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;
  const cookieToken = getSessionCookieToken(c.req.header('Cookie'));

  if (!bearerToken && !cookieToken) {
    return c.json({ error: 'Unauthorized', message: 'No token provided' }, 401);
  }

  let tokenUser: VerifiedIdentity | null = null;

  if (bearerToken) {
    tokenUser = await validateGoogleToken(bearerToken, c.env);
    if (!tokenUser) {
      const sessionUser = await validateSessionToken(bearerToken, c.env);
      if (sessionUser) {
        tokenUser = {
          id: sessionUser.id,
          email: sessionUser.email,
          name: sessionUser.name,
          provider: 'session',
          sessionVersion: sessionUser.sessionVersion,
        };
      }
    }
  }

  if (!tokenUser && cookieToken) {
    const sessionUser = await validateSessionToken(cookieToken, c.env);
    if (sessionUser) {
      tokenUser = {
        id: sessionUser.id,
        email: sessionUser.email,
        name: sessionUser.name,
        provider: 'session',
        sessionVersion: sessionUser.sessionVersion,
      };
    }
  }

  if (!tokenUser) {
    return c.json({ error: 'Unauthorized', message: 'Invalid token' }, 401);
  }

  const dbUser = await loadDbUserForIdentity(c.env.DB, tokenUser);

  if (!dbUser || dbUser.status === 'deleted') {
    return c.json({ error: 'Access Denied', message: 'Account not registered. Contact admin.' }, 403);
  }

  if (dbUser.status === 'suspended') {
    return c.json({ error: 'Access Denied', message: 'Account suspended.' }, 403);
  }

  if (
    tokenUser.provider === 'session' &&
    tokenUser.sessionVersion !== null &&
    tokenUser.sessionVersion !== undefined &&
    (dbUser.session_version ?? 0) !== tokenUser.sessionVersion
  ) {
    return c.json({ error: 'Unauthorized', message: 'Session expired' }, 401);
  }

  // Update last login
  await c.env.DB.prepare('UPDATE users SET last_login = ? WHERE id = ?')
    .bind(new Date().toISOString(), dbUser.id).run();

  c.set('user', {
    id: dbUser.id,
    email: dbUser.email,
    name: dbUser.name,
    role: dbUser.role,
    tenant_id: dbUser.tenant_id,
    company_id: dbUser.company_id,
    tenant_name: dbUser.tenant_name,
    company_name: dbUser.company_name,
    is_super_admin: dbUser.is_super_admin === 1,
    session_version: dbUser.session_version ?? 0,
  });
  await next();
}

/**
 * Audit log helper
 */
export async function logAudit(
  db: D1Database,
  userId: string,
  action: string,
  resource: string,
  resourceId: string,
  details?: string,
  tenantId?: string | null,
  companyId?: string | null,
) {
  try {
    await db.prepare(
      `INSERT INTO audit_log (
        id, user_id, action, resource_type, resource_id, details, tenant_id, company_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      userId,
      action,
      resource,
      resourceId,
      details || null,
      tenantId || null,
      companyId || null,
      new Date().toISOString(),
    ).run();
  } catch (e) {
    console.error('Audit log failed:', e);
  }
}
