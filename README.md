# Invoice Tracking System

Next.js app for tracking utility and emissions-related invoices across clients and facilities: metered (electricity, gas, …) and non-metered Scope 1 / Scope 3 lines, facility groups for shared invoices, CSV/XLSX import, and fiscal-year coverage dashboards.

## Features

- Multi-client tracking with facilities, suppliers, and reference data management  
- **Metered** coverage: meters linked to `input_types`, optional NGERS **categories**  
- **Non-metered** coverage: `non_metered_lines`, records, facility groups, pending/inferred flows  
- CSV/XLSX bulk import with scope-aware validation (`Category`, `Input Type`, optional reporting category, etc.)  
- 12-month (July–June) coverage views, progress bars, gap tooltips, deactivated / pending handling  
- **Supabase Auth**: session cookies; unauthenticated users redirect to `/login`  
- Row Level Security (RLS) by client membership; optional ingestion API key + service role for automation  

## Tech stack

- **App**: Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS  
- **Data**: Supabase (PostgreSQL + Auth)  
- **Supabase clients**: `@supabase/ssr` — browser client (`lib/supabase/client.ts`), cookie-based server client (`lib/supabase/server.ts`), service-role client for trusted server paths (`lib/supabase/service.ts`)  
- **Parsing**: Papa Parse (CSV), XLSX  
- **Dates**: date-fns  

## Prerequisites

- Node.js 18+  
- Supabase project with Auth enabled  
- npm  

---

## Setup

### 1. Clone and install

```bash
cd invoice-tracker
npm install
```

### 2. Database schema (source of truth)

**Use the ordered SQL in [`supabase/migrations/`](supabase/migrations/)**, not the legacy `supabase-init.sql` at the repo root.

The migrations evolve an existing relational schema (integer primary keys on core tables, `utility_categories` later renamed to **`input_types`**, new **`categories`** table for NGERS groupings, non-metered tables, RLS, etc.). Applying them in order keeps the database aligned with the application code.

| Order | File | Summary |
| ----- | ---- | ------- |
| 1 | `001_scope_expansion.sql` | Scope / metered flags on lookup table; `facility_groups`, `facility_group_members`, `non_metered_records` |
| 2 | `002_auth_rls_membership.sql` | `profiles`, `app_admins`, `client_members`; RLS policies |
| 3 | `003_non_metered_deactivated_status.sql` | Extended `non_metered_records` status values |
| 4 | `004_non_metered_lines.sql` | `non_metered_lines` registration table |
| 5 | `005_meters_is_active.sql` | `meters.is_active` |
| 6 | `006_non_metered_lines_is_active.sql` | `non_metered_lines.is_active` |
| 7 | `007_non_metered_lines_sub_category.sql` | Line-level sub-category (superseded by `008` for lines) |
| 8 | `008_rename_utility_categories_to_input_types.sql` | **`categories`**; rename **`utility_categories` → `input_types`**; FK column renames; `category_id` on meters/lines |
| 9 | `009_non_metered_records_created_at.sql` | `non_metered_records.created_at` |
| 10 | `010_actual_invoices_created_at.sql` | `actual_invoices.created_at` |

Run each file **once**, in numeric order, in the Supabase SQL Editor (or your migration runner), against a database that already matches the **pre-001** baseline your team uses.

**Important**

- Root **`supabase-init.sql`** is an **outdated UUID-based starter**. It does **not** match the migration chain (types, keys, and table names differ). Do not follow README-only DDL from older copies of this file; you will get a database the code does not expect.  
- If you have an **empty** Supabase project and no shared baseline dump, coordinate with the team for a full baseline or an export—do not assume `supabase-init.sql` + migrations composes cleanly without manual fixes.  

Optional: `supabase-migration-mirn.sql` adds the `MIRN` meter identifier check if you maintain an older DB without it.

### 3. Supabase Auth and access control

1. In Supabase **Authentication**, enable Email (or your chosen provider). Consider disabling public sign-up if users are provisioned by admins.  
2. After **`002_auth_rls_membership.sql`**, bootstrap access (SQL Editor), for example:  
   - Create a user under **Authentication → Users**.  
   - `INSERT INTO public.app_admins (user_id) VALUES ('<auth-user-uuid>');`  
   - `INSERT INTO public.client_members (user_id, client_id) VALUES ('<auth-user-uuid>', <client_id>);`  
3. See comments at the bottom of `002_auth_rls_membership.sql` for the full pattern.

### 4. Environment variables

```bash
cp .env.local.example .env.local
```

| Variable | Purpose |
| -------- | ------- |
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Publishable/anon key (browser + middleware + server user sessions) — **never** the secret/service key |
| `SUPABASE_SECRET_KEY` | Server-only service role (`sb_secret_…`) for ingestion / RLS bypass — never expose to the client |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional legacy JWT if you have not moved to secret keys |
| `INGESTION_API_KEY` | Bearer token for `/api/ingestion/*` routes |

