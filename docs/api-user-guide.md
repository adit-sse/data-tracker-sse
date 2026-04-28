# Ingestion API guide

Automated workflows call three **`POST`** endpoints under `/api/ingestion/*`. They create and update **non-metered** coverage rows (`PENDING` → `CONFIRMED`, `INFERRED_EMPTY`, or `ERROR`).

**Base URL:** your deployed origin (for example `https://your-app.example.com`) or `http://localhost:3000` for local dev.

| Placeholder | Meaning |
|-------------|---------|
| `BASE_URL` | Origin only, no trailing slash |
| `INGESTION_API_KEY` | Server secret; must match `INGESTION_API_KEY` in the app environment (see `.env.local.example`). Never commit it or paste it into shared docs |

---

## Authentication

Every ingestion request must send:

```http
Authorization: Bearer <INGESTION_API_KEY>
Content-Type: application/json
```

These routes **do not** use browser session cookies. A wrong or missing key returns **`401`** with `{ "error": "Unauthorized" }`.

```bash
# Load the key from your private environment; do not hard-code in committed scripts:
export INGESTION_API_KEY='...'
```

```bash
-H "Authorization: Bearer ${INGESTION_API_KEY}"
```

---

## Concepts

- **Group mode:** One invoice covers **several facilities** under the same client + supplier + **group-level** utility type (for example “Transport Fuels”). You must configure a **facility group** in the app first; ingestion resolves it via `client_name`, `supplier_name`, and `utility_name` (the group’s category name).
- **Line mode (`mode: "line"`):** One **site** (or client-wide Scope 3) + supplier + **record-level** utility name (for example `GREASE`). No facility group. Line **pending** can create a missing utility category; group **pending** expects the group to exist.
- **Fiscal year:** July → June. **`pending`** seeds **`PENDING`** rows for months in the **current fiscal year through today** (see app code for exact rules).
- **Names:** Client and supplier are matched **case-insensitively**. Facility names in **confirm** must match the tracker (group: member facility name; line: resolved site).

For setup (clients, facilities, groups, categories) use the tracker UI or see [api-facilities-utilities-guide.md](./api-facilities-utilities-guide.md).

---

## `POST /api/ingestion/pending`

Creates **`PENDING`** `non_metered_records` where nothing blocking already exists for that facility + category + month (and related guards in code).

### Group body

```json
{
  "client_name": "Client display name",
  "supplier_name": "Supplier display name",
  "utility_name": "Group-level utility category name"
}
```

**Typical response:** `{ "created": <n>, "skipped": <n> }`.  
**Errors:** `400` validation, `401`, `404` (missing client/supplier/group), `422` (no members with per-site categories).

### Line body

`facility_name` is required for Scope 1/2; for Scope 3 it may be omitted or use client-wide labels per app logic.

```json
{
  "mode": "line",
  "client_name": "...",
  "supplier_name": "...",
  "utility_name": "Record category name",
  "facility_name": "Site name"
}
```

**Typical response:** includes `mode`, `resolved` (`facility_id`, `facility_name`, `supplier_id`, `input_type_id`), `created`, `skipped`.

### curl — group

```bash
curl -sS -X POST "${BASE_URL}/api/ingestion/pending" \
  -H "Authorization: Bearer ${INGESTION_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "client_name":"Your Client Name",
    "supplier_name":"Your Supplier Name",
    "utility_name":"Transport Fuels"
  }'
```

### curl — line

```bash
curl -sS -X POST "${BASE_URL}/api/ingestion/pending" \
  -H "Authorization: Bearer ${INGESTION_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "mode":"line",
    "client_name":"Your Client Name",
    "supplier_name":"Your Supplier Name",
    "utility_name":"GREASE",
    "facility_name":"Site A"
  }'
```

---

## `POST /api/ingestion/confirm`

Turns **`PENDING`** into **`CONFIRMED`** (with optional consumption/amount), **`INFERRED_EMPTY`** for group members missing from the invoice for that period, and removes **`PENDING`** for months **not** present in the payload (for that group or line context).

