# Ingestion API guide

Automated workflows call **`POST`** endpoints under `/api/ingestion/*`. They create and update **non-metered** coverage rows through the lifecycle: `PENDING` → `CONFIRMED` or `INFERRED_EMPTY` or `ERROR`.

**Base URL:** your deployed origin (e.g. `https://your-app.example.com`) or `http://localhost:3000` for local dev.

| Placeholder | Meaning |
|-------------|---------|
| `BASE_URL` | Origin only, no trailing slash |
| `INGESTION_API_KEY` | Server secret; must match `INGESTION_API_KEY` in the app environment. Never commit or share it. |

---

## Authentication

Every ingestion request must send:

```http
Authorization: Bearer <INGESTION_API_KEY>
Content-Type: application/json
```

These routes **do not** use browser session cookies. A wrong or missing key returns **`401`** with `{ "error": "Unauthorized" }`.

---

## Concepts

- **Group mode:** One supplier invoices **several facilities** under the same client + supplier + NGERS **reporting category** (e.g. "Transport Fuels"). You must configure a **facility group** in the app first. Each member of the group has its own **Input Type** (e.g. "Diesel oil", "Ethanol").
- **Line mode (`mode: "line"`):** A single facility + supplier + **Input Type** (e.g. "kL", "Electricity"). No facility group. The input type must already exist in Manage Input Types.
- **Fiscal year:** July → June. `pending` seeds rows for months in the **current fiscal year through today**.
- **Names:** Client, supplier, and category are matched **case-insensitively**. Facility names in confirm must match the tracker exactly (case-insensitive).
- **Per-facility invoices:** Invoices often arrive one facility at a time. Call `confirm` for each as it arrives — other facilities are untouched. Once all invoices for a period are processed, call `inferred-empty` to finalise.

---

## Logical flow — how to fully update the tracker

### Group invoice workflow (invoices arrive per-facility)

```
1. POST /api/ingestion/pending        ← seed amber PENDING months (once per supplier cycle)
      ↓  (for each invoice as it arrives)
2. POST /api/ingestion/confirm        ← mark that facility+period green (CONFIRMED)
      ↓  (after ALL invoices for the period are in)
3. POST /api/ingestion/inferred-empty ← mark any remaining PENDING in confirmed months as INFERRED_EMPTY
      ↓  (if a parse fails for any invoice)
   POST /api/ingestion/error          ← mark that period red (ERROR)
```

**Key rule:** `confirm` only touches the facilities you send. It never deletes or modifies records for other facilities or other months. This means you can call it one invoice at a time safely.

### Single line workflow (no group)

```
1. POST /api/ingestion/pending  (mode: "line")   ← seed PENDING
2. POST /api/ingestion/confirm  (mode: "line")   ← CONFIRMED
   POST /api/ingestion/error    (mode: "line")   ← ERROR on failure
```

---

## `POST /api/ingestion/pending`

Non-metered only. **Scope 1** input types and categories only. Creates `PENDING` `non_metered_records` where nothing blocking already exists.

### Bulk body (recommended default)

Omit `utility_name` and `mode`. Seeds **every** Scope 1 facility group and standalone line for this client + supplier pair.

```json
{
  "client_name": "Client display name",
  "supplier_name": "Supplier display name"
}
```

**Response:** `{ "scope": 1, "client_id", "supplier_id", "groups": [...], "lines": [...], "summary": { "created", "skipped" } }`  
**Errors:** `401`, `404` if no Scope 1 coverage exists for that pair.

### Group body (single NGERS category)

Include `utility_name` (the **reporting** category name on the facility group, e.g. "Transport Fuels").

```json
{
  "client_name": "Client display name",
  "supplier_name": "Supplier display name",
  "utility_name": "Transport Fuels"
}
```

**Response:** `{ "mode": "group", "scope": 1, "created": n, "skipped": n }`

### Line body

`facility_name` is optional when exactly **one** `non_metered_lines` row exists for that client + supplier + input type. `utility_name` = the **Input Type** name (must exist, Scope 1 only).

