# API guide: facilities, utilities, and ingestion

This document describes the HTTP APIs used to manage **facilities**, **utility categories**, **facility groups** (for multi-site invoices), **meters** (metered utilities), **non-metered records**, and the **ingestion** workflow (`pending` → `confirm` → `inferred-empty` or `error`).

---

## Authentication

| Area | Auth |
|------|------|
| **All routes under `/api` except `/api/ingestion/*`** | Logged-in Supabase user (session cookie). Unauthenticated requests get `401` JSON or redirect to `/login`. |
| **`/api/ingestion/pending`**, **`/api/ingestion/confirm`**, **`/api/ingestion/inferred-empty`**, **`/api/ingestion/error`** | `Authorization: Bearer <INGESTION_API_KEY>` where the secret matches `INGESTION_API_KEY` in the server environment. These routes bypass the normal session check (see `middleware.ts`). |

Set `INGESTION_API_KEY` in `.env.local` (see `.env.local.example`).

**Base URL:** use your deployed origin or `http://localhost:3000` for local development.

---

## 1. Facilities

Facilities belong to a client. Names are matched case-insensitively during ingestion (`ilike`).

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/clients/{clientId}/facilities` | List facilities with `meterCount`. |
| `POST` | `/api/clients/{clientId}/facilities` | Create facility. Body: `{ "name": string, "address"?: string }`. |
| `PUT` | `/api/facilities/{facilityId}` | Update facility. Body: `{ "name": string, "address"?: string \| null }`. |
| `DELETE` | `/api/facilities/{facilityId}` | Delete facility (cascades meters and their invoices per route logic). |

**Scope 3 / client-wide:** For standalone line ingestion, Scope 3 can use the synthetic facility name `(Client-wide)`. Omitting `facility_name` resolves the single matching `non_metered_lines` row when it exists, or falls back to `(Client-wide)` when none exist yet. The app may create `(Client-wide)` under the client automatically.

---

## 2. Utility categories (non-metered "utility types")

Categories are global rows in `utility_categories`. Group-level ingestion uses the **group's** `utility_category_id` as the shared "invoice type" (e.g. Transport Fuels); each group member has its own **per-facility** category on `facility_group_members`.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/utility-categories` | List all categories. |
| `POST` | `/api/utility-categories` | Upsert by name. Body: `{ "name": string, "scope"?: number, "is_metered"?: boolean }`. |
| `PUT` | `/api/utility-categories/{id}` | Update. Body: `{ "name": string, "scope"?: 1\|2\|3, "is_metered"?: boolean, "needs_review"?: boolean }`. |
| `DELETE` | `/api/utility-categories/{id}` | Delete category. |

**Ingestion note:** `/api/ingestion/pending` in **line** mode requires an existing **input type** name (**Scope 1** only). It does **not** create missing input types. **Group** pending resolves the NGERS **reporting** category (`categories`) by name.

---

## 3. Facility groups (required for "group" ingestion)

A **facility group** ties a client + supplier + **one group-level NGERS category** to many facilities. Each **member** has `facility_id` + `input_type_id` (the specific input type tracked for that site, e.g. "Diesel oil", "Ethanol").

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/clients/{clientId}/facility-groups` | List groups with `supplier`, `category`, and `members` (each with nested facility + input type). |
| `POST` | `/api/clients/{clientId}/facility-groups` | Create group + members + backfill. Body: `{ "name": string, "supplier_id": string, "utility_category_id": string, "facility_ids": { "facility_id": string, "utility_category_id": string }[] }`. |
| `PUT` | `/api/facility-groups/{groupId}` | Update `name`, `utility_category_id`, and/or replace all members via `facility_ids`. Runs backfill when members change. |
| `DELETE` | `/api/facility-groups/{groupId}` | Delete group (members cascade per DB). |

**Legacy helpers** (member add/remove without per-member utility in body):

| Method | Path | Body |
|--------|------|------|
| `POST` | `/api/facility-groups/{groupId}/members` | `{ "facility_id": string }` — may leave `utility_category_id` null; prefer `PUT` on the group with full `facility_ids` for ingestion. |
| `DELETE` | `/api/facility-groups/{groupId}/members` | `{ "facility_id": string }` |

**UI helper:** `GET /api/clients/{clientId}/facility-utility-categories?scope=1` returns a map of `facilityId →` category options (from existing non-metered data), useful for picking member categories.

---

## 4. Meters (metered utilities)

Meters attach to a facility and optionally a supplier + utility category. Used for **metered** coverage, not the non-metered ingestion endpoints below.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/clients/{clientId}/meters` | All meters for the client's facilities (with facility, supplier, utility_category). |
| `PATCH` | `/api/meters/{meterId}` | Partial update: `facility_id`, `utility_category_id`, `identifier_type`, `lookup1`, `lookup2`, `supplier_id`, dates, `needs_attention`, etc. |

(Additional meter routes exist under `app/api/meters` for listing/creating as needed by the app.)

