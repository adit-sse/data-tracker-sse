# Invoice Tracker — Project Overview

## Purpose

A Next.js application for utility and emissions-related invoice tracking: metered accounts (NMI, MIRN, account numbers, …), non-metered Scope 1 / Scope 3 activity, facility groups for multi-site invoices, CSV/XLSX import, and July–June fiscal coverage dashboards with gap visualization.

## Feature areas

1. **Clients and facilities** — Multi-tenant data partitioned by client; RLS enforces membership.  
2. **Reference data** — Suppliers; **input types** (specific fuels/inputs); **categories** (NGERS-style groups for Scope 1 & 3).  
3. **Metered path** — Meters → `actual_invoices`; coverage by calendar days in period.  
4. **Non-metered path** — `non_metered_lines` (registered lines), `non_metered_records`, statuses including pending / inferred / deactivated; **facility groups** tie lines that share an invoice.  
5. **Import** — Client-scoped upload API with scope-aware column handling (`Category` / `Input Type` / reporting category, etc.).  
6. **Auth** — Supabase Auth; middleware protects pages and most APIs; `/login` for password sign-in; ingestion routes use separate API key + service client.

## Technology

| Layer | Choice |
| ----- | ------ |
| UI | Next.js 14 App Router, React 18, TypeScript, Tailwind |
| API | Next.js route handlers under `app/api/` |
| Database | Supabase Postgres |
| Auth & session | `@supabase/ssr` (middleware + server + browser clients) |
| Automation | `/api/ingestion/*` + `SUPABASE_SECRET_KEY` + `INGESTION_API_KEY` |

## Repository layout

| Path | Role |
| ---- | ---- |
| `app/page.tsx` | Home — client list |
| `app/clients/[id]/` | Client dashboard, upload, facilities, meters, invoices, debug |
| `app/login/` | Email/password sign-in |
| `app/api/clients/` | Clients, facilities, coverage, upload, facility groups, invoices, … |
| `app/api/input-types`, `categories`, `utility-categories` | Reference CRUD / aliases as implemented |
| `app/api/meters`, `facilities`, `suppliers`, `non-metered-*` | Domain APIs |
| `app/api/ingestion/` | External/automation ingestion (middleware bypass for auth; uses own secrets) |
| `components/` | Cards, coverage tables (metered / non-metered), modals, upload, reference managers |
| `lib/supabase/` | `client.ts`, `server.ts`, `service.ts`, `guard-public-key.ts` |
| `lib/coverage.ts` | Fiscal-month coverage calculations |
| `lib/ingestion-*.ts`, `non-metered-lines.ts`, … | Pipeline helpers |
| `types/index.ts` | Shared interfaces (`InputType`, `Category`, `Meter`, …) |
| `supabase/migrations/` | **Canonical** ordered schema + RLS |

## Database — concepts

Do **not** treat the root `supabase-init.sql` as current; it describes an old UUID-centric sketch. The live model is defined **incrementally** in `supabase/migrations/` (see README table for order).

Conceptual tables after migrations:

- **Org**: `clients`, `facilities`, `suppliers`  
- **Classification**: `input_types` (was `utility_categories`), `categories` (UUID, Scope 1 & 3 groupings)  
- **Metered**: `meters` (`input_type_id`, optional `category_id`, `is_active`), `actual_invoices`  
- **Non-metered**: `non_metered_lines`, `non_metered_records`, `facility_groups`, `facility_group_members`  
- **Auth / ACL**: `profiles`, `app_admins`, `client_members` + RLS on domain tables  

JavaScript types often use `string` for IDs because Postgres integers and UUIDs are serialized as strings in JSON.

## Coverage logic (summary)

For each tracked line (meter or non-metered line), invoices contribute covered days per fiscal month; overlaps merge; gaps feed tooltips; deactivated-only days can reduce the effective denominator (`lib/coverage.ts`, client pages).

## API surface (grouped)

- **Clients**: `GET/POST /api/clients`, `GET/PUT/DELETE /api/clients/[id]`  
- **Facilities & meters**: `/api/clients/[id]/facilities`, `/api/clients/[id]/meters`, `/api/meters`, `/api/facilities/[id]`  
- **Coverage**: `/api/clients/[id]/coverage`, `.../coverage/years`, `.../coverage/non-metered`  
- **Upload**: `POST /api/clients/[id]/upload`  
- **Invoices**: `/api/clients/[id]/invoices`, …  
- **Facility groups**: `/api/clients/[id]/facility-groups`, `/api/facility-groups/[id]`, …  
- **Reference**: `/api/input-types`, `/api/categories`, `/api/suppliers`, …  
- **Ingestion**: `/api/ingestion/*` (pending, confirm, errors, metered paths, …)  

Exact contracts are in each `route.ts`.

## Page routes

- `/` — Home  
- `/login` — Sign in  
- `/clients/[id]` — Client hub  
- `/clients/[id]/upload` — File import  
- `/clients/[id]/facilities/new` — New facility  
- `/clients/[id]/meters/new` — New meter  
- `/clients/[id]/invoices/new` — New invoice (where implemented)  
- `/clients/[id]/debug` — Debug helpers  

## Development notes

- Extend types in `types/index.ts`; add `app/api/.../route.ts`; add UI under `app/` or `components/`.  
- Fiscal year helpers live in `lib/coverage.ts`; threshold styling in coverage components / Tailwind.  
- New identifier enums: align Postgres checks, upload parsing, and `IdentifierType` in `types/index.ts`.

## Deployment

- Configure all env vars from `.env.local.example` on the host (Vercel or other).  
- Ensure Supabase Auth redirect URLs allow your production domain if using hosted Auth flows beyond password sign-in.

## Documentation index

- **[README.md](README.md)** — Setup, migrations order, auth, env, troubleshooting  
- **[QUICKSTART.md](QUICKSTART.md)** — Short onboarding path  
- **`docs/`** — Supplemental guides (HTTP/n8n, facility utilities, etc.)
