# n8n HTTP Request Node Templates — Ingestion API

**Base URL:** `https://data-tracker-sse-production-185f.up.railway.app`  
**Auth header (all nodes):** `Authorization: Bearer <INGESTION_API_KEY>`

> Replace all `"Your Client Name"`, `"Your Supplier Name"`, `"Site A"`, etc. with real values from the tracker. Names are matched case-insensitively except facility names in confirm (must match exactly).

---

## Logical flow — how the nodes connect

```
NM Mixed-Scope Check — GET     ← pre-check: does this supplier serve BOTH scope 1 & scope 2?
        │
        ├─ has_mixed_scopes = true  →  skip pending entirely, go straight to Confirm
        │
        └─ has_mixed_scopes = false
                ↓
        NM Pending mode — GET  ← check if client+supplier is group vs line vs mixed
                ↓
        NM Pending — Scope 1 bulk  ← seed amber PENDING months (once per supplier cycle)
                ↓  (for each invoice as it arrives, one per facility)
        NM Confirm — Group     ← turn that facility+period green (CONFIRMED)
                ↓  (after ALL invoices for the period are submitted)
        NM Inferred Empty — Group  ← mark remaining PENDING in confirmed months as INFERRED_EMPTY
                ↓  (if a parse fails for any invoice)
        NM Error — Group       ← mark that period red (ERROR)
```

**Key rules for group invoices:**
- `confirm` only touches the facilities you send — other facilities and months are always left untouched.
- Call `confirm` once per invoice as each arrives; there is no risk of overwriting other facilities.
- Call `inferred-empty` **once** after all invoices for a period are in. It checks for confirmed months and infers empty for everything still pending in those months.
- When `has_mixed_scopes` is true, skip pending and call `confirm` directly — it will upsert a `CONFIRMED` record even with no prior `PENDING` row.

---

## Quick reference

| Node name | Endpoint | Use when |
|-----------|----------|----------|
| NM Mixed-Scope Check — GET | `GET /api/ingestion/mixed-scope` | Pre-check: does this supplier serve both scope 1 and scope 2 for this client? If yes, skip pending and go straight to confirm |
| NM Pending mode — GET | `GET /api/ingestion/pending-mode` | Check if client+supplier is group / line / mixed / none before calling pending |
| NM Pending — Scope 1 bulk | `POST /api/ingestion/pending` | `client_name` + `supplier_name` only — seeds all Scope 1 groups + standalone lines |
| NM Pending — Group (one category) | `POST /api/ingestion/pending` | Seed one NGERS group category; body includes `utility_name` |
| NM Pending — Line | `POST /api/ingestion/pending` | Standalone line; optional `facility_name` when uniquely resolvable |
| NM Confirm — Group | `POST /api/ingestion/confirm` | Confirm parsed rows for a group invoice (one or many facilities) |
| NM Confirm — Line | `POST /api/ingestion/confirm` | Confirm parsed rows for a line invoice |
| NM Inferred Empty — Group | `POST /api/ingestion/inferred-empty` | After all invoices for a period are submitted — mark remaining PENDING as INFERRED_EMPTY |
| NM Inferred Empty — Line | `POST /api/ingestion/inferred-empty` | Same, for standalone lines |
| NM Error — Group | `POST /api/ingestion/error` | Mark a group invoice month as ERROR |
| NM Error — Line | `POST /api/ingestion/error` | Mark a line invoice month as ERROR |
| Metered Pending | `POST /api/ingestion/metered/pending` | Seed PENDING rows for a metered utility (electricity, gas) |
| Metered Confirm | `POST /api/ingestion/metered/confirm` | Confirm parsed invoice rows for a metered utility |
| Metered Error | `POST /api/ingestion/metered/error` | Mark a metered month as ERROR |

---

## How to import a node

1. Copy the JSON block for the node you want.
2. In n8n, open your workflow canvas.
3. Press `Ctrl+V` (or `Cmd+V`) — n8n will paste it as a ready-to-use node.
4. Fill in the placeholder values in `jsonBody` (POST nodes) or query parameters (GET nodes).

---

## 0 · NM Mixed-Scope Check — GET

Call this **before** anything else for a client + supplier pair. If the supplier handles both Scope 1 (fuels, LPG, etc.) **and** Scope 2 (electricity) for this client, skip pending entirely and call Confirm directly — pending is not needed and confirm will upsert a `CONFIRMED` record without a prior `PENDING` row.

