# n8n HTTP Request Node Templates — Ingestion API

**Base URL:** `https://data-tracker-sse-production.up.railway.app`  
**Auth header (all nodes):** `Authorization: Bearer <INGESTION_API_KEY>`

> Replace all `"Your Client Name"`, `"Your Supplier Name"`, `"Site A"`, etc. with real values from the tracker. Names are matched case-insensitively except facility names in confirm (must match exactly).

---

## Quick reference

| Node name | Endpoint | Use when |
|-----------|----------|----------|
| NM Pending — Group | `POST /api/ingestion/pending` | Non-metered, invoice covers multiple facilities in a group |
| NM Pending — Line | `POST /api/ingestion/pending` | Non-metered, single site/category, no group |
| NM Confirm — Group | `POST /api/ingestion/confirm` | Confirm parsed rows for a group invoice |
| NM Confirm — Line | `POST /api/ingestion/confirm` | Confirm parsed rows for a line invoice |
| NM Error — Group | `POST /api/ingestion/error` | Mark a group invoice month as ERROR |
| NM Error — Line | `POST /api/ingestion/error` | Mark a line invoice month as ERROR |
| Metered Pending | `POST /api/ingestion/metered/pending` | Metered utility (electricity, gas) — seed PENDING rows |
| Metered Confirm | `POST /api/ingestion/metered/confirm` | Metered utility — confirm parsed invoice rows |
| Metered Error | `POST /api/ingestion/metered/error` | Metered utility — mark a month as ERROR |

---

## How to import a node

1. Copy the JSON block for the node you want.
2. In n8n, open your workflow canvas.
3. Press `Ctrl+V` (or `Cmd+V`) — n8n will paste it as a ready-to-use node.
4. Fill in the placeholder values in `jsonBody`.

---

## 1 · NM Pending — Group

Seeds `PENDING` non-metered records for every fiscal month (Jul → today) across all facilities in the matching group.

**Response:** `{ "created": n, "skipped": n }`

```json
{
  "nodes": [
    {
      "parameters": {
        "method": "POST",
        "url": "https://data-tracker-sse-production.up.railway.app/api/ingestion/pending",
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
      "name": "NM Pending — Group"
    }
  ],
  "connections": {},
  "pinData": {}
}
```

---

## 2 · NM Pending — Line

Seeds `PENDING` non-metered records for a single site + category. Will create the utility category if it does not exist yet.

**Response:** `{ "mode": "line", "resolved": { ... }, "created": n, "skipped": n }`

