import type { Context, Next } from 'hono';
import type { Env } from '../index';

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyPrefix: string;
}

const RATE_LIMITS = {
  auth: { windowMs: 60_000, maxRequests: 10, keyPrefix: 'auth' },
  api: { windowMs: 60_000, maxRequests: 600, keyPrefix: 'api' },
  admin: { windowMs: 60_000, maxRequests: 1000, keyPrefix: 'admin' },
  public: { windowMs: 60_000, maxRequests: 60, keyPrefix: 'public' },
  privilegeChange: { windowMs: 10 * 60_000, maxRequests: 5, keyPrefix: 'privilege' },
} as const;

const windows = new Map<string, number[]>();
const RATE_LIMIT_MAP_MAX_KEYS = 10_000;
let pruneCounter = 0;

function getClientIP(c: Context): string {
  return c.req.header('CF-Connecting-IP') || 'unknown';
}

function key(prefix: string, identifier: string): string {
  return `rl:${prefix}:${identifier}`;
}

async function checkD1(
  db: D1Database,
  rateLimitKey: string,
  config: RateLimitConfig,
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const now = Date.now();
  const windowStart = now - config.windowMs;

  try {
    await db.prepare('DELETE FROM rate_limits WHERE key = ? AND window_start < ?')
      .bind(rateLimitKey, windowStart)
      .run();

    await db.prepare('INSERT OR IGNORE INTO rate_limits (key, request_count, window_start) VALUES (?, 0, ?)')
      .bind(rateLimitKey, now)
      .run();

    const result = await db.prepare(`
      UPDATE rate_limits
      SET request_count = request_count + 1
      WHERE key = ? AND request_count < ?
      RETURNING request_count, window_start
    `).bind(rateLimitKey, config.maxRequests).first<{ request_count: number; window_start: number }>();

    if (!result) {
      const row = await db.prepare('SELECT window_start FROM rate_limits WHERE key = ?')
        .bind(rateLimitKey)
        .first<{ window_start: number }>();
      return { allowed: false, remaining: 0, resetAt: (row?.window_start ?? now) + config.windowMs };
    }

    return {
      allowed: true,
      remaining: config.maxRequests - result.request_count,
      resetAt: result.window_start + config.windowMs,
    };
  } catch (err) {
    console.warn('D1 rate limit check failed, falling back to memory:', err);
    return checkMemory(rateLimitKey, config);
  }
}

function checkMemory(
  rateLimitKey: string,
  config: RateLimitConfig,
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const windowStart = now - config.windowMs;
  const resetAt = now + config.windowMs;

  let stamps = windows.get(rateLimitKey);
  if (!stamps) {
    if (windows.size >= RATE_LIMIT_MAP_MAX_KEYS) {
      const oldestKey = windows.keys().next().value;
      if (oldestKey !== undefined) windows.delete(oldestKey);
    }
    stamps = [];
    windows.set(rateLimitKey, stamps);
  }

  const validStart = stamps.findIndex((stamp) => stamp > windowStart);
  if (validStart > 0) stamps.splice(0, validStart);
  else if (validStart === -1) stamps.length = 0;

  if (stamps.length >= config.maxRequests) {
    return { allowed: false, remaining: 0, resetAt };
  }

  stamps.push(now);
  return { allowed: true, remaining: config.maxRequests - stamps.length, resetAt };
}

function maybePruneCache() {
  pruneCounter++;
  if (pruneCounter < 100) return;
  pruneCounter = 0;

  const staleBefore = Date.now() - 5 * 60_000;
  for (const [rateLimitKey, stamps] of windows) {
    if (stamps.length === 0 || stamps[stamps.length - 1] < staleBefore) {
      windows.delete(rateLimitKey);
    }
  }
}

function configForPath(path: string): keyof typeof RATE_LIMITS {
  if (path.startsWith('/api/auth')) return 'auth';
  if (path.startsWith('/api/admin')) return 'admin';
  if (path.startsWith('/api/')) return 'api';
  return 'public';
}

export async function rateLimitMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
  const path = c.req.path;
  if (path === '/health') return next();

  let configName = configForPath(path);
  if (
    path.startsWith('/api/admin/users') &&
    ['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.req.method)
  ) {
    configName = 'privilegeChange';
  }

  const config = RATE_LIMITS[configName];
  const rateLimitKey = key(config.keyPrefix, getClientIP(c));
  const strict = configName === 'auth' || configName === 'public' || configName === 'privilegeChange';
  const result = strict
    ? await checkD1(c.env.DB, rateLimitKey, config)
    : checkMemory(rateLimitKey, config);

  maybePruneCache();

  c.header('X-RateLimit-Limit', config.maxRequests.toString());
  c.header('X-RateLimit-Remaining', Math.max(0, result.remaining).toString());
  c.header('X-RateLimit-Reset', Math.ceil(result.resetAt / 1000).toString());

  if (!result.allowed) {
    const retryAfter = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
    c.header('Retry-After', retryAfter.toString());
    return c.json({
      success: false,
      error: 'Too Many Requests',
      message: 'Rate limit exceeded. Please try again later.',
      retryAfter,
    }, 429);
  }

  return next();
}
