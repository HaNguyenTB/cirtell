import type { Env } from '../index';

const CORS_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
const CORS_HEADERS = 'Content-Type, Authorization, X-Acting-Tenant, X-Acting-Company';

function normalizeOrigin(origin: string | undefined): string | null {
  const value = origin?.trim().replace(/\/+$/, '');
  return value || null;
}

export function getAllowedOrigin(
  env: Pick<Env, 'FRONTEND_URL' | 'CORS_ALLOWED_ORIGINS'>,
  requestOrigin: string | undefined,
): string {
  const frontendUrl = (env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '');
  const allowedOrigins = new Set<string>([frontendUrl]);

  for (const configuredOrigin of (env.CORS_ALLOWED_ORIGINS || '').split(',')) {
    const origin = normalizeOrigin(configuredOrigin);
    if (origin) allowedOrigins.add(origin);
  }

  if (!frontendUrl.includes('cirtell.com')) {
    allowedOrigins.add(frontendUrl.replace('http://localhost', 'http://127.0.0.1'));
    allowedOrigins.add(frontendUrl.replace('http://127.0.0.1', 'http://localhost'));
    [
      'http://localhost:4173',
      'http://localhost:5173',
      'http://localhost:5174',
      'http://127.0.0.1:4173',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:5174',
    ].forEach((origin) => allowedOrigins.add(origin));
  }

  const normalizedRequestOrigin = normalizeOrigin(requestOrigin);
  return normalizedRequestOrigin && allowedOrigins.has(normalizedRequestOrigin)
    ? normalizedRequestOrigin
    : frontendUrl;
}

export function corsPreflightResponse(allowedOrigin: string): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': CORS_METHODS,
      'Access-Control-Allow-Headers': CORS_HEADERS,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Max-Age': '86400',
    },
  });
}

export function withCorsAndSecurityHeaders(response: Response, allowedOrigin: string): Response {
  const secured = new Response(response.body, response);
  setCorsAndSecurityHeaders(secured.headers, allowedOrigin);
  return secured;
}

export function fatalCorsErrorResponse(allowedOrigin: string): Response {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  setCorsAndSecurityHeaders(headers, allowedOrigin);
  return new Response(
    JSON.stringify({ success: false, error: 'Internal Server Error' }),
    { status: 500, headers },
  );
}

function setCorsAndSecurityHeaders(headers: Headers, allowedOrigin: string): void {
  headers.set('Access-Control-Allow-Origin', allowedOrigin);
  headers.set('Access-Control-Allow-Credentials', 'true');
  headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
}
