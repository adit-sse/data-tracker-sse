# Ingestion API test subject (sandbox)

Use this **only on a dev / staging** Supabase project (or when you accept extra rows in shared catalogs). It creates **Test Client**, suppliers **BFcards** and **Agas national**, and several **`[INGESTION TEST]`**-prefixed **categories** and **input types** so fixtures are easy to spot and avoid collisions with real display names.

Real **production** data is unaffected **unless** you already have a client named **`Test Client`** or suppliers **`BFcards`** / **`Agas national`**—remove or rename those first on shared databases. Shared tables gain **BFcards**, **Agas national**, plus **`[INGESTION TEST]`** catalog rows; delete the sandbox **client** when done (see teardown); optional SQL removes orphan catalog rows if nothing else references them.

## Canonical names (copy into API bodies)

| Role | Exact string |
|------|----------------|
| Client (`client_name`, `Company`) | `Test Client` |
| Supplier (`supplier_name`, `Provider`) — BFcards (group + metered + one line) | `BFcards` |
| Supplier — **Agas national** standalone line demo only | `Agas national` |
| **Group** reporting category (`utility_name` for group pending/error; `Category` on NGERS rows for group confirm) | `[INGESTION TEST] Sandbox Transport` |
| Group facility A (`Facility`) | `[INGESTION TEST] Group Site Alpha` |
| Group facility B | `[INGESTION TEST] Group Site Beta` |
| **Line** facility (`facility_name`, `Facility` for line flows) | `[INGESTION TEST] Line Only Site` |
| **Line** utility — BFcards (`utility_name` / `Category`) | `[INGESTION TEST] Sandbox Standalone Utility` |
| **Line** utility — Agas national (`utility_name` / `Category`) | `[INGESTION TEST] Agas National Demo Utility` |
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

- **`--force`** / **`--teardown`** delete client rows whose **`name`** is exactly **`Test Client`**. If that collides with unrelated data, rename your sandbox client in the UI before teardown, or delete it manually.
- The seed **reuses** existing **`BFcards`** or **`Agas national`** supplier rows if those names already exist—use a clean dev DB or inspect **`suppliers`** after seeding.
- Full ingestion API reference: [api-user-guide.md](./api-user-guide.md).
