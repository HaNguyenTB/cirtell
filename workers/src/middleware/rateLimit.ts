/**
 * Lightweight in-memory rate limiter for Cloudflare Workers
 */

import type { Context, Next } from 'hono';
import type { Env } from '../index';

const WINDOW_MS = 60_000; // 1 minute
const MAX_REQUESTS: Record<string, number> = {
  auth: 10,
  api: 300,
};

const windows = new Map<string, number[]>();

function check(key: string, limit: number): boolean {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  let stamps = windows.get(key);
  if (!stamps) { stamps = []; windows.set(key, stamps); }
  // Prune old entries
  while (stamps.length && stamps[0] < cutoff) stamps.shift();
  if (stamps.length >= limit) return false;
  stamps.push(now);
  return true;
}

function getClientIP(c: Context): string {
  return c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() || 'unknown';
}

export async function rateLimitMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
  const path = new URL(c.req.url).pathname;
  // Skip health check
  if (path === '/health') { await next(); return; }

  const ip = getClientIP(c);
  const isAuth = path.startsWith('/api/auth');
  const key = `${isAuth ? 'auth' : 'api'}:${ip}`;
  const limit = isAuth ? MAX_REQUESTS.auth : MAX_REQUESTS.api;

  if (!check(key, limit)) {
    return c.json({ success: false, error: 'Too many requests' }, 429);
  }
  await next();
}
