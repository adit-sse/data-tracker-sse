# n8n HTTP Request Node Templates — Ingestion API (v3)

**Base URL:** `https://data-tracker-sse-production-185f.up.railway.app`  
**Auth header (all nodes):** `Authorization: Bearer <INGESTION_API_KEY>`

> **What changed from v2:** Confirm is now a single unified endpoint. `POST /api/ingestion/unified-confirm` handles non-metered group, non-metered line, and metered rows in one call — auto-detected per row from the presence of `NMI`/`MIRN`/`Account Number`/`Meter Number`. The old separate confirm endpoints still work but are no longer needed for standard workflows.

---

## Logical flow — how the nodes connect

```
Pending — Unified          ← seed PENDING months once per supplier cycle (all scopes)
        ↓  (for each invoice as it arrives)
Confirm — Unified          ← turn PENDING → CONFIRMED for all row types in one call
        ↓  (after ALL invoices for a period are submitted — non-metered only)
NM Inferred Empty          ← mark remaining non-metered PENDING as INFERRED_EMPTY
        ↓  (if a parse fails)
Error — NM / Metered       ← mark that period as ERROR
```

**Key rules:**
- Call **Pending — Unified** once at the start of each supplier invoice cycle. It skips months that already have any record.
- **Confirm — Unified** auto-detects row type per row — metered and non-metered rows can be mixed in the same array.
- Confirm only touches what you send. Other facilities, months, and scopes are always left as-is.
- Inferred Empty is non-metered only — metered months have no "inferred" concept.

---

## Row type auto-detection

The unified confirm classifies each row independently before processing:

| Row has... | Detected as | Table written |
|---|---|---|
| `NMI`, `MIRN`, `Account Number`, or `Meter Number` (any non-empty) | **Metered** | `actual_invoices` |
| None of the above + non-empty `Category` | **Non-metered group** | `non_metered_records` via `facility_groups` |
| None of the above + no `Category` | **Non-metered line** | `non_metered_records` via `non_metered_lines` |

---

## Quick reference

| Node name | Endpoint | Use when |
|-----------|----------|----------|
| Mixed-Scope Check — GET | `GET /api/ingestion/mixed-scope` | Pre-check: does this supplier serve both Scope 1 and Scope 2? If yes, skip pending and go straight to confirm |
| Pending — Unified | `POST /api/ingestion/pending` | Seed all PENDING (Scope 1 non-metered + Scope 2 metered) for a client+supplier |
| Pending — Unified (specific meter) | `POST /api/ingestion/pending` | Seed one specific meter by NMI/MIRN/etc. |
| Pending — Line (non-metered) | `POST /api/ingestion/pending` | Standalone Scope 1 line only |
| **Confirm — Unified** ⭐ NEW | `POST /api/ingestion/unified-confirm` | Confirm any mix of metered + non-metered group + non-metered line rows in one call |
| NM Confirm — Group | `POST /api/ingestion/confirm` | Confirm non-metered group rows only (legacy) |
| NM Confirm — Line | `POST /api/ingestion/confirm` | Confirm non-metered line rows only (legacy) |
| Metered Confirm | `POST /api/ingestion/metered/confirm` | Confirm metered rows only (legacy) |
| NM Inferred Empty — Group | `POST /api/ingestion/inferred-empty` | After all invoices for a period — mark remaining PENDING as INFERRED_EMPTY |
| NM Inferred Empty — Line | `POST /api/ingestion/inferred-empty` | Same, for standalone lines |
| NM Error — Group | `POST /api/ingestion/error` | Mark a non-metered group invoice month as ERROR |
| NM Error — Line | `POST /api/ingestion/error` | Mark a non-metered line invoice month as ERROR |
| Metered Error | `POST /api/ingestion/metered/error` | Mark a metered month as ERROR |

---

## 0 · Mixed-Scope Check — GET *(unchanged)*

