# Cirtell

Lightweight carbon accounting & telecom parts management platform.  
Built on **Cloudflare Workers + D1** (same architecture as Cirveris, simplified to single-tenant).

## Features

- **Parts Catalog** — CRUD for telecom equipment parts with vendor tracking
- **Transactions** — Purchase / Sale / Redeploy / Recycle movement tracking
- **Carbon Accounting** — GHG Protocol Scope 1/2/3 emission entries & reporting
- **Dashboard** — Headline KPIs (value, reuse rate, CO₂e)
- **Auth** — Google SSO with JWT verification

## Project Structure

```
cirtell/
  workers/          # Cloudflare Workers API (Hono + D1)
    src/
      index.ts      # Entry point
      routes/       # API routes (auth, parts, transactions, carbon, dashboard)
      middleware/   # Auth, permissions, rate limiting
      utils/        # Error handling
    migrations/     # D1 SQL migrations
    wrangler.toml   # Cloudflare config
```

## Getting Started

### Prerequisites

- Node.js 18+
- Cloudflare account (free tier works)
- Google Cloud Console project (for OAuth)

### Setup

```bash
cd workers
npm install

# Create the D1 database
npx wrangler d1 create cirtell-db
# Copy the database_id from output into wrangler.toml

# Apply migrations locally
npx wrangler d1 migrations apply cirtell-db --local

# Set secrets
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put JWT_SECRET

# Run locally
npx wrangler dev
```

### Seed an Admin User

```bash
npx wrangler d1 execute cirtell-db --local --command \
  "INSERT INTO users (id, email, name, role) VALUES ('admin-001', 'your@email.com', 'Your Name', 'Admin')"
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/validate` | Validate Google ID token |
| GET | `/api/auth/me` | Current user info |
| GET | `/api/parts` | List parts catalog |
| POST | `/api/parts` | Create a part |
| PUT | `/api/parts/:id` | Update a part |
| DELETE | `/api/parts/:id` | Delete a part |
| GET | `/api/transactions` | List transactions |
| POST | `/api/transactions` | Create transaction |
| PUT | `/api/transactions/:id` | Update transaction |
| DELETE | `/api/transactions/:id` | Delete transaction |
| GET | `/api/transactions/summary` | Transaction summary stats |
| GET | `/api/ghg/categories` | GHG Scope 3 category definitions |
| GET | `/api/ghg/entries` | List emission entries |
| POST | `/api/ghg/entries` | Create emission entry |
| DELETE | `/api/ghg/entries/:id` | Delete emission entry |
| GET | `/api/ghg/report` | Aggregated GHG report |
| GET | `/api/overview/headline` | Dashboard headline KPIs |
| GET | `/health` | Health check |

## Deployment

See instructions in the README for deploying to Cloudflare Workers.
