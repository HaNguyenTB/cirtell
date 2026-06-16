# Cirtell

Cirtell is a standalone circular telecom asset platform with its own product scope, data model, Cloudflare deployment, and user workflows.

The platform helps teams manage telecom parts, warehouse stock, transactions, project execution, evidence files, administration, and carbon reporting in one complete workspace.

## Product Scope

- Parts Catalog - master telecom equipment catalog with vendor data, review status, CSV/XLSX import, and scoped search.
- Materials & Assets - project equipment rows linked to the parts catalog, with Excel import for bulk project intake.
- Transactions - purchase, sale, redeploy, and recycle workflows with warehouse, market, contact, line-item, and purchase-order support.
- Warehouse - multi-warehouse inventory, movements, conditions, zones, and part-level stock views.
- Projects - circular economy project workspace with workflow stages, materials, logistics, financials, evidence, comments, reports, and members.
- Evidence Storage - project evidence metadata in D1 and uploaded files in Cloudflare R2.
- Carbon Accounting - GHG entries, Scope 1/2/3 reporting, and dashboard KPIs.
- Administration - user, company, group, tenant, and audit management for the Cirtell platform.
- Security - Google SSO, HttpOnly app sessions, CSRF origin checks, scoped authorization, rate limiting, and Cloudflare security headers.

## Architecture

```text
cirtell/
  frontend/              React + TypeScript + Vite application
    public/_headers      Cloudflare Pages security headers
    src/pages/           Product pages and workflows
    src/lib/api.ts       API client and scoped request helper

  workers/               Cloudflare Workers API
    src/index.ts         Hono app entry point
    src/routes/          Auth, parts, transactions, warehouse, projects, admin, carbon
    src/middleware/      Auth, permissions, tenant scope, CSRF, rate limiting
    src/http/            CORS and security response helpers
    src/services/        Session cookie helpers
    migrations/          D1 schema migrations
    wrangler.toml        D1, R2, and Worker configuration
```

## Cloudflare Resources

Cirtell currently uses:

- Cloudflare Pages project: `cirtell`
- Cloudflare Worker: `cirtell-api`
- D1 database binding: `DB` -> `cirtell-db`
- R2 bucket binding: `EVIDENCE_BUCKET` -> `cirtell-evidence`
- Development R2 bucket: `cirtell-evidence-dev`

## Prerequisites

- Node.js 18+
- Cloudflare account with Workers, Pages, D1, and R2 enabled
- Google Cloud OAuth client for Google SSO
- Wrangler authenticated with the correct Cloudflare account

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

Run the API and frontend in separate terminals:

```bash
cd workers
npx wrangler dev
```

```bash
cd frontend
npm run dev
```

## Remote Setup

Create or confirm the remote D1 database and R2 buckets:

```bash
cd workers
npx wrangler d1 create cirtell-db
npx wrangler r2 bucket create cirtell-evidence
npx wrangler r2 bucket create cirtell-evidence-dev
```

Set production Worker secrets:

```bash
cd workers
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put JWT_SECRET
```

Apply remote D1 migrations:

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

Build and deploy Pages:

```bash
cd frontend
npm run build
npx wrangler pages deploy dist --project-name cirtell --branch main
```

Production URLs:

- App: https://cirtell.pages.dev
- API: https://cirtell-api.hanguyenngan928.workers.dev

## API Surface

Core API groups:

| Path | Purpose |
| --- | --- |
| `/api/auth` | Google SSO validation, session, logout, current user |
| `/api/parts` | Parts catalog CRUD, vendor lookup, bulk import |
| `/api/transactions` | Transaction workflows, line items, references, PO files |
| `/api/warehouses` | Warehouses, inventory, zones, stock movements |
| `/api/projects` | Project workspace, materials, evidence, logistics, financials, reports |
| `/api/admin` | Platform administration, users, tenants, companies, audit log |
| `/api/ghg` | Carbon accounting and GHG reporting |
| `/api` | Dashboard and headline metrics |
| `/health` | Worker health check |

## Data Ownership

Cirtell is tenant and company scoped. Platform administrators can manage groups, companies, users, and audit activity, while normal users operate within their assigned tenant/company context.

Project evidence files are stored in R2. D1 stores the evidence metadata and protected download route references.

## Development Notes

- Do not describe Cirtell as a derivative of another platform in product docs or user-facing copy.
- Keep Cirtell documentation focused on its own workflows, deployment, security model, and data model.
- Run checks before deployment:

```bash
cd workers
npx tsc --noEmit

cd ../frontend
npm run build
npx eslint src/pages/PartsPage.tsx src/pages/ProjectsPage.tsx
```
