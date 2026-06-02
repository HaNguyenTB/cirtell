import type { Context, Next } from 'hono';
import { getAllowedOrigin } from '../http/cors';
import type { Env } from '../index';
import { hasSessionCookie } from '../services/auth/sessionCookie';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function cookieSessionCsrfMiddleware(
  c: Context<{ Bindings: Env }>,
  next: Next,
) {
  if (!UNSAFE_METHODS.has(c.req.method)) return next();
  if (!hasSessionCookie(c.req.header('Cookie'))) return next();

  const requestOrigin = requestOriginFromHeaders(c.req.header('Origin'), c.req.header('Referer'));
  const allowedOrigin = getAllowedOrigin(c.env, requestOrigin ?? undefined);

  if (!requestOrigin || allowedOrigin !== requestOrigin) {
    return c.json({
      success: false,
      error: 'Forbidden',
      message: 'Invalid request origin.',
    }, 403);
  }

  return next();
}

function requestOriginFromHeaders(originHeader: string | undefined, refererHeader: string | undefined): string | null {
  const origin = normalizeOrigin(originHeader);
  if (origin) return origin;

  try {
    return refererHeader ? new URL(refererHeader).origin : null;
  } catch {
    return null;
  }
}

function normalizeOrigin(value: string | undefined): string | null {
  const trimmed = value?.trim().replace(/\/+$/, '');
  if (!trimmed) return null;

  try {
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
}