**Response fields to branch on:**

| Field | Type | Meaning |
|-------|------|---------|
| `has_mixed_scopes` | boolean | `true` → skip pending, go straight to confirm |
| `has_scope1` | boolean | Supplier has Scope 1 coverage for this client |
| `has_scope2` | boolean | Supplier has Scope 2 coverage for this client |
| `scope1_input_types` | string[] | Names of Scope 1 input types (e.g. `["DIESEL", "LPG"]`) |
| `scope2_input_types` | string[] | Names of Scope 2 input types (e.g. `["ELECTRICITY"]`) |

**Response:** `{ "has_mixed_scopes": true, "has_scope1": true, "has_scope2": true, "scope1_input_types": ["DIESEL", "LPG"], "scope2_input_types": ["ELECTRICITY"], ... }`

```json
{
  "nodes": [
    {
      "parameters": {
        "method": "GET",
        "url": "https://data-tracker-sse-production-185f.up.railway.app/api/ingestion/mixed-scope",
        "sendQuery": true,
        "specifyQuery": "keypair",
        "queryParameters": {
          "parameters": [
            { "name": "client_name", "value": "Your Client Name" },
            { "name": "supplier_name", "value": "Your Supplier Name" }
          ]
        },
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            { "name": "Authorization", "value": "Bearer YOUR_INGESTION_API_KEY" }
          ]
        },
        "options": {}
      },
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.4,
      "position": [0, -300],
      "name": "NM Mixed-Scope Check — GET"
    }
  ],
  "connections": {},
  "pinData": {}
}
```

---

## 1 · NM Pending mode — GET

Only call this when `has_mixed_scopes` is `false`. Returns `pending_mode` (`group` | `line` | `mixed` | `none`), facility groups (with `category_name` for group `utility_name`), and `standalone_non_metered_line_count` so you can branch to **NM Pending — Group** vs **NM Pending — Line**.

**Response:** JSON with `use_group_pending_body`, `use_line_pending_body`, `facility_groups`, etc.

```json
{
  "nodes": [
    {
      "parameters": {
        "method": "GET",
        "url": "https://data-tracker-sse-production-185f.up.railway.app/api/ingestion/pending-mode",
        "sendQuery": true,
        "specifyQuery": "keypair",
        "queryParameters": {
          "parameters": [
            { "name": "client_name", "value": "Your Client Name" },
            { "name": "supplier_name", "value": "Your Supplier Name" }
          ]
        },
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            { "name": "Authorization", "value": "Bearer YOUR_INGESTION_API_KEY" }
          ]
        },
        "options": {}
      },
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.4,
      "position": [0, 0],
      "name": "NM Pending mode — GET"
    }
  ],
  "connections": {},
  "pinData": {}
}
```

---

## 1 · NM Pending — Scope 1 bulk

Seeds **`PENDING`** for **all** Scope 1 facility groups **and** standalone lines for this client + supplier (fiscal year through today). Body has **no** `utility_name` and **no** `mode`.

**Response:** `{ "scope": 1, "client_id", "supplier_id", "groups": [...], "lines": [...], "summary": { "created", "skipped" } }` · **`404`** if no Scope 1 coverage exists for the pair.

```json
{
  "nodes": [
    {
      "parameters": {
        "method": "POST",
        "url": "https://data-tracker-sse-production-185f.up.railway.app/api/ingestion/pending",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            { "name": "Authorization", "value": "Bearer YOUR_INGESTION_API_KEY" }
          ]
        },
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "{\n  \"client_name\": \"Your Client Name\",\n  \"supplier_name\": \"Your Supplier Name\"\n}",
        "options": {}
      },
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.4,
      "position": [0, 0],
      "name": "NM Pending — Scope 1 bulk"
    }
  ],
  "connections": {},
  "pinData": {}
}
```

---

## 2 · NM Pending — Group (single category)

Seeds `PENDING` non-metered records for every fiscal month (Jul → today) across all facilities in **one** matching group. Body includes `utility_name` (NGERS reporting category name).

**Response:** `{ "mode": "group", "scope": 1, "created": n, "skipped": n }`

