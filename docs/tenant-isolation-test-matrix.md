# Tenant Isolation Test Matrix

This matrix documents backend tests that prove Cirtell does not leak data across tenant/company boundaries. The automated suite is `workers/test/tenantIsolation.spec.ts` and uses Cloudflare Workers Vitest pool with a local D1 database.

Seed data:
- Tenant A, company A1, `user_a`, `admin_a`
- Tenant B, company B1, `user_b`, `admin_b`
- Parts, transactions, projects, warehouses, inventory, GHG entries, PO files, project vendors/technologies, project evidence, and audit log rows for both companies

| Endpoint / operation | Risk | Automated test approach | Expected result | Status |
|---|---|---|---|---|
| `GET /api/parts` | User A reads Company B parts by passing `company_id=company_b1`. | Request as User A with tampered query param. | Response contains Company A parts only; Company B parts are absent. | Pass |
| `GET /api/parts/:id` | User A reads a direct Company B part ID. | Request `part_b_router` as User A. | `404`. | Pass |
| `POST /api/parts` | User A inserts part into Company B using query/body `company_id`. | Request as User A with tampered query and body scope. | Row is created only in Company A scope; no Company B insert. | Pass |
| `GET /api/transactions` | User A reads Company B transactions by passing `company_id=company_b1`. | Request as User A with tampered query param. | Response contains Company A transactions only. | Pass |
| `GET /api/transactions/:id` | User A reads a direct Company B transaction ID. | Request `tx_b_existing` as User A. | `404`. | Pass |
| `POST /api/transactions` with foreign `part_id` | Transaction line references part outside scope. | User A posts transaction with `part_b_router`. | `400`, no transaction row is inserted. | Pass |
| `POST /api/transactions` with foreign warehouse | Transaction line references warehouse outside scope. | User A posts transaction with `destination_warehouse_id=wh_b_source`. | `400`, no transaction row is inserted. | Pass |
| `POST /api/transactions` with foreign `project_id` | Transaction is linked to project outside scope. | User A posts transaction with `project_id=project_b`. | `400`, no transaction row is inserted. | Pass |
| `POST /api/transactions/:id/po-upload` | User uploads PO into in-scope transaction. | User A uploads a PDF-like file to `tx_a_existing`. | `200`, metadata stored for Company A transaction. | Pass |
| `GET /api/transactions/:id/po-download` | User downloads PO belonging to Company B. | User A downloads `tx_b_existing` PO. | `404`. | Pass |
| `GET /api/projects` | User A reads Company B projects by passing `company_id=company_b1`. | Request as User A with tampered query param. | Response contains Company A projects only. | Pass |
| `GET /api/projects/:id` | User A reads a direct Company B project ID. | Request `project_b` as User A. | `404`. | Pass |
| `GET /api/projects/:id/evidence/:entryId/download` | User downloads evidence belonging to Company B. | User A requests `project_b/evidence_b/download`. | `404` before file access. | Pass |
| `GET /api/projects/:id/evidence` | Standalone evidence list endpoint. | Route inspection. Evidence is returned inside project detail bundle, not via a standalone list route. | Not applicable. | N/A |
| `POST /api/projects` with foreign warehouse | Project references warehouse outside scope. | User A posts project with `source_warehouse_id=wh_b_source`. | `400`, no project row is inserted. | Pass |
| `POST /api/projects` with foreign vendor | Project links vendor outside scope. | User A posts project with `vendor_ids=['telecom_vendor_b']`. | `400`, no project row is inserted. | Pass |
| `PUT /api/projects/:id` with foreign technology | Project links technology outside scope. | User A updates `project_a` with `technology_ids=['telecom_tech_b']`. | `400`, no cross-scope link is inserted. | Pass |
| `GET /api/warehouses/inventory/all` | User A reads Company B inventory by passing `company_id=company_b1`. | Request as User A with tampered query param. | Response contains Company A inventory only. | Pass |
| `GET /api/warehouses/:id` | User A reads a direct Company B warehouse ID. | Request `wh_b_source` as User A. | `404`. | Pass |
| `POST /api/warehouses/inventory/move` | Movement references warehouse outside scope. | User A transfers stock from Company A warehouse to `wh_b_source`. | `400 WAREHOUSE_NOT_FOUND`; no manual movement is inserted. | Pass |
| `GET /api/ghg/report` | User A reads Company B carbon totals by passing `company_id=company_b1`. | Request as User A with tampered query param. | Report totals match Company A only. | Pass |
| `POST /api/ghg/entries` | User A inserts GHG entry into Company B by passing query/body scope. | Request as User A with tampered query and body scope. | Row is created only in Company A scope; no Company B insert. | Pass |
| `GET /api/overview/headline` | Dashboard aggregates Company B data into User A response. | Request as User A with `company_id=company_b1`. | KPI values match Company A only. | Pass |
| `GET /api/admin/audit-log` | Admin A reads Tenant B audit events. | Request as Admin A with `tenant_id=tenant_b`. | Response contains Tenant A audit only. | Pass |

Notes:
- For normal non-super-admin users, unsupported `company_id` query tampering is clamped to the user's assigned company by `resolveTenantScope`; write tests assert that no data is inserted into the foreign company.
- Direct object access outside scope is hidden as `404` where the route loads a specific resource by ID.
- Cross-scope references in transaction, inventory, and project write paths are rejected before insert/update.
