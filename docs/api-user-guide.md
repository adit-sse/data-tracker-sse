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
1. POST /api/ingestion/pending         ← seed amber PENDING months (once per supplier cycle)
      ↓  (for each invoice as it arrives)
2. POST /api/ingestion/confirm         ← mark that facility+period green (CONFIRMED)
      ↓  (after ALL invoices for the period are in)
3. POST /api/ingestion/inferred-empty  ← mark any remaining PENDING in confirmed months as INFERRED_EMPTY (non-metered only)
      ↓  (very last step)
4. POST /api/ingestion/revert-pending  ← delete any still-PENDING records → back to "no data" (group / line / metered)
      ↓  (if a parse fails for any invoice)
   POST /api/ingestion/error           ← mark that period red (ERROR)
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

## `POST /api/ingestion/revert-pending`

The **very last** step of a confirm cycle. Deletes every record still `PENDING` for the scope, reverting those months to **"no data"** (a month with no record renders as gray "No data" in the UI). `CONFIRMED`, `INFERRED_EMPTY`, and other GREEN statuses are left untouched.

- **Non-metered (group/line):** run **after** `inferred-empty` for the same scope. `inferred-empty` converts PENDING → INFERRED_EMPTY for months that got a confirmed record; `revert-pending` then deletes whatever PENDING is left (e.g. months where nothing was confirmed).
- **Metered:** run on its own at the end of the metered cycle — there is no inferred-empty step for metered. Confirm already consumed the PENDING for confirmed months, so this only clears the unconfirmed leftovers (e.g. you seeded Jan–Jun and only confirmed March). Overlaps with unified-confirm's optional `prune_orphan_pending` flag, but also sweeps meters not in the last confirm batch.

### Group mode body

```bash
curl -sS -X POST "${BASE_URL}/api/ingestion/revert-pending" \
  -H "Authorization: Bearer ${INGESTION_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "client_name": "Your Client Name",
    "supplier_name": "Your Supplier Name",
    "category": "Transport Fuels"
  }'
```

**Response:** `{ "mode": "group", "reverted": n }`

### Line mode body

For standalone lines (not in a group).

```bash
curl -sS -X POST "${BASE_URL}/api/ingestion/revert-pending" \
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

**Response:** `{ "mode": "line", "reverted": n }`

### Metered mode body

Bulk — every meter for this client+supplier (optionally narrowed by `utility_name` and/or `facility_name`):

```bash
curl -sS -X POST "${BASE_URL}/api/ingestion/revert-pending" \
  -H "Authorization: Bearer ${INGESTION_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "metered",
    "client_name": "Your Client Name",
    "supplier_name": "Your Supplier Name",
    "utility_name": "Electricity"
  }'
```

**Response (bulk):** `{ "mode": "metered", "meters": n, "reverted": n }`

Specific meter (`identifier_type` + `lookup1`, optional `lookup2`):

```bash
curl -sS -X POST "${BASE_URL}/api/ingestion/revert-pending" \
  -H "Authorization: Bearer ${INGESTION_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "metered",
    "client_name": "Your Client Name",
    "supplier_name": "Your Supplier Name",
    "facility_name": "Site A",
    "utility_name": "Electricity",
    "identifier_type": "NMI",
    "lookup1": "12345678901"
  }'
```

**Response (specific):** `{ "mode": "metered", "meter_id": "...", "reverted": n }`

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

## `POST /api/ingestion/unified-error`

One endpoint for **any** error source. When an ingestion step (confirm / inferred-empty / revert-pending) fails, flip that month's `PENDING` row → `ERROR`. Auto-detects scope the same way `unified-confirm` does, so a single call handles metered, non-metered group, and non-metered line — including errors that happen before the workflow's group/line branch.

Only `PENDING` rows are flipped. `CONFIRMED` / `INFERRED_EMPTY` / other GREEN statuses are untouched. The optional `reason` is recorded on the `ingestion_events` log.

**Body:** the original NGERS row context + optional `reason`:

| Field | Required | Notes |
|---|---|---|
| `Company` | ✅ | client name |
| `Provider` | ✅ | supplier name |
| `Date Range` | ✅ | `DD/MM/YYYY - DD/MM/YYYY` (month taken from start) |
| `Category` | group / metered | NGERS category; empty for standalone lines |
| `Input Type` | line | input type name; required when no `Category` and no meter identifier |
| `Facility` | optional | facility name |
| `NMI` / `MIRN` / `Account Number` / `Meter Number` | metered | one of, for metered scope |
| `reason` | optional | recorded on the event log |

**Detection:** meter identifier present → metered (`actual_invoices`); non-empty `Category` → non-metered group (`facility_groups`); neither → non-metered line (`non_metered_lines`).

```bash
curl -sS -X POST "${BASE_URL}/api/ingestion/unified-error" \
  -H "Authorization: Bearer ${INGESTION_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "Company": "Your Client Name",
    "Provider": "Your Supplier Name",
    "Facility": "Site A",
    "Category": "Electricity",
    "Input Type": "kWh",
    "Date Range": "01/03/2026 - 31/03/2026",
    "NMI": "12345678901",
    "reason": "upstream confirm failed"
  }'
```

**Response:** `{ "scope": "metered" | "group" | "line", "updated": n, "period_start_date": "YYYY-MM-01", "meter_id"?: "...", "group_id"?: ... }`

The legacy `POST /api/ingestion/error` (non-metered group/line) and `POST /api/ingestion/metered/error` endpoints still work and can be called directly.

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

**Implementation:** `app/api/ingestion/pending/route.ts`, `confirm/route.ts`, `unified-confirm/route.ts`, `inferred-empty/route.ts`, `revert-pending/route.ts`, `error/route.ts`, `unified-error/route.ts`, `lib/ingestion-line.ts`, `lib/ingestion-pending-scope1.ts`, `lib/ingestion-group-pending.ts`, `lib/ingestion-utility-category.ts`, `lib/ingestion-error.ts`.