---

## 5. Non-metered records (manual API)

These rows power the non-metered coverage grid (`PENDING`, `CONFIRMED`, `INFERRED_EMPTY`, `ERROR`, `MANUAL`, etc.).

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/non-metered-records` | Create row. Required: `facility_id`, `utility_category_id`, `period_start_date`, `period_end_date`. Optional: `supplier_id`, `status` (default `MANUAL`), `consumption`, `unit`, `amount`, invoice fields, `sub_category`. |
| `PATCH` | `/api/non-metered-records/{id}` | Allowed keys: `status`, `consumption`, `unit`, `amount`, `invoice_number`, `invoice_date`, `sub_category`, `input_type`, `framework`, `version`, `customer`. |
| `DELETE` | `/api/non-metered-records/{id}` | Delete record. Returns `204` on success. |

Ingestion endpoints read/update these same rows for automated flows.

---

## 6. Ingestion API (`pending`, `confirm`, `inferred-empty`, `error`)

All endpoints use:

```http
POST /api/ingestion/<endpoint>
Authorization: Bearer <INGESTION_API_KEY>
Content-Type: application/json
```

### 6.1 Concepts

- **Fiscal year months "through now":** `pending` seeds PENDING rows for months in the **current fiscal year** up to the current date.
- **Scope 1 only:** Non-metered `pending` only seeds Scope 1 standalone lines and facility groups. Targeted calls with non–Scope 1 utilities return `400`.
- **Group mode:** One supplier invoices multiple facilities under one client + supplier + NGERS **reporting category** (e.g. "Transport Fuels"). Each group member has its own **Input Type** (e.g. "Diesel oil", "Ethanol").
- **Line mode (`mode: "line"`):** Single facility + supplier + **Input Type** name. No facility group.
- **Per-facility invoicing:** `confirm` only updates the exact facility+period rows in the payload — other facilities, months, and input types are untouched. Call `inferred-empty` once all invoices for a period are in to finalise.

### 6.2 `POST /api/ingestion/pending`

Creates `non_metered_records` with `status: "PENDING"` where no blocking row already exists.

**Bulk body (recommended — seeds all Scope 1 coverage):**

```json
{ "client_name": "Client display name", "supplier_name": "Supplier display name" }
```

- Resolves client and supplier by **case-insensitive name**.
- Seeds **every** Scope 1 facility group and standalone `non_metered_lines` row for this pair.
- **Response:** `{ "scope": 1, "client_id", "supplier_id", "groups": [...], "lines": [...], "summary": { "created", "skipped" } }`.
- `404` if there is no Scope 1 coverage for that pair.

**Group body (single NGERS category):**

```json
{ "client_name": "...", "supplier_name": "...", "utility_name": "Transport Fuels" }
```

- Finds `facility_groups` matching `client_id`, `supplier_id`, and the NGERS category name.
- **Response:** `{ "mode": "group", "scope": 1, "created": number, "skipped": number }`.

**Line body:**

```json
{ "mode": "line", "client_name": "...", "supplier_name": "...", "utility_name": "Diesel oil", "facility_name": "Site A" }
```

- `utility_name` = `input_types` name (must exist; Scope 1 only).
- `facility_name` optional when exactly **one** `non_metered_lines` row matches; `409` if several facilities match.
- **Response:** `{ "mode": "line", "scope": 1, "resolved": {...}, "created", "skipped" }`.

**Typical errors:** `400`, `401`, `404`, `409` ambiguous line, `422` group has no member lines.

### 6.3 `POST /api/ingestion/confirm`

Turns `PENDING` → `CONFIRMED` for the **exact** facility+period rows in the payload. **No other records are modified.** No deletions, no automatic INFERRED_EMPTY.

**NGERS row fields:**

| Field | Required | Role |
|-------|----------|------|
| `Company` | Yes | Client name |
| `Facility` | Yes | Site name (must match a group member or resolved line facility) |
| `Provider` | Yes | Supplier name |
| `Category` | Group: yes · Line: optional | NGERS reporting category (e.g. "Transport Fuels"). Electricity rows in line mode may omit it. |
| `Input Type` | Yes | Specific input type (e.g. "Diesel oil", "Ethanol", "kL") |
| `Date Range` | Yes | `"DD/MM/YYYY - DD/MM/YYYY"` |

**Group mode body** — JSON array of rows. Multiple facilities and months can be batched:

```json
[
  { "Company": "...", "Facility": "Site A", "Provider": "...", "Category": "Transport Fuels", "Input Type": "Diesel oil", "Date Range": "01/03/2026 - 31/03/2026" },
  { "Company": "...", "Facility": "Site B", "Provider": "...", "Category": "Transport Fuels", "Input Type": "Diesel oil", "Date Range": "01/03/2026 - 31/03/2026" }
]
```

**Response:** `{ "mode": "group", "confirmed": number, "warnings": string[] }`

**Line mode body:**

```json
{ "mode": "line", "rows": [ { "Company": "...", "Facility": "Site A", "Provider": "...", "Input Type": "kL", "Date Range": "01/03/2026 - 31/03/2026" } ] }
```

**Response:** `{ "mode": "line", "confirmed": number, "warnings": string[] }`

`warnings` lists skipped rows (unknown client, facility not in group, bad date, etc.) without failing the whole request.

### 6.4 `POST /api/ingestion/inferred-empty`

Call **after all per-facility invoices for a period have been submitted** via `confirm`. For every month that has **at least one CONFIRMED record** in the scope, any member still PENDING for that month is marked `INFERRED_EMPTY`. Months with no CONFIRMED records are left completely untouched.

**Group mode body** — covers all input types in the group in one call:

```json
{ "client_name": "...", "supplier_name": "...", "category": "Transport Fuels" }
```

**Response:** `{ "mode": "group", "inferred_empty": number, "confirmed_periods_checked": number }`

**Example:** Group has 3 facilities for March. Two are CONFIRMED. After calling this endpoint, the remaining PENDING facility → INFERRED_EMPTY. April (no CONFIRMED records) is left as PENDING.

**Line mode body:**

```json
{ "mode": "line", "client_name": "...", "supplier_name": "...", "input_type": "kL", "facility_name": "Site A" }
```

**Response:** `{ "mode": "line", "inferred_empty": number, "confirmed_periods_checked": number }`

### 6.5 `POST /api/ingestion/error`

Marks PENDING rows as ERROR for a single calendar month derived from `date_range`.

**Group body:**

```json
{ "client_name": "...", "supplier_name": "...", "utility_name": "Transport Fuels", "date_range": "01/03/2026 - 31/03/2026" }
```

**Line body:**

```json
{ "mode": "line", "client_name": "...", "supplier_name": "...", "utility_name": "kL", "facility_name": "Site A", "date_range": "01/03/2026 - 31/03/2026" }
```

`facility_name` is optional when exactly one standalone line matches; `409` if several facilities share this supplier + utility.

**Response:** `{ "updated": number, "period_start_date": "YYYY-MM-DD" }` or a message when no PENDING rows exist.

---

## 7. End-to-end flows

### Configure once (UI or session APIs)

1. Ensure **client** and **supplier** exist.
2. Create **facilities** under the client.
3. Ensure **input types** (e.g. "Diesel oil", "Ethanol") and NGERS **categories** (e.g. "Transport Fuels") exist.
4. Create **facility group** with `supplier_id`, group `utility_category_id`, and members (`facility_id` + `utility_category_id` per member — the member's specific input type).
5. Set the **Category** on each `non_metered_lines` row via the tracker UI (the category selector). This is permanent and not overwritten by API calls.

### Automated non-metered invoice (group — per-facility invoices)

```
1. POST /api/ingestion/pending          ← seed amber PENDING months (once per supplier cycle)

   For each invoice as it arrives:
