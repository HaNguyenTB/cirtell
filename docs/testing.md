# Cirtell Testing Guide

## Frontend E2E tests

Frontend E2E tests use Playwright and run against the Vite application. The tests do not call Google SSO or a live backend. Instead, they seed the browser session storage with a mock Cirtell user and intercept `/api/*` requests with deterministic route-level mock data.

Run from `frontend/`:

```powershell
npm run test:e2e
```

If Playwright reports that the Chromium executable is missing, install the browser once:

```powershell
npx playwright install chromium
```

Useful local command when developing tests:

```powershell
npm run test:e2e:ui
```

The current E2E scope covers:

- mocked login session and dashboard load;
- sidebar navigation to Parts, Transactions, Warehouse, Carbon, Projects, and Administration;
- Parts search and create flow;
- Transaction creation through the modal with a line item;
- Warehouse Receive movement through the inventory modal;
- Carbon entry creation and CO2e calculation display;
- Viewer RBAC checks that hide write controls and administration navigation.

Limitations:

- Google Identity Provider is mocked, so these tests do not validate the real SSO redirect flow.
- Backend persistence is mocked by Playwright route interception, so these tests validate frontend behavior and request/response integration contracts rather than Cloudflare D1 behavior.
- Full browser tests against a real local Workers backend should be added once the backend test database and auth bypass are standardized for local E2E runs.
