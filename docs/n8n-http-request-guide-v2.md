# n8n HTTP Request Node Templates — Ingestion API (v2)

**Base URL:** `https://data-tracker-sse-production-185f.up.railway.app`  
**Auth header (all nodes):** `Authorization: Bearer <INGESTION_API_KEY>`

> **What changed from v1:** Pending is now a single unified endpoint. `POST /api/ingestion/pending` handles Scope 1 non-metered **and** Scope 2 metered in one call — the endpoint auto-detects what's configured for the client+supplier pair and seeds both. The old `POST /api/ingestion/metered/pending` still works but is no longer needed. Everything else (confirm, inferred-empty, error) is unchanged.

---

## Logical flow — how the nodes connect

```
Pending — Unified  ← seed amber PENDING months (once per supplier cycle, covers all scopes)
        ↓  (for each invoice as it arrives)
NM Confirm — Group / Line   ← turn non-metered PENDING → CONFIRMED
Metered Confirm             ← turn metered PENDING → CONFIRMED
        ↓  (after ALL invoices for a period are submitted — non-metered only)
NM Inferred Empty           ← mark remaining non-metered PENDING as INFERRED_EMPTY
        ↓  (if a parse fails)
NM Error / Metered Error    ← mark that period red (ERROR)
```

**Key rules:**
- Call **Pending — Unified** once at the start of each supplier invoice cycle. It skips months that already have any record.
- Confirm only touches what you send. Other facilities, months, and scopes are always left as-is.
- Inferred Empty is non-metered only — metered months have no "inferred" concept.

---

## Quick reference

| Node name | Endpoint | Use when |
|-----------|----------|----------|
| Pending — Unified | `POST /api/ingestion/pending` | Seed all PENDING (Scope 1 non-metered + Scope 2 metered) for a client+supplier |
| Pending — Unified (specific meter) | `POST /api/ingestion/pending` | Seed one specific meter by NMI/MIRN/etc. |
| Pending — Line (non-metered) | `POST /api/ingestion/pending` | Standalone Scope 1 line only |
| NM Confirm — Group | `POST /api/ingestion/confirm` | Confirm parsed rows for a non-metered group invoice |
| NM Confirm — Line | `POST /api/ingestion/confirm` | Confirm parsed rows for a non-metered line invoice |
| NM Inferred Empty — Group | `POST /api/ingestion/inferred-empty` | After all invoices for a period — mark remaining PENDING as INFERRED_EMPTY |
| NM Inferred Empty — Line | `POST /api/ingestion/inferred-empty` | Same, for standalone lines |
| NM Error — Group | `POST /api/ingestion/error` | Mark a non-metered group invoice month as ERROR |
| NM Error — Line | `POST /api/ingestion/error` | Mark a non-metered line invoice month as ERROR |
| Metered Confirm | `POST /api/ingestion/metered/confirm` | Confirm parsed invoice rows for a metered utility |
| Metered Error | `POST /api/ingestion/metered/error` | Mark a metered month as ERROR |

---

## 0 · NM Mixed-Scope Check — GET *(unchanged)*

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
      "name": "NM Mixed-Scope Check — GET"
    }
  ],
  "connections": {},
  "pinData": {}
}
```

---

## 1 · Pending — Unified ⭐ NEW

Seeds `PENDING` for **all** Scope 1 non-metered lines/groups **and** all Scope 2 metered invoices for this client+supplier pair in one call. The endpoint auto-detects what's configured — a Scope 1-only supplier gets `metered.meters: 0` and no error; a Scope 2-only supplier gets `non_metered.summary.created: 0`.

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

## 1b · Pending — Unified (specific meter) ⭐ NEW

Seeds `PENDING` for **one specific meter** identified by `identifier_type` + `lookup1`. Replaces the old `POST /api/ingestion/metered/pending` endpoint — same behaviour, same endpoint URL.

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

## 2 · Pending — Line (non-metered) *(unchanged)*

Seeds `PENDING` for one Scope 1 standalone line. `utility_name` = input type name (e.g. "GREASE"). Add `facility_name` when more than one site matches.

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

## 3 · NM Confirm — Group *(unchanged)*

Turns `PENDING` → `CONFIRMED` for the exact facility+period rows in the payload. Body is a JSON array. Requires `Company`, `Facility`, `Provider`, `Category`, `Input Type`, `Date Range`.

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
      "position": [0, 300],
      "name": "NM Confirm — Group"
    }
  ],
  "connections": {},
  "pinData": {}
}
```

---

## 4 · NM Confirm — Line *(unchanged)*

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
      "position": [240, 300],
      "name": "NM Confirm — Line"
    }
  ],
  "connections": {},
  "pinData": {}
}
```

---

## 5 · Metered Confirm *(unchanged)*

Updates `PENDING` → `CONFIRMED` for the matching meter + calendar month. Drops other FY `PENDING` rows for that meter not in the payload. Requires one of `NMI`, `MIRN`, `Account Number`, or `Meter Number` in each row.

**Response:** `{ "mode": "metered", "confirmed": n, "deleted_pending": n, "warnings": [] }`

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
        "jsonBody": "{\n  \"rows\": [\n    {\n      \"Company\": \"Your Client Name\",\n      \"Facility\": \"Site A\",\n      \"Provider\": \"Your Supplier Name\",\n      \"Category\": \"Electricity\",\n      \"NMI\": \"12345678901\",\n      \"Consumption\": 15000,\n      \"Amount ($)\": 3200,\n      \"Date Range\": \"01/03/2026 - 31/03/2026\"\n    }\n  ]\n}",
        "options": {}
      },
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.4,
      "position": [480, 300],
      "name": "Metered Confirm"
    }
  ],
  "connections": {},
  "pinData": {}
}
```

---

## 6 · NM Inferred Empty — Group *(unchanged)*

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

## 7 · NM Inferred Empty — Line *(unchanged)*

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

## 8 · NM Error — Group *(unchanged)*

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

## 9 · NM Error — Line *(unchanged)*

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

## 10 · Metered Error *(unchanged)*

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

## v1 → v2 migration

| v1 node | v2 replacement |
|---------|---------------|
| `NM Pending — Scope 1 bulk` (§1) | **Pending — Unified** (§1) — same body, now also seeds metered |
| `NM Pending — Group` (§2) | Still works via `utility_name` in the same endpoint |
| `Metered Pending` (§10 in v1) | **Pending — Unified** bulk (§1) for all meters, or **Pending — Unified (specific meter)** (§1b) for one NMI/MIRN |
| All other nodes | Unchanged — same endpoint, same body |

The old `POST /api/ingestion/metered/pending` endpoint still works and can be called directly if needed.
