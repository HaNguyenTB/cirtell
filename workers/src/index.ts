/**
 * Cirtell API — Cloudflare Workers + D1
 * Multi-tenant Cirtell API: carbon accounting, parts catalog, transactions, warehouse, admin
 */

import { Hono } from 'hono';
import { authRoutes } from './routes/auth';
import { partsRoutes } from './routes/parts';
import { transactionsRoutes } from './routes/transactions';
import { carbonRoutes } from './routes/carbon';
import { dashboardRoutes } from './routes/dashboard';
import { warehouseRoutes } from './routes/warehouse';
import { adminRoutes } from './routes/admin';
import { projectRoutes } from './routes/projects';
import type { User } from './middleware/auth';
import { rateLimitMiddleware } from './middleware/rateLimit';
import { cookieSessionCsrfMiddleware } from './middleware/csrf';
import {
  corsPreflightResponse,
  fatalCorsErrorResponse,
  getAllowedOrigin,
  withCorsAndSecurityHeaders,
} from './http/cors';

export interface Env {
  DB: D1Database;
  EVIDENCE_BUCKET: R2Bucket;
  GOOGLE_CLIENT_ID: string;
  JWT_SECRET: string;
  FRONTEND_URL: string;
  CORS_ALLOWED_ORIGINS?: string;
}

type Variables = { user: User };

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('*', async (c, next) => {
  if (c.req.method === 'OPTIONS') {
    const origin = c.req.header('Origin');
    const allowedOrigin = getAllowedOrigin(c.env, origin);
    return corsPreflightResponse(allowedOrigin);
  }
  await next();
});

const STANDARD_BODY_LIMIT_BYTES = 5 * 1024 * 1024;
const EVIDENCE_BODY_LIMIT_BYTES = 25 * 1024 * 1024;

// Body size limit. Evidence files are stored in R2, so they get a larger cap.
app.use('*', async (c, next) => {
  const contentLength = c.req.header('Content-Length');
  const path = new URL(c.req.url).pathname;
  const limit = c.req.method === 'POST' && /^\/api\/projects\/[^/]+\/evidence$/.test(path)
    ? EVIDENCE_BODY_LIMIT_BYTES
    : STANDARD_BODY_LIMIT_BYTES;

  if (contentLength && parseInt(contentLength, 10) > limit) {
    const limitMb = Math.floor(limit / 1024 / 1024);
    return c.json({ success: false, error: `Request body too large. Maximum size is ${limitMb} MB.` }, 413);
  }
  await next();
});

// Rate limiting
app.use('*', rateLimitMiddleware);

// CSRF protection for unsafe requests authenticated by the HttpOnly session cookie.
app.use('*', cookieSessionCsrfMiddleware);

// Health check
app.get('/health', (c) =>
  c.json({ success: true, message: 'Cirtell API is running', timestamp: new Date().toISOString() }),
);

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.route('/api/auth', authRoutes);
app.route('/api/parts', partsRoutes);
app.route('/api/transactions', transactionsRoutes);
app.route('/api/ghg', carbonRoutes);
app.route('/api/warehouses', warehouseRoutes);
app.route('/api/projects', projectRoutes);
app.route('/api/admin', adminRoutes);
app.route('/api', dashboardRoutes);

// 404
app.notFound((c) => c.json({ error: 'Not Found' }, 404));

// Global error handler
app.onError((err, c) => {
  console.error('[ERROR]', err);
  return c.json({ success: false, error: 'Internal server error' }, 500);
});

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const allowedOrigin = getAllowedOrigin(env, request.headers.get('Origin') || undefined);
    try {
      const response = await app.fetch(request, env, ctx);
      return withCorsAndSecurityHeaders(response, allowedOrigin);
    } catch (err) {
      console.error('[FATAL WORKER ERROR]', err);
      return fatalCorsErrorResponse(allowedOrigin);
    }
  },
};