**NGERS-style fields** the route reads:

| Field | Role |
|-------|------|
| `Company` | Client name |
| `Facility` | Site name |
| `Provider` | Supplier name |
| `Category` | Group utility type (group mode) or record utility (line mode) |
| `Date Range` | `"DD/MM/YYYY - DD/MM/YYYY"` |
| `Consumption` | Number (summed per period/facility) |
| `Amount ($)` | Number (summed) |

Other columns may exist; they are ignored unless used elsewhere.

### Group body — JSON **array** of rows

```bash
curl -sS -X POST "${BASE_URL}/api/ingestion/confirm" \
  -H "Authorization: Bearer ${INGESTION_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '[
    {
      "Company":"Your Client Name",
      "Facility":"Site A",
      "Provider":"Your Supplier Name",
      "Category":"Transport Fuels",
      "Consumption":1000,
      "Amount ($)":5000,
      "Date Range":"01/02/2026 - 28/02/2026"
    }
  ]'
```

**Typical response:** `{ "mode": "group", "confirmed", "inferred_empty", "deleted_pending", "warnings": [] }`.

### Line body — object with `rows`

```bash
curl -sS -X POST "${BASE_URL}/api/ingestion/confirm" \
  -H "Authorization: Bearer ${INGESTION_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "mode":"line",
    "rows":[
      {
        "Company":"Your Client Name",
        "Facility":"Site A",
        "Provider":"Your Supplier Name",
        "Category":"GREASE",
        "Consumption":42.5,
        "Amount ($)":1200,
        "Date Range":"01/03/2026 - 31/03/2026"
      }
    ]
  }'
```

**Typical response:** `{ "mode": "line", "confirmed", "inferred_empty", "deleted_pending", "warnings": [] }`.

**`warnings`:** skipped rows (unknown client, facility not in group, bad date range, etc.) without failing the whole request.

---

## `POST /api/ingestion/error`

Sets **`PENDING`** → **`ERROR`** for the **calendar month** taken from the **start** date of `date_range` (first day of that month as period key).

`date_range` must be `"DD/MM/YYYY - DD/MM/YYYY"`.

### Group body

```bash
curl -sS -X POST "${BASE_URL}/api/ingestion/error" \
  -H "Authorization: Bearer ${INGESTION_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "client_name":"Your Client Name",
    "supplier_name":"Your Supplier Name",
    "utility_name":"Transport Fuels",
    "date_range":"01/03/2026 - 31/03/2026"
  }'
```

### Line body

```bash
curl -sS -X POST "${BASE_URL}/api/ingestion/error" \
  -H "Authorization: Bearer ${INGESTION_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "mode":"line",
    "client_name":"Your Client Name",
    "supplier_name":"Your Supplier Name",
    "utility_name":"GREASE",
    "facility_name":"Site A",
    "date_range":"01/03/2026 - 31/03/2026"
  }'
```

**Typical response:** includes `updated` (count) and `period_start_date`, or a message when there were no **`PENDING`** rows for that month.

---

## End-to-end flows

**Group invoice**

1. **`POST .../pending`** with `client_name`, `supplier_name`, `utility_name` (group-level category).
2. After a successful parse, **`POST .../confirm`** with the NGERS row **array**.
3. On failure for a period, **`POST .../error`** with the same identifiers plus `date_range`.

**Single line (no group)**

1. **`POST .../pending`** with `mode: "line"` and `utility_name` = record category.
2. **`POST .../confirm`** with `{ "mode": "line", "rows": [ ... ] }`.
3. **`POST .../error`** with `mode: "line"` when needed.

**Confirm** drops **`PENDING`** rows for months **not** in that confirm payload for the same group or line context. Run **pending** again if you need those amber months back.

---

## Metered utilities (`actual_invoices`)

Same **`INGESTION_API_KEY`** auth. Targets **metered** utility categories only (`utility_categories.is_metered = true`). The **meter must already exist** in the tracker (facility + category + identifiers).

