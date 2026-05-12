# Quick start

Short path to a running app. Full detail is in [README.md](README.md).

## Prerequisites

- Node.js 18+  
- Supabase project  

## 1. Install

```bash
cd invoice-tracker
npm install
```

## 2. Database

1. Open Supabase **SQL Editor**.  
2. Apply migrations from [`supabase/migrations/`](supabase/migrations/) **in numeric order** (`001` … `010`). See the table in README for what each file does.  
3. Do **not** rely on root `supabase-init.sql` as your schema—it is an outdated UUID starter and does not match the migration chain.

If you do not already have the pre-migration baseline these files expect, get a schema export or baseline script from your team before applying.

## 3. Auth bootstrap

1. Enable **Authentication** (e.g. Email) in Supabase.  
2. After migration `002`, create at least one user in the dashboard.  
3. Promote and assign clients (SQL examples are in comments at the bottom of `002_auth_rls_membership.sql`):  
   - insert into `app_admins` for operators who manage membership / clients;  
   - insert into `client_members` so users can read/write data for specific `client_id`s.

## 4. Environment

```bash
cp .env.local.example .env.local
```

Fill in:

- `NEXT_PUBLIC_SUPABASE_URL`  
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` (publishable or anon — **not** the secret key)  
- `SUPABASE_SECRET_KEY` for server-side ingestion / admin DB paths  
- `INGESTION_API_KEY` if you call `/api/ingestion/*`  

## 5. Run

```bash
npm run dev
```

Visit `http://localhost:3000`. You should be sent to **`/login`** until you sign in.

## 6. Smoke test

1. Sign in as a user with `client_members` (or an app admin).  
2. Open a client (or create one if your role allows).  
3. Add a facility and try **Upload Invoices** with data that matches current column expectations (see README / upload errors).  
4. Confirm coverage widgets load without API errors.

## Troubleshooting

| Symptom | Check |
| ------- | ----- |
| Always at login | Credentials, Auth provider, cookies |
| 401 on APIs | Session missing; middleware requires user |
| Empty lists / RLS errors | `client_members` rows for your user |
| Import / ingestion failures | `INGESTION_API_KEY`, `SUPABASE_SECRET_KEY`, migration completeness |

Next: [README.md](README.md) for architecture, model overview, and migration reference.