```json
{
  "mode": "line",
  "client_name": "...",
  "supplier_name": "...",
  "utility_name": "kL",
  "facility_name": "Site A"
}
```

**Response:** `{ "mode": "line", "scope": 1, "resolved": { ... }, "created": n, "skipped": n }`  
**Errors:** `400` (unknown input type or not Scope 1), `401`, `404`, `409` (facility ambiguous — pass `facility_name`).

---

## `POST /api/ingestion/confirm`

Turns `PENDING` → `CONFIRMED` for the exact facility+period combinations in the payload. **Nothing else is touched** — other facilities, other months, and other input types are all left as-is.

> **No** `Consumption` or `Amount ($)` are stored. **No** deletions. **No** automatic INFERRED_EMPTY.  
> Call `POST /api/ingestion/inferred-empty` when all invoices for a period are in.

### NGERS row fields

| Field | Required | Role |
|-------|----------|------|
| `Company` | Yes | Client name |
| `Facility` | Yes | Site name (must match a group member or standalone line facility) |
| `Provider` | Yes | Supplier name |
| `Category` | Group: yes · Line: optional | NGERS group category (e.g. "Transport Fuels"). Electricity rows in line mode may omit it. |
| `Input Type` | Yes | Specific input type (e.g. "Diesel oil", "Ethanol", "kL", "Electricity") |
| `Date Range` | Yes | `"DD/MM/YYYY - DD/MM/YYYY"` |

### Group mode body — JSON array of rows

Each row must include `Category` and `Input Type`. Multiple facilities and/or multiple months can be batched in a single call as long as they share the same `Category` + `Input Type`.

```bash
curl -sS -X POST "${BASE_URL}/api/ingestion/confirm" \
  -H "Authorization: Bearer ${INGESTION_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '[
    {
      "Company": "Your Client Name",
      "Facility": "Site A",
      "Provider": "Your Supplier Name",
      "Category": "Transport Fuels",
      "Input Type": "Diesel oil",
      "Date Range": "01/03/2026 - 31/03/2026"
    },
    {
      "Company": "Your Client Name",
      "Facility": "Site B",
      "Provider": "Your Supplier Name",
      "Category": "Transport Fuels",
      "Input Type": "Diesel oil",
      "Date Range": "01/03/2026 - 31/03/2026"
    }
  ]'
```

**Response:** `{ "mode": "group", "confirmed": n, "warnings": [] }`

### Line mode body — object with `rows`

`Category` is optional for electricity rows.

```bash
curl -sS -X POST "${BASE_URL}/api/ingestion/confirm" \
  -H "Authorization: Bearer ${INGESTION_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "line",
    "rows": [
      {
        "Company": "Your Client Name",
        "Facility": "Site A",
        "Provider": "Your Supplier Name",
        "Input Type": "kL",
        "Date Range": "01/03/2026 - 31/03/2026"
      }
    ]
  }'
```

**Response:** `{ "mode": "line", "confirmed": n, "warnings": [] }`

---

## `POST /api/ingestion/inferred-empty`

Call this **after all per-facility invoices for a period have been submitted** via `confirm`. For every month that has **at least one CONFIRMED record** in the scope, any member still PENDING for that month is marked `INFERRED_EMPTY`. Months with no CONFIRMED records are left completely untouched.

### Group mode body

Covers **all input types** within the facility group in one call.

```bash
curl -sS -X POST "${BASE_URL}/api/ingestion/inferred-empty" \
  -H "Authorization: Bearer ${INGESTION_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "client_name": "Your Client Name",
    "supplier_name": "Your Supplier Name",
    "category": "Transport Fuels"
  }'
```

**Response:** `{ "mode": "group", "inferred_empty": n, "confirmed_periods_checked": n }`

**Example:** Group has Facility A (Diesel oil — CONFIRMED for March) and Facility B (Diesel oil — PENDING for March). After this call, Facility B March → `INFERRED_EMPTY`. May (no CONFIRMED records) is left as PENDING.