2. POST /api/ingestion/confirm          ← CONFIRM that facility+period (safe to call one at a time)

   After ALL invoices for the period are submitted:
3. POST /api/ingestion/inferred-empty   ← mark remaining PENDING in confirmed months as INFERRED_EMPTY

   On parse failure for any invoice:
   POST /api/ingestion/error            ← mark that period as ERROR
```

### Automated non-metered invoice (single line / no group)

```
1. POST /api/ingestion/pending  (mode: "line")   ← seed PENDING
2. POST /api/ingestion/confirm  (mode: "line")   ← CONFIRMED
   POST /api/ingestion/error    (mode: "line")   ← ERROR on failure
```

### Operational notes

- Running **`pending`** again is always safe — it skips months that already have records.
- **`confirm`** returns `warnings` for skipped rows without failing the whole request.
- The **category** on `non_metered_lines` rows is set via the tracker UI and is never overwritten by API calls.

---

## 8. Copy-paste examples

See **[ingestion-demo-commands.md](./ingestion-demo-commands.md)** for PowerShell examples. Replace the host and Bearer token with your environment.

---

## 9. Source map

| Topic | Main route files |
|--------|------------------|
| Ingestion | `app/api/ingestion/pending/route.ts`, `confirm/route.ts`, `inferred-empty/route.ts`, `error/route.ts` |
| Line / bulk pending | `lib/ingestion-line.ts`, `lib/ingestion-pending-scope1.ts`, `lib/ingestion-group-pending.ts`, `lib/ingestion-utility-category.ts` |
| Facilities | `app/api/clients/[id]/facilities/route.ts`, `app/api/facilities/[id]/route.ts` |
| Groups | `app/api/clients/[id]/facility-groups/route.ts`, `app/api/facility-groups/[id]/route.ts` |
| Utility categories | `app/api/utility-categories/route.ts`, `app/api/utility-categories/[id]/route.ts` |
| Non-metered CRUD | `app/api/non-metered-records/route.ts`, `app/api/non-metered-records/[id]/route.ts` |
| Auth | `middleware.ts` |