```json
{
  "nodes": [
    {
      "parameters": {
        "method": "POST",
        "url": "https://data-tracker-sse-production-185f.up.railway.app/api/ingestion/pending",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            { "name": "Authorization", "value": "Bearer YOUR_INGESTION_API_KEY" }
          ]
        },
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "{\n  \"client_name\": \"Your Client Name\",\n  \"supplier_name\": \"Your Supplier Name\",\n  \"utility_name\": \"Transport Fuels\"\n}",
        "options": {}
      },
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.4,
      "position": [0, 0],
      "name": "NM Pending — Group (single category)"
    }
  ],
  "connections": {},
  "pinData": {}
}
```

---

## 3 · NM Pending — Line

Seeds `PENDING` non-metered records for **one** site + record-level **input type** (no facility group). The template below **omits** `facility_name` — use this when exactly **one** `non_metered_lines` row exists for that client + supplier + utility. `utility_name` must match an existing **Scope 1** input type. Use `resolved` in the response for the resolved site. If several sites could match, add `"facility_name": "Site A"` to the JSON body or switch to group pending.

**Response:** `{ "mode": "line", "scope": 1, "resolved": { ... }, "created": n, "skipped": n }`

```json
{
  "nodes": [
    {
      "parameters": {
        "method": "POST",
        "url": "https://data-tracker-sse-production-185f.up.railway.app/api/ingestion/pending",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            { "name": "Authorization", "value": "Bearer YOUR_INGESTION_API_KEY" }
          ]
        },
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "{\n  \"mode\": \"line\",\n  \"client_name\": \"Your Client Name\",\n  \"supplier_name\": \"Your Supplier Name\",\n  \"utility_name\": \"GREASE\"\n}",
        "options": {}
      },
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.4,
      "position": [240, 0],
      "name": "NM Pending — Line"
    }
  ],
  "connections": {},
  "pinData": {}
}
```

---

## 4 · NM Confirm — Group

Turns `PENDING` → `CONFIRMED` for the exact facility+period rows in the payload. **Only** the facilities you send are updated — other facilities, months, and input types are untouched. Safe to call once per invoice as each arrives.

Body is a **JSON array** of NGERS-style row objects. Each row requires `Company`, `Facility`, `Provider`, `Category` (NGERS group category), `Input Type` (specific input type, e.g. "Diesel oil"), and `Date Range`. No `Consumption` or `Amount ($)` are stored.

**Response:** `{ "mode": "group", "confirmed": n, "warnings": [] }`

```json
{
  "nodes": [
    {
      "parameters": {
        "method": "POST",
        "url": "https://data-tracker-sse-production-185f.up.railway.app/api/ingestion/confirm",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            { "name": "Authorization", "value": "Bearer YOUR_INGESTION_API_KEY" }
          ]
        },
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "[\n  {\n    \"Company\": \"Your Client Name\",\n    \"Facility\": \"Site A\",\n    \"Provider\": \"Your Supplier Name\",\n    \"Category\": \"Transport Fuels\",\n    \"Input Type\": \"Diesel oil\",\n    \"Date Range\": \"01/03/2026 - 31/03/2026\"\n  }\n]",
        "options": {}
      },
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.4,
      "position": [480, 0],
      "name": "NM Confirm — Group"
    }
  ],
  "connections": {},
  "pinData": {}
}
```

---

## 5 · NM Confirm — Line

Same confirm logic as group but for a single line. Body is an **object** with `mode` and `rows`. Each row requires `Company`, `Facility`, `Provider`, `Input Type`, and `Date Range`. `Category` is optional for electricity rows.

**Response:** `{ "mode": "line", "confirmed": n, "warnings": [] }`

```json
{
  "nodes": [
    {
      "parameters": {
        "method": "POST",
        "url": "https://data-tracker-sse-production-185f.up.railway.app/api/ingestion/confirm",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            { "name": "Authorization", "value": "Bearer YOUR_INGESTION_API_KEY" }
          ]
        },
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "{\n  \"mode\": \"line\",\n  \"rows\": [\n    {\n      \"Company\": \"Your Client Name\",\n      \"Facility\": \"Site A\",\n      \"Provider\": \"Your Supplier Name\",\n      \"Input Type\": \"GREASE\",\n      \"Date Range\": \"01/03/2026 - 31/03/2026\"\n    }\n  ]\n}",
        "options": {}
      },
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.4,
      "position": [720, 0],
      "name": "NM Confirm — Line"
    }
  ],
  "connections": {},
  "pinData": {}
}
```

---

## 6 · NM Inferred Empty — Group

