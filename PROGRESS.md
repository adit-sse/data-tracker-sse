# Progress — 16 March 2026

## What was done today

### 1. Designed new ingestion states for Scope 1 unmetered records

Added three new statuses to `non_metered_records` on top of the existing `IMPORTED`, `MANUAL`, `INFERRED_EMPTY`:

| Status | Colour | Meaning |
|---|---|---|
| `PENDING` | Yellow | Invoice email received; date not yet confirmed |
| `ERROR` | Red | Ingestion workflow failed; manual fix needed |
| `CONFIRMED` | Green | Date confirmed from workflow output |
| `IMPORTED` | Green | Came in via CSV upload (unchanged) |
| `MANUAL` | Green | Entered manually (unchanged) |
| `INFERRED_EMPTY` | Grey | Invoice confirmed; this facility was absent from it |
| (no record) | Grey | No data |

**Full state machine:**
```
(no record)  ──[email received]────────────────────────────────→  PENDING
PENDING      ──[confirm: facility IN output for date]──────────→  CONFIRMED
PENDING      ──[confirm: facility ABSENT, others confirmed]────→  INFERRED_EMPTY
PENDING      ──[confirm: month not in invoice at all]──────────→  (deleted → no record)
PENDING      ──[ingestion error]─────────────────────────────→   ERROR
ERROR        ──[manual fix]────────────────────────────────────→  (resolve manually in UI)
```

The pending step only creates PENDING records for months that currently have **no record at all**. It never touches CONFIRMED, IMPORTED, MANUAL, INFERRED_EMPTY, or ERROR records.

---

### 2. Supabase database changes (already applied)

Run manually in the Supabase SQL editor. Saved for reference in case the schema needs to be recreated:

```sql
-- Add utility_category_id to facility_groups
ALTER TABLE public.facility_groups
  ADD COLUMN utility_category_id integer REFERENCES public.utility_categories(id);

ALTER TABLE public.facility_groups
  ADD CONSTRAINT facility_groups_unique
    UNIQUE (client_id, supplier_id, utility_category_id);

-- Expand status CHECK constraint on non_metered_records
ALTER TABLE public.non_metered_records
  DROP CONSTRAINT IF EXISTS non_metered_records_status_check;

ALTER TABLE public.non_metered_records
  ADD CONSTRAINT non_metered_records_status_check
    CHECK (status IN (
      'IMPORTED', 'INFERRED_EMPTY', 'MANUAL', 'PENDING', 'ERROR', 'CONFIRMED'
    ));
```

---

### 3. TypeScript type updates (`types/index.ts`)

- `NonMeteredStatus` expanded to include `'PENDING' | 'ERROR' | 'CONFIRMED'`
- `FacilityGroup` gets `utility_category_id: string | null` and `utility_category?: UtilityCategory`

---

### 4. Two new API routes built (branch: `feature/ingestion-api`)

**`POST /api/ingestion/pending`**
- Body: `{ "client_name": "...", "supplier_name": "...", "utility_name": "..." }`
- Finds the group for that combination, creates PENDING records for all months in current FY
- Returns: `{ "created": N, "skipped": N }`

**`POST /api/ingestion/confirm`**
- Body: JSON array of NGERS output rows (the format the workflow already produces)
- Parses `Date Range` field to extract confirmed months
- Facilities in output → CONFIRMED; group members absent → INFERRED_EMPTY; unmatched PENDING months → deleted
- Returns: `{ "confirmed": N, "inferred_empty": N, "deleted_pending": N, "warnings": [...] }`

Both endpoints require the header: `Authorization: Bearer <INGESTION_API_KEY>`

---

## Where to pick up tomorrow

### Immediate next steps (in order)

**Step 1 — Add the API key to your environment**

Add this line to your `.env` file (make up a long random secret):
```
INGESTION_API_KEY=kYMHYor0QzncWaLS_qI1ID6gVqDHcH1QvBz6Xd3bHXE
```

**Step 2 — Deploy to Vercel**

1. Push the `feature/ingestion-api` branch to GitHub (or merge to main first)
2. Go to vercel.com → Add New Project → connect GitHub repo
3. Add all three environment variables in Vercel's settings:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `INGESTION_API_KEY`
4. Deploy — get your permanent URL (e.g. `invoice-tracker.vercel.app`)

**Step 3 — Test the pending endpoint**

Use Postman, curl, or your no-code tool to call:
```
POST https://your-app.vercel.app/api/ingestion/pending
Authorization: Bearer your-key
Content-Type: application/json

{
  "client_name": "Camco Engineering",
  "supplier_name": "Elgas",
  "utility_name": "Liquefied petroleum gas (LPG)"
}
```
You should get `{ "created": N, "skipped": 0 }` and see PENDING records appear in Supabase.

**Step 4 — Test the confirm endpoint**

Send the NGERS JSON output array to:
```
POST https://your-app.vercel.app/api/ingestion/confirm
Authorization: Bearer your-key
Content-Type: application/json
```
Check Supabase that the right records became CONFIRMED / INFERRED_EMPTY.

**Step 5 — Update the UI to show the new colours**

The new statuses exist in the database and TypeScript types, but the `NonMeteredCoverageTable` component doesn't yet render PENDING (yellow), ERROR (red), or CONFIRMED (green) differently. That component needs to be updated to map the new status values to colours.

**Step 6 — Update facility group creation to include `utility_category_id`**

The existing facility group UI (`FacilityGroupManager` component and `POST /api/clients/[id]/facility-groups`) doesn't set `utility_category_id` yet. Without this, the new API endpoints can't find groups. This needs to be added to the group creation form.

---

## Key files changed today

| File | What changed |
|---|---|
| `types/index.ts` | Expanded `NonMeteredStatus`, added `utility_category_id` to `FacilityGroup` |
| `app/api/ingestion/pending/route.ts` | **New file** — pending endpoint |
| `app/api/ingestion/confirm/route.ts` | **New file** — confirm endpoint |
| Supabase DB | `facility_groups.utility_category_id` column + `non_metered_records` status constraint |

## Current git branch
`feature/ingestion-api`
