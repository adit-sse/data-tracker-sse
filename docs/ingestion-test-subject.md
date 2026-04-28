# Ingestion API test subject (sandbox)

Use this **only on a dev / staging** Supabase project (or when you accept extra rows in shared catalogs). It creates a dedicated **client** plus global **supplier**, **categories**, and **input types** whose names are prefixed with `[INGESTION TEST]` so they are easy to spot and avoid collisions with real display names.

Real **client** rows are untouched: all ingestion calls use the sandbox client name. Shared tables (`suppliers`, `categories`, `input_types`) gain a few rows with the test prefix; delete the sandbox **client** when done (see teardown); optional SQL removes the catalog rows if nothing else references them.

## Canonical names (copy into API bodies)

| Role | Exact string |
|------|----------------|
| Client (`client_name`, `Company`) | `[INGESTION TEST] Sandbox Client` |
| Supplier (`supplier_name`, `Provider`) | `[INGESTION TEST] Sandbox Supplier` |
| **Group** reporting category (`utility_name` for group pending/error; `Category` on NGERS rows for group confirm) | `[INGESTION TEST] Sandbox Transport` |
| Group facility A (`Facility`) | `[INGESTION TEST] Group Site Alpha` |
| Group facility B | `[INGESTION TEST] Group Site Beta` |
| **Line** facility (`facility_name`, `Facility` for line flows) | `[INGESTION TEST] Line Only Site` |
| **Line** utility (`utility_name` for line pending/error; `Category` on line confirm) | `[INGESTION TEST] Sandbox Standalone Utility` |
| **Metered** utility (must be `is_metered`; use metered pending/confirm/error only) | `[INGESTION TEST] Sandbox Test Electricity` |
| Test NMI string (metered `lookup1` / row `NMI`) | `999000111222333` |

Per-facility **input types** under the group (members’ lines; not sent as `utility_name` to group pending — the API uses the **reporting** category name above):

- `[INGESTION TEST] Sandbox Fuel Alpha` (Site Alpha)
- `[INGESTION TEST] Sandbox Fuel Beta` (Site Beta)

## Seed and teardown

Requires **`NEXT_PUBLIC_SUPABASE_URL`** and **`SUPABASE_SERVICE_ROLE_KEY`** (service role bypasses RLS; same vars as server-side admin).

```bash
# Create or refresh sandbox (deletes existing sandbox client first, then recreates)
node scripts/seed-ingestion-test-subject.mjs --force

# First-time create (fails if sandbox client already exists — use --force)
node scripts/seed-ingestion-test-subject.mjs

# Remove sandbox client (cascades facilities, groups, lines tied to that client)
node scripts/seed-ingestion-test-subject.mjs --teardown
```

The script prints a short **manifest** (IDs and names) and example **`curl`** snippets for `pending` / `confirm` / `error` (non-metered group + line + metered).

After `--teardown`, you may still have orphan **`[INGESTION TEST]`** rows in `suppliers`, `categories`, and `input_types`. That is harmless for retesting (the seed script reuses them). To remove them manually, delete by exact name in the Supabase SQL editor when no other data references those rows.

## Auth for API calls

Use **`INGESTION_API_KEY`** as in [api-user-guide.md](./api-user-guide.md):

```http
Authorization: Bearer <INGESTION_API_KEY>
Content-Type: application/json
```

## Safety notes

- **`--force`** deletes the client named `[INGESTION TEST] Sandbox Client` only. If you renamed that client in the UI, teardown will not remove it.
- Do not reuse these display names for production clients/suppliers, or resolution may match the wrong row (`ilike` / exact name lookups).
- Full ingestion API reference: [api-user-guide.md](./api-user-guide.md).