Call this **after all per-facility invoices for a period have been submitted** via Confirm. For every month that has at least one `CONFIRMED` record in the group, any member still `PENDING` for that month is marked `INFERRED_EMPTY`. Months with no confirmed records are left untouched.

Body requires `client_name`, `supplier_name`, and `category` (the NGERS reporting category name). Covers **all input types** in the group in one call.

**Response:** `{ "mode": "group", "inferred_empty": n, "confirmed_periods_checked": n }`

```json
{
  "nodes": [
    {
      "parameters": {
        "method": "POST",
        "url": "https://data-tracker-sse-production-185f.up.railway.app/api/ingestion/inferred-empty",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            { "name": "Authorization", "value": "Bearer YOUR_INGESTION_API_KEY" }
          ]
        },
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "{\n  \"client_name\": \"Your Client Name\",\n  \"supplier_name\": \"Your Supplier Name\",\n  \"category\": \"Transport Fuels\"\n}",
        "options": {}
      },
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.4,
      "position": [960, 0],
      "name": "NM Inferred Empty — Group"
    }
  ],
  "connections": {},
  "pinData": {}
}
```

---

## 7 · NM Inferred Empty — Line

Same inferred-empty logic but for standalone lines (not in a group). Body requires `mode: "line"`, `client_name`, `supplier_name`, `input_type`. `facility_name` is optional when uniquely resolvable.

**Response:** `{ "mode": "line", "inferred_empty": n, "confirmed_periods_checked": n }`

```json
{
  "nodes": [
    {
      "parameters": {
        "method": "POST",
        "url": "https://data-tracker-sse-production-185f.up.railway.app/api/ingestion/inferred-empty",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            { "name": "Authorization", "value": "Bearer YOUR_INGESTION_API_KEY" }
          ]
        },
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "{\n  \"mode\": \"line\",\n  \"client_name\": \"Your Client Name\",\n  \"supplier_name\": \"Your Supplier Name\",\n  \"input_type\": \"GREASE\",\n  \"facility_name\": \"Site A\"\n}",
        "options": {}
      },
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.4,
      "position": [1200, 0],
      "name": "NM Inferred Empty — Line"
    }
  ],
  "connections": {},
  "pinData": {}
}
```

---

## 8 · NM Error — Group

Sets `PENDING` → `ERROR` for the calendar month derived from the start of `date_range`.

**Response:** `{ "updated": n, "period_start_date": "YYYY-MM-DD" }`

```json
{
  "nodes": [
    {
      "parameters": {
        "method": "POST",
        "url": "https://data-tracker-sse-production-185f.up.railway.app/api/ingestion/error",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            { "name": "Authorization", "value": "Bearer YOUR_INGESTION_API_KEY" }
          ]
        },
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "{\n  \"client_name\": \"Your Client Name\",\n  \"supplier_name\": \"Your Supplier Name\",\n  \"utility_name\": \"Transport Fuels\",\n  \"date_range\": \"01/03/2026 - 31/03/2026\"\n}",
        "options": {}
      },
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.4,
      "position": [0, 300],
      "name": "NM Error — Group"
    }
  ],
  "connections": {},
  "pinData": {}
}
```

---

## 9 · NM Error — Line

Same as group error but for **line** mode: `PENDING` → `ERROR` for one resolved facility + input type + month. The template **omits** `facility_name` (same uniqueness rule as §3). Add `"facility_name": "Site A"` when you must disambiguate.

**Response:** `{ "updated": n, "period_start_date": "YYYY-MM-DD" }`

```json
{
  "nodes": [
    {
      "parameters": {
        "method": "POST",
        "url": "https://data-tracker-sse-production-185f.up.railway.app/api/ingestion/error",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            { "name": "Authorization", "value": "Bearer YOUR_INGESTION_API_KEY" }
          ]
        },
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "{\n  \"mode\": \"line\",\n  \"client_name\": \"Your Client Name\",\n  \"supplier_name\": \"Your Supplier Name\",\n  \"utility_name\": \"GREASE\",\n  \"date_range\": \"01/03/2026 - 31/03/2026\"\n}",
        "options": {}
      },
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.4,
      "position": [240, 300],
      "name": "NM Error — Line"
    }
  ],
  "connections": {},
  "pinData": {}
}
```

---

## 10 · Metered Pending

Seeds one `PENDING` invoice row per fiscal month (Jul → today) that is still empty for the given meter. The meter must already exist in the tracker.

