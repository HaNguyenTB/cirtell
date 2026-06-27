# Cirtell

[![CI](https://github.com/HaNguyenTB/cirtell/actions/workflows/ci.yml/badge.svg)](https://github.com/HaNguyenTB/cirtell/actions/workflows/ci.yml)

Cirtell is a standalone circular telecom asset platform for managing telecom parts, warehouse inventory, transactions, circular economy projects, evidence files, administration, and carbon reporting.

The application is built as a Cloudflare-native system:

- Frontend: React, TypeScript, Vite, Zustand, Recharts, Playwright.
- Backend: Cloudflare Workers, Hono, D1, R2.
- Auth: Google SSO validation plus signed app sessions.
- Data model: tenant/company scoped by default.

## Product Capabilities

- Parts Catalog: telecom part master data, vendor lookup, scoped uniqueness, CSV/XLSX import, review fields, and emissions factors.
- Warehouse: warehouses, zones, inventory buckets, conditions, stock movements, and transaction-linked inventory sync.
- Transactions: purchase, sale, redeploy, recycle workflows with line items, warehouse references, project links, and purchase-order files.
- Projects: circularity project workspace with materials/assets, evidence, comments, workflow data, vendors, technologies, and reports.
- Evidence Storage: project evidence metadata in D1 and file content in Cloudflare R2.
- Carbon Accounting: manual GHG entries, Scope 1/2/3 reports, avoided-emissions sync from reuse flows, and dashboard KPIs.
- Administration: users, companies, groups/tenants, role/status management, audit logs, and session revocation after authorization changes.
- Security: RBAC, tenant/company isolation, CSRF origin checks, rate limiting, security headers, scoped D1 queries, and app-session version checks.

## Repository Layout

```text
cirtell/
  .github/workflows/
    ci.yml                         GitHub Actions verification workflow

  frontend/
    e2e/                           Playwright E2E tests with mocked API
    public/_headers                Cloudflare Pages security headers
    src/components/                Shared UI components
    src/lib/                       API and auth token helpers
    src/pages/                     Main product pages
    src/stores/                    Zustand auth/session state
    package.json                   Frontend scripts and dependencies
    playwright.config.ts           Playwright config

  workers/
    migrations/                    D1 schema migrations
    scripts/                       Local integrity/smoke SQL scripts
    src/http/                      CORS/security response helpers
    src/middleware/                Auth, permissions, tenant scope, CSRF, rate limiting
    src/routes/                    API route modules
    src/services/                  Shared backend services
    test/                          Workers integration tests
    package.json                   Worker scripts and dependencies
    wrangler.toml                  Worker, D1, and R2 bindings

  docs/                            Engineering/testing notes
  latex/                           Thesis/report source and generated PDF
```

## Prerequisites

- Node.js 20 recommended.
- npm.
- Cloudflare account with Workers, Pages, D1, and R2 enabled.
- Wrangler authentication for local Cloudflare development.
- Google OAuth client ID for real SSO environments.

CI uses Node.js 20.

## Local Setup

Install dependencies:

```bash
cd frontend
npm install

cd ../workers
npm install
```

Create `frontend/.env`:

```text
VITE_API_URL=http://localhost:8787
VITE_GOOGLE_CLIENT_ID=<google-oauth-client-id>
```

Create `workers/.dev.vars`:

```text
GOOGLE_CLIENT_ID=<google-oauth-client-id>
JWT_SECRET=<local-development-secret>
```

Apply local D1 migrations:

```bash
cd workers
npx wrangler d1 migrations apply cirtell-db --local
```

Run the backend:

```bash
cd workers
npm run dev
```

Run the frontend in a second terminal:

```bash
cd frontend
npm run dev
```

## Verification

Run backend checks:

```bash
cd workers
npm ci
npx tsc --noEmit
npm test
```

Run frontend checks:

```bash
cd frontend
npm ci
npm run lint
npm run build
npx playwright install chromium
npm run test:e2e
```

Run a local migration smoke check:

```bash
cd workers
npx wrangler d1 migrations apply cirtell-db --local
```

For an isolated local D1 migration check:

```bash
cd workers
npx wrangler d1 migrations apply cirtell-db --local --persist-to .tmp/d1-check
npx wrangler d1 execute cirtell-db --local --persist-to .tmp/d1-check --command "PRAGMA foreign_key_check;"
```

## Continuous Integration

GitHub Actions runs on pushes to `main`, pull requests targeting `main`, and manual dispatch.

The workflow does not deploy production resources. It verifies:

- Backend typecheck.
- Backend D1 migration smoke check on a local database.
- Backend Vitest integration tests.
- Frontend lint.
- Frontend build.
- Frontend Playwright E2E tests with mocked API routes.

CI test environment variables are deliberately non-production:

```text
JWT_SECRET=test-ci-jwt-secret
GOOGLE_CLIENT_ID=test-client-id
VITE_API_URL=http://127.0.0.1:8787
VITE_GOOGLE_CLIENT_ID=test-client-id
```

Playwright failure artifacts are uploaded only when E2E fails.

## Cloudflare Resources

Cirtell currently expects these Cloudflare resources:

| Resource | Name / binding |
| --- | --- |
| Pages project | `cirtell` |
| Worker | `cirtell-api` |
| D1 binding | `DB` |
| D1 database | `cirtell-db` |
| R2 binding | `EVIDENCE_BUCKET` |
| R2 bucket | `cirtell-evidence` |
| Development R2 bucket | `cirtell-evidence-dev` |

Create or confirm remote resources:

```bash
cd workers
npx wrangler d1 create cirtell-db
npx wrangler r2 bucket create cirtell-evidence
npx wrangler r2 bucket create cirtell-evidence-dev
```

Set Worker secrets:

```bash
cd workers
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put JWT_SECRET
```

Apply remote migrations only when intentionally updating the remote database:

```bash
cd workers
npx wrangler d1 migrations apply cirtell-db --remote
```

## Deployment

Deploy the Worker:

```bash
cd workers
npm run deploy
```

Build and deploy the frontend to Cloudflare Pages:

```bash
cd frontend
npm run build
npx wrangler pages deploy dist --project-name cirtell --branch main
```

Production URLs:

- App: `https://cirtell.pages.dev`
- API: `https://cirtell-api.hanguyenngan928.workers.dev`

## API Surface

| Path | Purpose |
| --- | --- |
| `/api/auth` | Google SSO validation, app session, logout, current user |
| `/api/parts` | Parts catalog CRUD, vendor lookup, Excel/CSV import |
| `/api/transactions` | Transactions, line items, references, inventory sync, PO files |
| `/api/warehouses` | Warehouses, zones, inventory buckets, movements |
| `/api/projects` | Project workspace, materials/assets, evidence, comments, reports |
| `/api/admin` | Users, companies, tenants/groups, audit log |
| `/api/ghg` | GHG entries, reports, avoided-emissions sync |
| `/api` | Dashboard and headline metrics |
| `/health` | Worker health check |

## Data Ownership And Security

Cirtell is tenant/company scoped. Normal users operate within their assigned company. Admin users manage records within their tenant/company scope. Super Admin users can manage platform-level tenant/group access.

Important backend guarantees:

- Auth middleware validates either Google ID tokens or signed app session JWTs.
- App session JWTs include `session_version`; authorization-sensitive user changes revoke old sessions by incrementing `users.session_version`.
- Permission middleware enforces route-level RBAC.
- Tenant scope middleware clamps unsupported `tenant_id` and `company_id` query/header tampering for non-super-admin users.
- Inventory auto-sync validates part, warehouse, inventory, and transaction ownership before writing movements.
- Project evidence metadata is stored in D1; project evidence file bytes are stored in R2.
- Transaction purchase order files are stored through protected transaction routes.

## Inventory Sync Notes

Transaction inventory sync is implemented through backend services and D1 movements:

- Purchase creates receive movements into the destination warehouse.
- Sale and Recycle create ship movements from the source warehouse.
- Redeploy creates transfer movements from source to destination.
- Sync only runs when the transaction has enough part and warehouse data.
- Updates use reverse-and-rebuild for inventory-affecting changes.
- Delete/void reverses synced inventory movements and keeps audit data.
- Backfill exists as an admin-controlled flow and should not be run automatically on production without review.

## Testing Notes

Backend tests use the Cloudflare Vitest Workers pool with local D1 migrations.

Frontend E2E tests use Playwright route interception. They do not call Google, production APIs, or production D1/R2 resources.

Useful commands:

```bash
cd workers
npm test
```

```bash
cd frontend
npm run test:e2e
npm run test:e2e:headed
npm run test:e2e:ui
```

## Troubleshooting

If Google sign-in fails with `origin_mismatch`, add the deployed Pages origin to the Google OAuth client JavaScript origins.

If local auth works inconsistently, clear browser session storage for the frontend origin and sign in again.

If D1 migrations behave unexpectedly, use a fresh local persist directory:

```bash
cd workers
npx wrangler d1 migrations apply cirtell-db --local --persist-to .tmp/d1-fresh
```

If Playwright cannot find Chromium:

```bash
cd frontend
npx playwright install chromium
```

## Documentation Notes

- Cirtell is a standalone platform with its own product scope and data model.
- Do not describe Cirtell as a derivative of another platform in user-facing docs.
- Keep public documentation focused on Cirtell workflows, security, deployment, and verification.