`lib/supabase/guard-public-key.ts` rejects wiring the secret key into `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

### 5. Storage (optional)

For client logos: create a public bucket (e.g. `client-logos`), size and MIME limits as appropriate.

### 6. Run the dev server

```bash
npm run dev
```

Open `http://localhost:3000`. Without a session you are redirected to **`/login`**; after sign-in, `next` query param returns you to the requested path.

---

## Authentication and routing

- **`middleware.ts`** uses `createServerClient` from `@supabase/ssr` with request cookies, calls `auth.getUser()`, and:  
  - allows **`/login`** and **`/api/ingestion/*`** without a session;  
  - returns **401 JSON** for other `/api/*` without a user;  
  - **redirects** page requests to **`/login?next=…`** when unauthenticated.  
- **`/login`** uses `createSupabaseBrowserClient()` and `signInWithPassword`.  
- Authenticated API routes use **`createSupabaseServerClient()`** so RLS applies as the signed-in user.

---

## Project structure (high level)

```
invoice-tracker/
├── app/
│   ├── api/                    # REST handlers (clients, facilities, meters, coverage, input-types, categories, ingestion, …)
│   ├── clients/[id]/           # Client dashboard, upload, facilities, meters, invoices, debug
│   ├── login/                  # Sign-in
│   ├── layout.tsx
│   ├── page.tsx                # Home (client list)
│   └── globals.css
├── components/                 # UI (coverage tables, modals, upload, reference data, …)
├── lib/
│   ├── supabase/
│   │   ├── client.ts           # Browser Supabase client
│   │   ├── server.ts           # Cookie server client (RLS as user)
│   │   ├── service.ts          # Service role (trusted server only)
│   │   └── guard-public-key.ts
│   ├── coverage.ts             # Coverage math
│   └── ingestion-*.ts, …       # Import / pipeline helpers
├── types/index.ts              # Shared TS shapes
├── supabase/migrations/        # Ordered schema + RLS (canonical)
├── docs/                       # Additional guides (e.g. n8n, APIs)
└── package.json
```

---

## Data model (conceptual)

After all migrations:

- **`clients`**, **`facilities`**, **`suppliers`** — org structure and vendors  
- **`input_types`** — specific fuels/inputs (formerly `utility_categories`); scope, metered flags  
- **`categories`** — NGERS-style reporting groups (Scope 1 & 3); Scope 2 rows typically omit category at line level  
- **`meters`** — metered assets; `input_type_id`, optional `category_id`, `is_active`  
- **`actual_invoices`** — metered invoice periods  
- **`non_metered_lines`** — registered non-metered lines (like meters for coverage UI); `input_type_id`, optional `category_id`, `is_active`  
- **`non_metered_records`** — non-metered invoice periods / statuses  
- **`facility_groups`** / **`facility_group_members`** — supplier-level grouping for invoices covering multiple facilities/lines  
- **`profiles`**, **`app_admins`**, **`client_members`** — auth profiles and who sees which client data  

Exact columns and constraints live in the migration files.

---

## Usage

### Clients and facilities

Create clients (admins per RLS), open a client, add facilities and meters or non-metered lines as needed. Manage global **input types** and **categories** from the UI where exposed.

### Upload

Use **Upload Invoices** on a client. The importer expects columns aligned with the current pipeline—including **`Category`** (input-type column name in sheets; must match configured **input types**) and **`Input Type`** where applicable, plus facility, supplier, date range, and meter identifiers for metered rows. Unknown input types should be created in **Manage Input Types** before upload. See `sample-invoices.csv` only if it has been kept in sync with the importer; when in doubt, validate against the upload error messages and `app/api/clients/[id]/upload/route.ts`.

### Coverage

Client pages show fiscal-year coverage for metered and non-metered views; colors reflect coverage thresholds and gaps (see `lib/coverage.ts`).

---

## Troubleshooting

- **Redirect loop / always at login**: Check Auth users exist, cookies allowed, `NEXT_PUBLIC_*` keys correct.  
- **401 on `/api/*`**: Not logged in, or session expired; sign in again.  
- **RLS / empty data**: User missing from `client_members`, or not an `app_admins` row for admin-only actions.  
- **Ingestion failures**: `INGESTION_API_KEY`, `SUPABASE_SECRET_KEY`, and route paths under `/api/ingestion/*`.  
- **Schema errors**: Confirm migrations ran in order on the intended baseline; do not mix `supabase-init.sql` with migrations.

---

## Scripts

- `npm run dev` — development server  
- `npm run build` / `npm start` — production build  
- `npm run lint` — ESLint  
- `npm run seed:ingestion-test` — optional ingestion test seed (see script help)  

---

## License

MIT
