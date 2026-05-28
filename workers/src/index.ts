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
import type { User } from './middleware/auth';
import { rateLimitMiddleware } from './middleware/rateLimit';

export interface Env {
  DB: D1Database;
  GOOGLE_CLIENT_ID: string;
  JWT_SECRET: string;
  FRONTEND_URL: string;
}

type Variables = { user: User };

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------
function getAllowedOrigin(env: Env, requestOrigin: string | undefined): string {
  const frontendUrl = (env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '');
  const allowedOrigins = [
    frontendUrl,
    'http://localhost:5173',
    'http://localhost:5174',
    'http://127.0.0.1:5173',
  ];
  return requestOrigin && allowedOrigins.includes(requestOrigin) ? requestOrigin : allowedOrigins[0];
}

app.use('*', async (c, next) => {
  if (c.req.method === 'OPTIONS') {
    const origin = c.req.header('Origin');
    const allowedOrigin = getAllowedOrigin(c.env, origin);
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Max-Age': '86400',
      },
    });
  }
  await next();
});

// Add CORS headers to every response
app.use('*', async (c, next) => {
  await next();
  const origin = c.req.header('Origin');
  const allowedOrigin = getAllowedOrigin(c.env, origin);
  c.res.headers.set('Access-Control-Allow-Origin', allowedOrigin);
  c.res.headers.set('Access-Control-Allow-Credentials', 'true');
});

// Body size limit (5 MB)
app.use('*', async (c, next) => {
  const contentLength = c.req.header('Content-Length');
  if (contentLength && parseInt(contentLength) > 5 * 1024 * 1024) {
    return c.json({ success: false, error: 'Request body too large. Maximum size is 5 MB.' }, 413);
  }
  await next();
});

// Rate limiting
app.use('*', rateLimitMiddleware);

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
app.route('/api/admin', adminRoutes);
app.route('/api', dashboardRoutes);

// 404
app.notFound((c) => c.json({ error: 'Not Found' }, 404));

// Global error handler
app.onError((err, c) => {
  console.error('[ERROR]', err);
  return c.json({ success: false, error: 'Internal server error' }, 500);
});

export default app;
