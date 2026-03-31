/**
 * Auth routes — Google SSO validate + user info
 */

import { Hono } from 'hono';
import type { Env } from '../index';
import { validateGoogleToken, authMiddleware, logAudit, type User } from '../middleware/auth';

type Variables = { user: User };

export const authRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

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
    const dbUser = await c.env.DB.prepare(
      'SELECT id, email, name, role, status FROM users WHERE LOWER(email) = LOWER(?)',
    ).bind(tokenUser.email).first<{ id: string; email: string; name: string; role: string; status: string }>();

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

    return c.json({
      success: true,
      user: { id: dbUser.id, email: dbUser.email, name: dbUser.name, role: dbUser.role },
    });
  } catch (err: any) {
    console.error('Auth validate error:', err);
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

/**
 * GET /api/auth/me — returns current user info
 */
authRoutes.get('/me', authMiddleware, async (c) => {
  const user = c.get('user');
  return c.json({ success: true, user });
});
