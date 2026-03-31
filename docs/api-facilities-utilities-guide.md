# API guide: facilities, utilities, and ingestion

This document describes the HTTP APIs used to manage **facilities**, **utility categories**, **facility groups** (for multi-site invoices), **meters** (metered utilities), **non-metered records**, and the **ingestion** workflow (`pending` → `confirm` or `error`).

---

## Authentication

| Area | Auth |
|------|------|
| **All routes under `/api` except `/api/ingestion/*`** | Logged-in Supabase user (session cookie). Unauthenticated requests get `401` JSON or redirect to `/login`. |
| **`/api/ingestion/pending`**, **`/api/ingestion/confirm`**, **`/api/ingestion/error`** | `Authorization: Bearer <INGESTION_API_KEY>` where the secret matches `INGESTION_API_KEY` in the server environment. These routes bypass the normal session check (see `middleware.ts`). |

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

**Scope 3 / client-wide:** For standalone line ingestion, Scope 3 can use the synthetic facility name `(Client-wide)` or omit `facility_name` in pending/error (see [Ingestion — line mode](#5-ingestion-api)). The app may create `(Client-wide)` under the client automatically.

---

## 2. Utility categories (non-metered “utility types”)

Categories are global rows in `utility_categories`. Group-level ingestion uses the **group’s** `utility_category_id` as the shared “invoice type” (e.g. Transport Fuels); each group member has its own **per-facility** category on `facility_group_members`.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/utility-categories` | List all categories. |
| `POST` | `/api/utility-categories` | Upsert by name. Body: `{ "name": string, "scope"?: number, "is_metered"?: boolean }`. |
| `PUT` | `/api/utility-categories/{id}` | Update. Body: `{ "name": string, "scope"?: 1\|2\|3, "is_metered"?: boolean, "needs_review"?: boolean }`. |
| `DELETE` | `/api/utility-categories/{id}` | Delete category. |

**Ingestion note:** `/api/ingestion/pending` in **line** mode can **create** a category if missing (`findOrCreateUtilityCategoryForIngestion`). **Group** mode and **confirm** expect categories (and groups) to exist or match names as documented below.

---

## 3. Facility groups (required for “group” ingestion)

A **facility group** ties a client + supplier + **one group-level utility category** to many facilities. Each **member** has `facility_id` + `utility_category_id` (the specific category for that site’s row in `non_metered_records`).

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/clients/{clientId}/facility-groups` | List groups with `supplier`, `utility_category`, and `members` (each with nested facility + category). |
| `POST` | `/api/clients/{clientId}/facility-groups` | Create group + members + backfill. Body: `{ "name": string, "supplier_id": string, "utility_category_id": string, "facility_ids": { "facility_id": string, "utility_category_id": string }[] }`. |
| `PUT` | `/api/facility-groups/{groupId}` | Update `name`, `utility_category_id`, and/or replace all members via `facility_ids` (same shape as POST). Runs backfill when members change. |
| `DELETE` | `/api/facility-groups/{groupId}` | Delete group (members cascade per DB). |

**Legacy helpers** (member add/remove without per-member utility in body):

| Method | Path | Body |
|--------|------|------|
| `POST` | `/api/facility-groups/{groupId}/members` | `{ "facility_id": string }` — may leave `utility_category_id` null; prefer `PUT` on the group with full `facility_ids` for ingestion. |
| `DELETE` | `/api/facility-groups/{groupId}/members` | `{ "facility_id": string }` |

**UI helper:** `GET /api/clients/{clientId}/facility-utility-categories?scope=1` returns a map of `facilityId →` category options (from existing non-metered data), useful for picking member categories.

---

## 4. Meters (metered utilities)

Meters attach to a facility and optionally a supplier + utility category. Used for **metered** coverage, not the non-metered ingestion trio below.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/clients/{clientId}/meters` | All meters for the client’s facilities (with facility, supplier, utility_category). |
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

## 6. Ingestion API (`pending`, `confirm`, `error`)

All three use:

```http
POST /api/ingestion/<endpoint>
Authorization: Bearer <INGESTION_API_KEY>
Content-Type: application/json
```

### 6.1 Concepts

- **Fiscal year months “through now”:** `pending` seeds PENDING rows for months in the **current fiscal year** up to the current date (see `getCurrentFiscalYearMonthsThroughNow` in code).
- **Group mode:** Invoice covers multiple sites under one client + supplier + **group utility type**. Requires a preconfigured **facility group** whose `utility_category_id` matches `utility_name` (matched to `utility_categories.name`).
- **Line mode:** Single facility (or client-wide for Scope 3) + supplier + **record-level** utility name. No facility group. `utility_name` is the **category** for that line (e.g. GREASE).

### 6.2 `POST /api/ingestion/pending`

Creates `non_metered_records` with `status: "PENDING"` where there is no blocking row yet.

**Group body:**

```json
{
  "client_name": "Client display name",
  "supplier_name": "Supplier display name",
  "utility_name": "Group-level utility category name"
}
```

- Resolves client and supplier by **case-insensitive name**.
- Finds `facility_groups` row matching `client_id`, `supplier_id`, and group `utility_category_id` for `utility_name`.
- For each member with a non-null `utility_category_id`, for each FY month: inserts PENDING unless a row already exists for that facility + category + period, or the facility already has a “green” record from that supplier for that period (`IMPORTED`, `MANUAL`, `CONFIRMED`, `DEACTIVATED`).

**Response (group):** `{ "created": number, "skipped": number }`.

**Line body:**

```json
{
  "mode": "line",
  "client_name": "...",
  "supplier_name": "...",
  "utility_name": "Record category name",
  "facility_name": "Site name"
}
```

- `facility_name`: required for Scope 1/2; for Scope 3, optional / can use `(Client-wide)` / `Scope 3` style labels per `resolveIngestionLine`.
- May create the utility category if needed.

**Response (line):** includes `mode`, `resolved` (`facility_id`, `facility_name`, `supplier_id`, `utility_category_id`), `created`, `skipped`.

**Typical errors:** `400` validation, `401` bad key, `404` missing client/supplier/group/facility, `422` group has no members with categories.

### 6.3 `POST /api/ingestion/confirm`

Turns PENDING rows into **CONFIRMED** (with optional consumption/amount), **INFERRED_EMPTY** for group members missing from the invoice for that period, and **deletes** PENDING rows for periods not present in the payload (orphans).

**Group mode body:** JSON **array** of NGERS-shaped objects (see below).

- Rows are grouped by `(Company, Provider, Category)` where `Category` is the **group-level** utility type (same as group’s `utility_category`).
- `Facility` must match a member facility **name** in the group (case-insensitive).
- For each period in the file: members with data → CONFIRMED; members without data → INFERRED_EMPTY; PENDING for other months in that group scope → deleted.

**Response (group):** `{ "mode": "group", "confirmed": number, "inferred_empty": number, "deleted_pending": number, "warnings": string[] }`.

**Line mode body:**

```json
{
  "mode": "line",
  "rows": [ /* NGERS rows */ ]
}
```

- `Category` = **record** utility name (not the group type).
- `Facility` = site name (or consistent with line resolution).
- No INFERRED_EMPTY for sibling facilities; only the resolved facility + category is updated; orphaned PENDING for that line are deleted.

**Response (line):** `{ "mode": "line", "confirmed", "inferred_empty", "deleted_pending", "warnings" }`.

**NGERS row fields used:**

| Field | Role |
|--------|------|
| `Company` | Client name |
| `Facility` | Site name (group mode: must match member; line mode: resolves facility) |
| `Provider` | Supplier name |
| `Category` | Group utility type (group mode) or record utility (line mode) |
| `Date Range` | `"DD/MM/YYYY - DD/MM/YYYY"` (inclusive-style range; parsed to period start/end) |
| `Consumption` | Number (aggregated per period / facility) |
| `Amount ($)` | Number (aggregated) |

Other columns may exist on objects; these are what the route reads.

### 6.4 `POST /api/ingestion/error`

Marks **PENDING** rows as **ERROR** for a **single calendar month** derived from `date_range` (month = month of the **start** date).

**Group body:**

```json
{
  "client_name": "...",
  "supplier_name": "...",
  "utility_name": "Group-level utility category name",
  "date_range": "01/03/2026 - 31/03/2026"
}
```

**Line body:**

```json
{
  "mode": "line",
  "client_name": "...",
  "supplier_name": "...",
  "utility_name": "Record category name",
  "date_range": "01/03/2026 - 31/03/2026",
  "facility_name": "Site name"
}
```

**Response:** `{ "updated": number, "period_start_date": "YYYY-MM-01", ... }` or a message when no PENDING rows exist.

---

## 7. End-to-end flows

### Configure once (UI or session APIs)

1. Ensure **client** and **supplier** exist (clients/suppliers APIs as used by your app).
2. Create **facilities** under the client.
3. Ensure **utility categories** exist for both the group type and per-site line items as needed.
4. Create **facility group** with `supplier_id`, group `utility_category_id`, and `facility_ids: [{ facility_id, utility_category_id }, ...]`.

### Automated non-metered invoice (group)

1. Email/workflow calls **`POST /api/ingestion/pending`** with `client_name`, `supplier_name`, `utility_name` (group type).
2. On successful parse, call **`POST /api/ingestion/confirm`** with the NGERS row array.
3. On failure for a period, call **`POST /api/ingestion/error`** with the same identifiers + `date_range`.

### Automated non-metered invoice (single line / no group)

1. **`POST /api/ingestion/pending`** with `mode: "line"` and `utility_name` = record category.
2. **`POST /api/ingestion/confirm`** with `{ "mode": "line", "rows": [...] }`.
3. **`POST /api/ingestion/error`** with `mode: "line"` when needed.

### Operational notes

- **Confirm** removes PENDING rows for months **not** included in that confirm payload (for that group or line context). If you need amber PENDING again for other months, run **pending** again (see `docs/ingestion-demo-commands.md`).
- **Confirm** returns **`warnings`** for skipped rows (unknown client, facility not in group, bad date range, etc.) without failing the whole request.

---

## 8. Copy-paste examples

See **[ingestion-demo-commands.md](./ingestion-demo-commands.md)** for PowerShell examples (group + line, pending / confirm / error). Replace the host and Bearer token with your environment; rotate keys if samples were ever shared.

---

## 9. Source map

| Topic | Main route files |
|--------|------------------|
| Ingestion | `app/api/ingestion/pending/route.ts`, `confirm/route.ts`, `error/route.ts` |
| Line resolution | `lib/ingestion-line.ts`, `lib/ingestion-utility-category.ts` |
| Facilities | `app/api/clients/[id]/facilities/route.ts`, `app/api/facilities/[id]/route.ts` |
| Groups | `app/api/clients/[id]/facility-groups/route.ts`, `app/api/facility-groups/[id]/route.ts` |
| Utility categories | `app/api/utility-categories/route.ts`, `app/api/utility-categories/[id]/route.ts` |
| Non-metered CRUD | `app/api/non-metered-records/route.ts`, `app/api/non-metered-records/[id]/route.ts` |
| Auth | `middleware.ts` |