**Unlike non-metered line pending (§3), this endpoint always requires `facility_name`** — meters are tied to a physical site.

`identifier_type` is one of: `NMI`, `MIRN`, `Account Number`, `Meter Number`.  
`lookup2` is optional (use `null` if not needed).

**Response:** `{ "created": n, "skipped": n }`

```json
{
  "nodes": [
    {
      "parameters": {
        "method": "POST",
        "url": "https://data-tracker-sse-production-185f.up.railway.app/api/ingestion/metered/pending",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            { "name": "Authorization", "value": "Bearer YOUR_INGESTION_API_KEY" }
          ]
        },
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "{\n  \"client_name\": \"Your Client Name\",\n  \"supplier_name\": \"Your Supplier Name\",\n  \"utility_name\": \"ELECTRICITY\",\n  \"facility_name\": \"Site A\",\n  \"identifier_type\": \"NMI\",\n  \"lookup1\": \"12345678901\",\n  \"lookup2\": null\n}",
        "options": {}
      },
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.4,
      "position": [480, 300],
      "name": "Metered Pending"
    }
  ],
  "connections": {},
  "pinData": {}
}
```

---

## 11 · Metered Confirm

Updates `PENDING` → `CONFIRMED` for the matching meter + calendar month. Stores the exact period dates from `Date Range`. Drops other FY `PENDING` rows for that meter not present in the payload.

Required row fields: `Company`, `Facility`, `Provider`, `Category`, `Date Range` (DD/MM/YYYY - DD/MM/YYYY), `Consumption`, `Amount ($)`, plus one meter identifier (`NMI`, `MIRN`, `Account Number`, or `Meter Number`).

Optional row fields: `Input Type`, `Invoice Number`, `Invoice Date`, `Framework`, `Version`, `Customer`.

**Response:** `{ "confirmed": n, "deleted_pending": n, "warnings": [] }`

```json
{
  "nodes": [
    {
      "parameters": {
        "method": "POST",
        "url": "https://data-tracker-sse-production-185f.up.railway.app/api/ingestion/metered/confirm",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            { "name": "Authorization", "value": "Bearer YOUR_INGESTION_API_KEY" }
          ]
        },
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "{\n  \"rows\": [\n    {\n      \"Company\": \"Your Client Name\",\n      \"Facility\": \"Site A\",\n      \"Provider\": \"Your Supplier Name\",\n      \"Category\": \"ELECTRICITY\",\n      \"NMI\": \"12345678901\",\n      \"Consumption\": 15000,\n      \"Amount ($)\": 3200,\n      \"Date Range\": \"05/03/2026 - 31/03/2026\"\n    }\n  ]\n}",
        "options": {}
      },
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.4,
      "position": [720, 300],
      "name": "Metered Confirm"
    }
  ],
  "connections": {},
  "pinData": {}
}
```

---

## 12 · Metered Error

Sets `PENDING` → `ERROR` for the calendar month derived from the start of `date_range`. Uses the same identifiers as Metered Pending.

**Response:** `{ "updated": n, "period_start_date": "YYYY-MM-DD" }`

```json
{
  "nodes": [
    {
      "parameters": {
        "method": "POST",
        "url": "https://data-tracker-sse-production-185f.up.railway.app/api/ingestion/metered/error",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            { "name": "Authorization", "value": "Bearer YOUR_INGESTION_API_KEY" }
          ]
        },
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "{\n  \"client_name\": \"Your Client Name\",\n  \"supplier_name\": \"Your Supplier Name\",\n  \"utility_name\": \"ELECTRICITY\",\n  \"facility_name\": \"Site A\",\n  \"identifier_type\": \"NMI\",\n  \"lookup1\": \"12345678901\",\n  \"date_range\": \"01/03/2026 - 31/03/2026\"\n}",
        "options": {}
      },
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.4,
      "position": [960, 300],
      "name": "Metered Error"
    }
  ],
  "connections": {},
  "pinData": {}
}
```

---

## Common errors

| HTTP status | Meaning | Fix |
|-------------|---------|-----|
| `401` | Wrong or missing API key | Check `Authorization: Bearer ...` header value |
| `400` | Missing required field | Check that all required body fields are present |
| `404` | Client / supplier / group not found | Verify names match the tracker (case-insensitive) |
| `422` | Group has no members with input types set | Configure member input types in the tracker UI |
| `500` | Server error | Check the Railway logs |
