# Cirtell Frontend

This is the React frontend for Cirtell, a standalone circular telecom asset platform. The app is designed and documented as a complete Cirtell product with its own workflows and deployment.

## Stack

- React 19
- TypeScript
- Vite
- Tailwind CSS utilities
- Zustand for auth/session state
- Cloudflare Pages deployment

## Main Areas

- Dashboard
- Parts Catalog with CSV/XLSX import
- Transactions
- Warehouse
- Projects with Materials & Assets import and R2-backed evidence
- Carbon reporting
- Administration

## Environment

Create `frontend/.env`:

```text
VITE_API_URL=http://localhost:8787
VITE_GOOGLE_CLIENT_ID=<google-oauth-client-id>
```

For production builds, `VITE_API_URL` should point to the deployed Cirtell Worker API.

## Commands

```bash
npm install
npm run dev
npm run build
npm run lint
```

## Deployment

```bash
npm run build
npx wrangler pages deploy dist --project-name cirtell --branch main
```

The production Pages site is:

```text
https://cirtell.pages.dev
```

## Documentation Rule

Keep frontend labels, help text, and README content Cirtell-specific. If a feature exists in Cirtell, document it as a Cirtell feature.