```json
{
  "nodes": [
    {
      "parameters": {
        "method": "POST",
        "url": "https://data-tracker-sse-production.up.railway.app/api/ingestion/pending",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            { "name": "Authorization", "value": "Bearer YOUR_INGESTION_API_KEY" }
          ]
        },
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "{\n  \"mode\": \"line\",\n  \"client_name\": \"Your Client Name\",\n  \"supplier_name\": \"Your Supplier Name\",\n  \"utility_name\": \"GREASE\",\n  \"facility_name\": \"Site A\"\n}",
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

## 3 · NM Confirm — Group

Turns `PENDING` → `CONFIRMED` for matched rows. Sets `INFERRED_EMPTY` for group members absent from the invoice. Drops `PENDING` for months not in this payload.

Body is a **JSON array** of NGERS-style row objects.

**Response:** `{ "mode": "group", "confirmed": n, "inferred_empty": n, "deleted_pending": n, "warnings": [] }`

```json
{
  "nodes": [
    {
      "parameters": {
        "method": "POST",
        "url": "https://data-tracker-sse-production.up.railway.app/api/ingestion/confirm",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            { "name": "Authorization", "value": "Bearer YOUR_INGESTION_API_KEY" }
          ]
        },
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "[\n  {\n    \"Company\": \"Your Client Name\",\n    \"Facility\": \"Site A\",\n    \"Provider\": \"Your Supplier Name\",\n    \"Category\": \"Transport Fuels\",\n    \"Consumption\": 1000,\n    \"Amount ($)\": 5000,\n    \"Date Range\": \"01/03/2026 - 31/03/2026\"\n  }\n]",
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

## 4 · NM Confirm — Line

Same confirm logic as group but for a single line. Body is an **object** with a `mode` and `rows` array.

**Response:** `{ "mode": "line", "confirmed": n, "inferred_empty": n, "deleted_pending": n, "warnings": [] }`

```json
{
  "nodes": [
    {
      "parameters": {
        "method": "POST",
        "url": "https://data-tracker-sse-production.up.railway.app/api/ingestion/confirm",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            { "name": "Authorization", "value": "Bearer YOUR_INGESTION_API_KEY" }
          ]
        },
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "{\n  \"mode\": \"line\",\n  \"rows\": [\n    {\n      \"Company\": \"Your Client Name\",\n      \"Facility\": \"Site A\",\n      \"Provider\": \"Your Supplier Name\",\n      \"Category\": \"GREASE\",\n      \"Consumption\": 42.5,\n      \"Amount ($)\": 1200,\n      \"Date Range\": \"01/03/2026 - 31/03/2026\"\n    }\n  ]\n}",
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

## 5 · NM Error — Group

Sets `PENDING` → `ERROR` for the calendar month derived from the start of `date_range`.

**Response:** `{ "updated": n, "period_start_date": "YYYY-MM-DD" }`

```json
{
  "nodes": [
    {
      "parameters": {
        "method": "POST",
        "url": "https://data-tracker-sse-production.up.railway.app/api/ingestion/error",
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
      "position": [960, 0],
      "name": "NM Error — Group"
    }
  ],
  "connections": {},
  "pinData": {}
}
```

---

## 6 · NM Error — Line

Same as group error but scoped to one site + category.

**Response:** `{ "updated": n, "period_start_date": "YYYY-MM-DD" }`

```json
{
  "nodes": [
    {
      "parameters": {
        "method": "POST",
        "url": "https://data-tracker-sse-production.up.railway.app/api/ingestion/error",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            { "name": "Authorization", "value": "Bearer YOUR_INGESTION_API_KEY" }
          ]
        },
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "{\n  \"mode\": \"line\",\n  \"client_name\": \"Your Client Name\",\n  \"supplier_name\": \"Your Supplier Name\",\n  \"utility_name\": \"GREASE\",\n  \"facility_name\": \"Site A\",\n  \"date_range\": \"01/03/2026 - 31/03/2026\"\n}",
        "options": {}
      },
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.4,
      "position": [1200, 0],
      "name": "NM Error — Line"
    }
  ],
  "connections": {},
  "pinData": {}
}
```

---

## 7 · Metered Pending

Seeds one `PENDING` invoice row per fiscal month (Jul → today) that is still empty for the given meter. The meter must already exist in the tracker.

`identifier_type` is one of: `NMI`, `MIRN`, `Account Number`, `Meter Number`.  
`lookup2` is optional (use `null` if not needed).

**Response:** `{ "created": n, "skipped": n }`

```json
{
  "nodes": [
    {
      "parameters": {
        "method": "POST",
        "url": "https://data-tracker-sse-production.up.railway.app/api/ingestion/metered/pending",
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
      "position": [0, 300],
      "name": "Metered Pending"
    }
  ],
  "connections": {},
  "pinData": {}
}
```

---

## 8 · Metered Confirm

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
        "url": "https://data-tracker-sse-production.up.railway.app/api/ingestion/metered/confirm",
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
      "position": [240, 300],
      "name": "Metered Confirm"
    }
  ],
  "connections": {},
  "pinData": {}
}
```

---

## 9 · Metered Error

Sets `PENDING` → `ERROR` for the calendar month derived from the start of `date_range`. Uses the same identifiers as Metered Pending.

**Response:** `{ "updated": n, "period_start_date": "YYYY-MM-DD" }`

```json
{
  "nodes": [
    {
      "parameters": {
        "method": "POST",
        "url": "https://data-tracker-sse-production.up.railway.app/api/ingestion/metered/error",
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
      "position": [480, 300],
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
| `422` | Group has no members with categories set | Configure member utility types in the tracker UI |
| `500` | Server error | Check the Railway logs |
