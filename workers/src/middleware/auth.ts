/**
 * Authentication middleware — Google SSO with JWT verification
 * Single-tenant: user must exist in the users table to access the API.
 */

import { jwtVerify, createRemoteJWKSet, type JWTPayload } from 'jose';
import type { Context } from 'hono';
import type { Env } from '../index';

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
}

type Variables = { user: User };

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
export async function validateGoogleToken(token: string, env: Env): Promise<Omit<User, 'role'> | null> {
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

    return { id: decoded.sub, email: decoded.email, name: decoded.name || 'User' };
  } catch (err) {
    console.error('Google token verification failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Auth middleware — attaches user to context
 */
export async function authMiddleware(c: Context<{ Bindings: Env; Variables: Variables }>, next: Function) {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized', message: 'No token provided' }, 401);
  }

  const tokenUser = await validateGoogleToken(authHeader.substring(7), c.env);
  if (!tokenUser) {
    return c.json({ error: 'Unauthorized', message: 'Invalid token' }, 401);
  }

  // User must exist in DB
  const dbUser = await c.env.DB.prepare(
    'SELECT id, email, name, role, status FROM users WHERE LOWER(email) = LOWER(?)',
  ).bind(tokenUser.email).first<{ id: string; email: string; name: string; role: string; status: string }>();

  if (!dbUser || dbUser.status === 'deleted') {
    return c.json({ error: 'Access Denied', message: 'Account not registered. Contact admin.' }, 403);
  }

  if (dbUser.status === 'suspended') {
    return c.json({ error: 'Access Denied', message: 'Account suspended.' }, 403);
  }

  // Update last login
  await c.env.DB.prepare('UPDATE users SET last_login = ? WHERE id = ?')
    .bind(new Date().toISOString(), dbUser.id).run();

  c.set('user', { id: dbUser.id, email: dbUser.email, name: dbUser.name, role: dbUser.role });
  await next();
}

/**
 * Audit log helper
 */
export async function logAudit(db: D1Database, userId: string, action: string, resource: string, resourceId: string, details?: string) {
  try {
    await db.prepare(
      'INSERT INTO audit_log (id, user_id, action, resource_type, resource_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(crypto.randomUUID(), userId, action, resource, resourceId, details || null, new Date().toISOString()).run();
  } catch (e) {
    console.error('Audit log failed:', e);
  }
}