Call this before anything else. If `has_mixed_scopes` is `true`, skip **Pending — Unified** and go straight to Confirm — confirm will upsert a `CONFIRMED` record without a prior `PENDING` row.

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
      "name": "Mixed-Scope Check — GET"
    }
  ],
  "connections": {},
  "pinData": {}
}
```

---

## 1 · Pending — Unified *(unchanged)*

Seeds `PENDING` for **all** Scope 1 non-metered lines/groups **and** all Scope 2 metered invoices for this client+supplier pair in one call.

**Response:**
```json
{
  "client_id": "...",
  "supplier_id": "...",
  "non_metered": {
    "groups": [{ "category_name": "Transport Fuels", "created": 4, "skipped": 2 }],
    "lines": [],
    "summary": { "created": 4, "skipped": 2 }
  },
  "metered": { "meters": 3, "created": 30, "skipped": 0 }
}
```

`404` only if **neither** non-metered lines nor meters exist for this pair.

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
      "name": "Pending — Unified"
    }
  ],
  "connections": {},
  "pinData": {}
}
```

---

## 1b · Pending — Unified (specific meter) *(unchanged)*

Seeds `PENDING` for **one specific meter** identified by `identifier_type` + `lookup1`.

**Response:** `{ "mode": "metered", "meter_id": "...", "created": n, "skipped": n }`

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
        "jsonBody": "{\n  \"client_name\": \"Your Client Name\",\n  \"supplier_name\": \"Your Supplier Name\",\n  \"utility_name\": \"Electricity\",\n  \"facility_name\": \"Site A\",\n  \"identifier_type\": \"NMI\",\n  \"lookup1\": \"12345678901\"\n}",
        "options": {}
      },
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.4,
      "position": [240, 0],
      "name": "Pending — Unified (specific meter)"
    }
  ],
  "connections": {},
  "pinData": {}
}
```

---

## 1c · Pending — Line (non-metered) *(unchanged)*

Seeds `PENDING` for one Scope 1 standalone line. `utility_name` = input type name (e.g. `"GREASE"`). Add `facility_name` when more than one site matches.

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
      "position": [480, 0],
      "name": "Pending — Line (non-metered)"
    }
  ],
  "connections": {},
  "pinData": {}
}
```

---

## 2 · Confirm — Unified ⭐ NEW

Turns `PENDING` → `CONFIRMED` for every row in the payload. Row type is **auto-detected per row** — metered, non-metered group, and non-metered line rows can all be mixed in the same array.

**Detection logic per row:**
- Has `NMI`, `MIRN`, `Account Number`, or `Meter Number` → **metered** (`actual_invoices`)
- None of the above + non-empty `Category` → **non-metered group** (`facility_groups` → `non_metered_records`)
- None of the above + no `Category` → **non-metered line** (`non_metered_lines` → `non_metered_records`)

**Required fields per row type:**

| Field | Metered | NM Group | NM Line |
|---|---|---|---|
| `Company` | ✅ | ✅ | ✅ |
| `Provider` | ✅ | ✅ | ✅ |
| `Facility` | ✅ | ✅ | ✅ |
| `Category` | ✅ | ✅ | — |
| `Input Type` | optional | ✅ | ✅ |
| `Date Range` | ✅ `DD/MM/YYYY - DD/MM/YYYY` | ✅ | ✅ |
| `NMI` / `MIRN` / `Account Number` / `Meter Number` | ✅ (one of) | — | — |
| `Consumption` | optional | — | — |
| `Amount ($)` | optional | — | — |
| `Invoice Number` | optional | — | — |
| `Invoice Date` | optional | — | — |

**Response:**
```json
{
  "non_metered": { "confirmed": 3, "warnings": [] },
  "metered":     { "confirmed": 2, "deleted_pending": 2, "warnings": [] }
}
```

**Metered behaviour:** Updates the matching `PENDING` placeholder to `CONFIRMED` with exact period dates and consumption/amount from the row. Any other `PENDING` rows in the fiscal year for that meter that were not in the payload are deleted (they represent months with no invoice).

**Non-metered behaviour:** Only the submitted facility+period combos are confirmed. Other facilities and months are left untouched. Call `POST /api/ingestion/inferred-empty` after all invoices for a period are submitted.

