# Cirtell Mermaid Diagrams

This repository keeps report diagrams as Mermaid source files and renders them to PDF for LaTeX.

## Paths

- Mermaid sources: `latex/diagrams/mermaid/*.mmd`
- Rendered PDFs: `latex/diagrams/rendered/*.pdf`
- Render script: `scripts/render-mermaid.mjs`
- Mermaid theme: `latex/diagrams/mermaid/mermaid.config.json`
- LaTeX macro: `\diagramfigure` in `latex/preamble.tex`

The prompt history may refer to `report/diagrams/...`; the current repository convention is `latex/diagrams/...`.

## Editing Workflow

1. Edit the relevant `.mmd` file under `latex/diagrams/mermaid`.
2. Keep labels short enough to fit on A4. Prefer a second node over a long sentence.
3. Run a syntax check:

   ```powershell
   npm run diagrams:check
   ```

4. Render all diagrams:

   ```powershell
   npm run diagrams:render
   ```

5. Build the report from `latex/`:

   ```powershell
   pdflatex -shell-escape -interaction=nonstopmode -halt-on-error main.tex
   pdflatex -shell-escape -interaction=nonstopmode -halt-on-error main.tex
   ```

## Style Rules

- Use the shared Mermaid config for font and spacing.
- Use a small, print-friendly palette: light backgrounds, dark text, clear borders.
- Use consistent module names:
  - Parts Catalog
  - Transactions
  - Warehouse/Inventory
  - Project Lifecycle
  - Carbon Accounting
  - Dashboard
  - Administration
  - Tenant/company scope
  - Audit log
- Keep backend responsibility in the Application/API Layer. Tenant isolation, RBAC, audit writes, D1 access, and R2 access must not be shown as frontend-only behavior.
- Use `Cloudflare D1` in architecture diagrams and concrete database names like `cirtell-db` only in deployment diagrams.
- Do not show real secret values. Deployment diagrams may show variable names such as `GOOGLE_CLIENT_ID`, `JWT_SECRET`, `FRONTEND_URL`, and `CORS_ALLOWED_ORIGINS`.

## Diagram Inventory

| Mermaid source | Rendered PDF | Current LaTeX status |
| --- | --- | --- |
| `02-to-be-process.mmd` | `02-to-be-process.pdf` | Included in Chapter 2 |
| `03-usecase-overview.mmd` | `03-usecase-overview.pdf` | Included in Chapter 3 |
| `03-usecase-auth-admin.mmd` | `03-usecase-auth-admin.pdf` | Included in Chapter 3 |
| `03-usecase-parts-transactions.mmd` | `03-usecase-parts-transactions.pdf` | Included in Chapter 3 |
| `03-usecase-warehouse-inventory.mmd` | `03-usecase-warehouse-inventory.pdf` | Included in Chapter 3 |
| `03-usecase-project-evidence.mmd` | `03-usecase-project-evidence.pdf` | Included in Chapter 3 |
| `03-usecase-carbon-dashboard.mmd` | `03-usecase-carbon-dashboard.pdf` | Included in Chapter 3 |
| `03-sequence-login-3layer.mmd` | `03-sequence-login-3layer.pdf` | Included in Chapter 3 |
| `03-sequence-transaction-3layer.mmd` | `03-sequence-transaction-3layer.pdf` | Included in Chapter 3 |
| `03-sequence-project-3layer.mmd` | `03-sequence-project-3layer.pdf` | Included in Chapter 3 |
| `03-architecture.mmd` | `03-architecture.pdf` | Included in Chapter 3 |
| `03-class-tenant-auth.mmd` | `03-class-tenant-auth.pdf` | Included in Chapter 3 |
| `03-class-assets-transactions-inventory.mmd` | `03-class-assets-transactions-inventory.pdf` | Included in Chapter 3 |
| `03-class-project-carbon.mmd` | `03-class-project-carbon.pdf` | Included in Chapter 3 |
| `03-erd-tenant-auth.mmd` | `03-erd-tenant-auth.pdf` | Included in Chapter 3 |
| `03-erd-parts-transactions.mmd` | `03-erd-parts-transactions.pdf` | Included in Chapter 3 |
| `03-erd-warehouse-inventory.mmd` | `03-erd-warehouse-inventory.pdf` | Included in Chapter 3 |
| `03-erd-project-core.mmd` | `03-erd-project-core.pdf` | Included in Chapter 3 |
| `03-erd-project-evidence-lookup.mmd` | `03-erd-project-evidence-lookup.pdf` | Included in Chapter 3 |
| `03-erd-carbon-control.mmd` | `03-erd-carbon-control.pdf` | Included in Chapter 3 |
| `03-activity-project.mmd` | `03-activity-project.pdf` | Included in Chapter 3 |
| `03-activity-carbon.mmd` | `03-activity-carbon.pdf` | Included in Chapter 3 |
| `03-activity-inventory.mmd` | `03-activity-inventory.pdf` | Included in Chapter 3 |
| `04-transaction-flow.mmd` | `04-transaction-flow.pdf` | Included in Chapter 3 because this repo currently has no Chapter 4 file |
| `04-deployment-cloudflare.mmd` | `04-deployment-cloudflare.pdf` | Included in Chapter 3 because this repo currently has no Chapter 4 file |
| `03-erd-overview.mmd` | `03-erd-overview.pdf` | Legacy rendered asset; not included after ERD was split by module |

## LaTeX Include Pattern

Use the report macro instead of writing raw figure environments:

```tex
\diagramfigure[0.95]{diagrams/rendered/example.pdf}{Caption text.}{fig:example}
```

For wide diagrams, prefer `0.90` to `0.95` width first. Split the diagram if the PDF remains unreadable.