### Line mode body

For standalone lines (not in a group).

```bash
curl -sS -X POST "${BASE_URL}/api/ingestion/inferred-empty" \
  -H "Authorization: Bearer ${INGESTION_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "line",
    "client_name": "Your Client Name",
    "supplier_name": "Your Supplier Name",
    "input_type": "kL",
    "facility_name": "Site A"
  }'
```

**Response:** `{ "mode": "line", "inferred_empty": n, "confirmed_periods_checked": n }`

---

## `POST /api/ingestion/error`

Sets `PENDING` → `ERROR` for the **calendar month** taken from the start date of `date_range`.

### Group body

```bash
curl -sS -X POST "${BASE_URL}/api/ingestion/error" \
  -H "Authorization: Bearer ${INGESTION_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "client_name": "Your Client Name",
    "supplier_name": "Your Supplier Name",
    "utility_name": "Transport Fuels",
    "date_range": "01/03/2026 - 31/03/2026"
  }'
```

### Line body

`facility_name` is optional when exactly one standalone line matches.

```bash
curl -sS -X POST "${BASE_URL}/api/ingestion/error" \
  -H "Authorization: Bearer ${INGESTION_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "line",
    "client_name": "Your Client Name",
    "supplier_name": "Your Supplier Name",
    "utility_name": "kL",
    "facility_name": "Site A",
    "date_range": "01/03/2026 - 31/03/2026"
  }'
```

**Response:** `{ "updated": n, "period_start_date": "YYYY-MM-DD" }`

---

## Metered utilities (`actual_invoices`)

Same `INGESTION_API_KEY` auth. Targets metered utilities only. The meter must already exist in the tracker.

### `POST /api/ingestion/metered/pending`

```bash
curl -sS -X POST "${BASE_URL}/api/ingestion/metered/pending" \
  -H "Authorization: Bearer ${INGESTION_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "client_name": "Your Client Name",
    "supplier_name": "Your Supplier Name",
    "utility_name": "Electricity",
    "facility_name": "Site A",
    "identifier_type": "NMI",
    "lookup1": "1234567890123",
    "lookup2": null
  }'
```

### `POST /api/ingestion/metered/confirm`

```bash
curl -sS -X POST "${BASE_URL}/api/ingestion/metered/confirm" \
  -H "Authorization: Bearer ${INGESTION_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "rows": [
      {
        "Company": "Your Client Name",
        "Facility": "Site A",
        "Provider": "Your Supplier Name",
        "Category": "Electricity",
        "NMI": "1234567890123",
        "Consumption": 15000,
        "Amount ($)": 3200,
        "Date Range": "05/03/2026 - 31/03/2026"
      }
    ]
  }'
```

### `POST /api/ingestion/metered/error`

```bash
curl -sS -X POST "${BASE_URL}/api/ingestion/metered/error" \
  -H "Authorization: Bearer ${INGESTION_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "client_name": "Your Client Name",
    "supplier_name": "Your Supplier Name",
    "utility_name": "Electricity",
    "facility_name": "Site A",
    "identifier_type": "NMI",
    "lookup1": "1234567890123",
    "date_range": "01/03/2026 - 31/03/2026"
  }'
```

---

## Related docs

- **[ingestion-demo-commands.md](./ingestion-demo-commands.md)** — PowerShell copy-paste examples with Test Client.
- **[api-facilities-utilities-guide.md](./api-facilities-utilities-guide.md)** — facility groups, categories, and app setup.
- **[ingestion-test-subject.md](./ingestion-test-subject.md)** — isolated sandbox client + seed script.

**Implementation:** `app/api/ingestion/pending/route.ts`, `confirm/route.ts`, `inferred-empty/route.ts`, `error/route.ts`, `lib/ingestion-line.ts`, `lib/ingestion-pending-scope1.ts`, `lib/ingestion-group-pending.ts`, `lib/ingestion-utility-category.ts`.