```json
{
  "nodes": [
    {
      "parameters": {
        "method": "POST",
        "url": "https://data-tracker-sse-production-185f.up.railway.app/api/ingestion/unified-confirm",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            { "name": "Authorization", "value": "Bearer YOUR_INGESTION_API_KEY" }
          ]
        },
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "[\n  {\n    \"Company\": \"Your Client Name\",\n    \"Provider\": \"Your Supplier Name\",\n    \"Facility\": \"Site A\",\n    \"Category\": \"Electricity\",\n    \"NMI\": \"12345678901\",\n    \"Input Type\": \"kWh\",\n    \"Date Range\": \"01/03/2026 - 31/03/2026\",\n    \"Consumption\": 15000,\n    \"Amount ($)\": 3200\n  },\n  {\n    \"Company\": \"Your Client Name\",\n    \"Provider\": \"Your Supplier Name\",\n    \"Facility\": \"Site A\",\n    \"Category\": \"Transport Fuels\",\n    \"Input Type\": \"Diesel oil\",\n    \"Date Range\": \"01/03/2026 - 31/03/2026\"\n  },\n  {\n    \"Company\": \"Your Client Name\",\n    \"Provider\": \"Your Supplier Name\",\n    \"Facility\": \"Site B\",\n    \"Input Type\": \"GREASE\",\n    \"Date Range\": \"01/03/2026 - 31/03/2026\"\n  }\n]",
        "options": {}
      },
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.4,
      "position": [0, 300],
      "name": "Confirm — Unified"
    }
  ],
  "connections": {},
  "pinData": {}
}
```

---

## 3 · NM Inferred Empty — Group *(unchanged)*

Call after all invoices for a period are submitted. Marks remaining non-metered `PENDING` in confirmed months as `INFERRED_EMPTY`.

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
      "position": [0, 600],
      "name": "NM Inferred Empty — Group"
    }
  ],
  "connections": {},
  "pinData": {}
}
```

---

## 4 · NM Inferred Empty — Line *(unchanged)*

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
      "position": [240, 600],
      "name": "NM Inferred Empty — Line"
    }
  ],
  "connections": {},
  "pinData": {}
}
```

---

## 5 · NM Error — Group *(unchanged)*

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
      "position": [0, 900],
      "name": "NM Error — Group"
    }
  ],
  "connections": {},
  "pinData": {}
}
```

---

## 6 · NM Error — Line *(unchanged)*

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
      "position": [240, 900],
      "name": "NM Error — Line"
    }
  ],
  "connections": {},
  "pinData": {}
}
```

---

## 7 · Metered Error *(unchanged)*

Sets metered `PENDING` → `ERROR` for the calendar month derived from `date_range`.

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
        "jsonBody": "{\n  \"client_name\": \"Your Client Name\",\n  \"supplier_name\": \"Your Supplier Name\",\n  \"utility_name\": \"Electricity\",\n  \"facility_name\": \"Site A\",\n  \"identifier_type\": \"NMI\",\n  \"lookup1\": \"12345678901\",\n  \"date_range\": \"01/03/2026 - 31/03/2026\"\n}",
        "options": {}
      },
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.4,
      "position": [480, 900],
      "name": "Metered Error"
    }
  ],
  "connections": {},
  "pinData": {}
}
```

---

## v2 → v3 migration

| v2 node | v3 replacement |
|---------|---------------|
| `NM Confirm — Group` (§3) | **Confirm — Unified** (§2) — include rows without meter identifier fields and with `Category` |
| `NM Confirm — Line` (§4) | **Confirm — Unified** (§2) — include rows without meter identifier fields and without `Category` |
| `Metered Confirm` (§5) | **Confirm — Unified** (§2) — include rows with `NMI`/`MIRN`/`Account Number`/`Meter Number` |
| All other nodes | Unchanged — same endpoint, same body |

The old `POST /api/ingestion/confirm` and `POST /api/ingestion/metered/confirm` endpoints still work and can be called directly if needed.