States on `actual_invoices.status`: **`PENDING`** (placeholder row, full calendar month), **`CONFIRMED`** (after confirm — **exact** `period_start_date` / `period_end_date` from `Date Range`), **`ERROR`** (after error).

Coverage treats **`PENDING`** and **`ERROR`** like gaps (they do not fill days); **`CONFIRMED`** counts like other final data.

### `POST /api/ingestion/metered/pending`

Body: `client_name`, `supplier_name`, `utility_name` (category name), `facility_name`, `identifier_type`, `lookup1`, optional `lookup2`.

Seeds one **`PENDING`** invoice per fiscal month (Jul → current month) that is still empty for that meter.

```bash
curl -sS -X POST "${BASE_URL}/api/ingestion/metered/pending" \
  -H "Authorization: Bearer ${INGESTION_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "client_name":"Your Client Name",
    "supplier_name":"Your Supplier Name",
    "utility_name":"Electricity",
    "facility_name":"Site A",
    "identifier_type":"NMI",
    "lookup1":"1234567890123",
    "lookup2":null
  }'
```

### `POST /api/ingestion/metered/confirm`

Body: `{ "rows": [ NGERS-style objects ] }`. Each row needs **`Company`**, **`Facility`**, **`Provider`**, **`Category`**, **`Date Range`** (`DD/MM/YYYY - DD/MM/YYYY` — stored as the **exact** ISO period), **`Consumption`**, **`Amount ($)`**, and a meter id: **`NMI`**, **`MIRN`**, **`Account Number`**, or **`Meter Number`** (optional **`Input Type`** for `lookup2`). Optional: **`Invoice Number`**, **`Invoice Date`**, **`Framework`**, **`Version`**, **`Customer`**.

Updates the **`PENDING`** row for that meter + calendar month to **`CONFIRMED`** with the precise dates and amounts. Deletes other FY **`PENDING`** rows for that meter that are not in this payload.

```bash
curl -sS -X POST "${BASE_URL}/api/ingestion/metered/confirm" \
  -H "Authorization: Bearer ${INGESTION_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "rows":[
      {
        "Company":"Your Client Name",
        "Facility":"Site A",
        "Provider":"Your Supplier Name",
        "Category":"Electricity",
        "NMI":"1234567890123",
        "Consumption":15000,
        "Amount ($)":3200,
        "Date Range":"05/02/2026 - 28/02/2026"
      }
    ]
  }'
```

### `POST /api/ingestion/metered/error`

Body: same identifiers as **metered pending**, plus **`date_range`** (`DD/MM/YYYY - DD/MM/YYYY`; month taken from **start**). Sets matching **`PENDING`** → **`ERROR`** for that month.

```bash
curl -sS -X POST "${BASE_URL}/api/ingestion/metered/error" \
  -H "Authorization: Bearer ${INGESTION_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "client_name":"Your Client Name",
    "supplier_name":"Your Supplier Name",
    "utility_name":"Electricity",
    "facility_name":"Site A",
    "identifier_type":"NMI",
    "lookup1":"1234567890123",
    "date_range":"01/03/2026 - 31/03/2026"
  }'
```

---

## Related docs

- **[ingestion-test-subject.md](./ingestion-test-subject.md)** — isolated sandbox client + seed script for safe API testing.
- **[api-facilities-utilities-guide.md](./api-facilities-utilities-guide.md)** — facility groups, categories, and how this ties to the rest of the app.
- **[ingestion-demo-commands.md](./ingestion-demo-commands.md)** — PowerShell examples; use **`${INGESTION_API_KEY}`** (or env) instead of inlined secrets.

**Implementation (non-metered):** `app/api/ingestion/pending/route.ts`, `confirm/route.ts`, `error/route.ts`.

**Implementation (metered):** `app/api/ingestion/metered/pending/route.ts`, `metered/confirm/route.ts`, `metered/error/route.ts`, `lib/ingestion-metered.ts`.