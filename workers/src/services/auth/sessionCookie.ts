import type { Context } from 'hono';
import { jwtVerify, SignJWT, type JWTPayload } from 'jose';
import type { Env } from '../../index';

const SESSION_COOKIE_NAME = 'cirtell_session';
const SESSION_MAX_AGE_SECONDS = 24 * 60 * 60;

type SessionClaims = JWTPayload & {
  email?: string;
  name?: string;
  provider?: 'google' | 'session';
  session_version?: number;
  type?: string;
};

export interface SessionIdentity {
  id: string;
  email: string;
  name: string;
  sessionVersion: number;
}

export async function createAppSessionToken(
  env: Pick<Env, 'JWT_SECRET'>,
  session: {
    userId: string;
    email: string;
    name?: string | null;
    sessionVersion?: number | null;
  },
): Promise<string> {
  if (!env.JWT_SECRET) throw new Error('JWT_SECRET is not configured');

  const secret = new TextEncoder().encode(env.JWT_SECRET);
  return new SignJWT({
    sub: session.userId,
    email: session.email,
    name: session.name || session.email.split('@')[0],
    provider: 'google',
    session_version: session.sessionVersion ?? 0,
    type: 'app_session',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .setIssuer('cirtell')
    .sign(secret);
}

export async function validateSessionToken(
  token: string,
  env: Pick<Env, 'JWT_SECRET'>,
): Promise<SessionIdentity | null> {
  if (!env.JWT_SECRET || !token || token.split('.').length !== 3) return null;

  try {
    const secret = new TextEncoder().encode(env.JWT_SECRET);
    const { payload } = await jwtVerify(token, secret, {
      issuer: 'cirtell',
      algorithms: ['HS256'],
    });
    const claims = payload as SessionClaims;
    if (claims.type !== 'app_session') return null;

    const id = typeof claims.sub === 'string' ? claims.sub : '';
    const email = typeof claims.email === 'string' ? claims.email : '';
    const name = typeof claims.name === 'string' ? claims.name : email.split('@')[0];
    const sessionVersion = typeof claims.session_version === 'number' ? claims.session_version : null;

    if (!id || !email || sessionVersion === null) return null;
    return { id, email, name, sessionVersion };
  } catch {
    return null;
  }
}

export function getSessionCookieToken(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;

  for (const cookie of cookieHeader.split(';')) {
    const [rawName, ...valueParts] = cookie.trim().split('=');
    if (rawName === SESSION_COOKIE_NAME) {
      const value = valueParts.join('=');
      return value ? decodeURIComponent(value) : null;
    }
  }

  return null;
}

export function hasSessionCookie(cookieHeader: string | undefined): boolean {
  return getSessionCookieToken(cookieHeader) !== null;
}

export function setSessionCookie(c: Context, token: string): void {
  c.header('Set-Cookie', buildSessionCookie(c, token, SESSION_MAX_AGE_SECONDS));
}

export function clearSessionCookie(c: Context): void {
  c.header('Set-Cookie', buildSessionCookie(c, '', 0));
}

function buildSessionCookie(c: Context, token: string, maxAgeSeconds: number): string {
  const isHttps = isHttpsRequest(c);
  const sameSite = isHttps ? 'SameSite=None' : 'SameSite=Lax';
  const secure = isHttps ? '; Secure' : '';

  return [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    `Max-Age=${maxAgeSeconds}`,
    'Path=/',
    'HttpOnly',
    sameSite,
    'Priority=High',
  ].join('; ') + secure;
}

function isHttpsRequest(c: Context): boolean {
  const forwardedProto = c.req.header('X-Forwarded-Proto');
  if (forwardedProto) return forwardedProto.toLowerCase() === 'https';
  return new URL(c.req.url).protocol === 'https:';
}
