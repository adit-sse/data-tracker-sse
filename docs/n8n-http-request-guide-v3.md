# n8n HTTP Request Node Templates — Ingestion API (v3)

**Base URL:** `https://data-tracker-sse-production-185f.up.railway.app`  
**Auth header (all nodes):** `Authorization: Bearer <INGESTION_API_KEY>`

> **What changed from v2:** Confirm is now a single unified endpoint. `POST /api/ingestion/unified-confirm` handles non-metered group, non-metered line, and metered rows in one call — auto-detected per row from the presence of `NMI`/`MIRN`/`Account Number`/`Meter Number`. The old separate confirm endpoints still work but are no longer needed for standard workflows. This guide also documents **`GET /api/ingestion/pending-mode`** (see **Pending Mode — GET**, section **2b**) for discovering group categories and standalone-line presence before pending or after confirms.

---

## Logical flow — how the nodes connect

```
Pending — Unified          ← seed PENDING months once per supplier cycle (all scopes)
        ↓  (for each invoice as it arrives)
Confirm — Unified          ← turn PENDING → CONFIRMED for all row types in one call
        ↓  (after ALL invoices for a period are submitted)
Pending Mode — GET         ← optional: read which group categories + standalone lines exist (drive inferred-empty)
        ↓
NM Inferred Empty          ← mark remaining non-metered PENDING as INFERRED_EMPTY (in confirmed months)
        ↓  (very last step)
Revert Pending             ← delete any still-PENDING records → back to "no data"
                              • non-metered (group/line): run AFTER inferred-empty for that scope
                              • metered: run on its own — metered has no inferred-empty step
        ↓  (if a parse fails / a step errors)
Set Line Item to ERROR   ← POST /api/ingestion/unified-error — flips that month's PENDING → ERROR
                              (auto-detects metered / non-metered group / line from the row)
```

**Key rules:**
- Call **Pending — Unified** once at the start of each supplier invoice cycle. It skips months that already have any record.
- **Confirm — Unified** auto-detects row type per row — metered and non-metered rows can be mixed in the same array.
- Confirm only touches what you send. Other facilities, months, and scopes are always left as-is.
- **Pending Mode — GET** is read-only configuration for this client+supplier. Use it **before** pending to branch group vs line bodies, or **after** all confirms to loop **NM Inferred Empty — Group** (each `facility_groups[].category_name`). It also returns `standalone_non_metered_line_count` (not per-line details — use **NM Inferred Empty — Line** when you already know each standalone line).
- Inferred Empty is non-metered only — metered months have no "inferred" concept.
- **Revert Pending** is the **very last** step. It deletes any record still `PENDING` for the scope, returning those months to "no data" (a month with no record renders as gray "No data"). It never touches `CONFIRMED`, `INFERRED_EMPTY`, or other GREEN statuses.
  - **Non-metered (group/line):** run it **after** inferred-empty for the same scope. Inferred-empty converts PENDING → INFERRED_EMPTY for months that got a confirmed record; revert-pending then deletes whatever PENDING is left (e.g. months where nothing was confirmed).
  - **Metered:** run it on its own at the end of the metered confirm cycle — there is no inferred-empty step for metered. Confirm already consumes the PENDING for confirmed months, so revert-pending only clears the unconfirmed leftover months (e.g. you seeded Jan–Jun and only confirmed March). This overlaps with unified-confirm's optional `prune_orphan_pending` flag; use either, but the endpoint also sweeps meters that weren't in the last confirm batch.

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
| Pending Mode — GET | `GET /api/ingestion/pending-mode` | Discover non-metered setup: `pending_mode`, `facility_groups` (with `category_name` for inferred-empty loops), `standalone_non_metered_line_count`; optional before pending or after confirms |
| NM Confirm — Group | `POST /api/ingestion/confirm` | Confirm non-metered group rows only (legacy) |
| NM Confirm — Line | `POST /api/ingestion/confirm` | Confirm non-metered line rows only (legacy) |
| Metered Confirm | `POST /api/ingestion/metered/confirm` | Confirm metered rows only (legacy) |
| NM Inferred Empty — Group | `POST /api/ingestion/inferred-empty` | After all invoices for a period — mark remaining PENDING as INFERRED_EMPTY |
| NM Inferred Empty — Line | `POST /api/ingestion/inferred-empty` | Same, for standalone lines |
| NM Revert Pending — Group | `POST /api/ingestion/revert-pending` | Very last step — delete any still-PENDING group records (back to "no data") |
| NM Revert Pending — Line | `POST /api/ingestion/revert-pending` | Same, for standalone lines |
| Metered Revert Pending | `POST /api/ingestion/revert-pending` | Very last step — delete any still-PENDING metered invoices (back to "no data"); bulk or specific meter |
| NM Error — Group | `POST /api/ingestion/error` | Mark a non-metered group invoice month as ERROR (legacy) |
| NM Error — Line | `POST /api/ingestion/error` | Mark a non-metered line invoice month as ERROR (legacy) |
| Metered Error | `POST /api/ingestion/metered/error` | Mark a metered month as ERROR (legacy) |
| **Set Line Item to ERROR** ⭐ NEW | `POST /api/ingestion/unified-error` | One node for any error source — auto-detects metered / non-metered group / line and flips that month's PENDING → ERROR |

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

**Non-metered behaviour:** Only the submitted facility+period combos are confirmed. Other facilities and months are left untouched. Call `POST /api/ingestion/inferred-empty` after all invoices for a period are submitted. Use **Pending Mode — GET** (section **2b**) if you need the list of group `category` values to loop inferred-empty.

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

## 2b · Pending Mode — GET *(new in this guide)*

Read-only snapshot for this client+supplier: which **facility groups** exist (with NGERS **`category_name`** for each), whether **standalone** non-metered lines exist, and flags that mirror the old pending body choice (`use_group_pending_body`, `use_line_pending_body`).

**Query:** `client_name`, `supplier_name` (case-insensitive), same Bearer auth as other ingestion routes.

**Typical uses:**
- **Before** `POST /api/ingestion/pending` — branch on `pending_mode` (`group` / `line` / `mixed` / `none`).
- **After** all **Confirm — Unified** calls for a period — loop **NM Inferred Empty — Group** once per `facility_groups[]` entry where `category_name` is set (that string is the `category` body field on `POST /api/ingestion/inferred-empty`).

**Response:** Ingestion endpoints keep using **names** (`client_name`, `supplier_name`, `category` on inferred-empty). This GET only accepts those two query names as well. The JSON body below shows the fields you usually **branch on** or pass to the next node; the live API may also include `client_id`, `supplier_id`, and per-group `id` / `category_id` / `name` for debugging or linking — you do not send those to `pending`, `unified-confirm`, or `inferred-empty`.

```json
{
  "client_name": "Your Client Name",
  "supplier_name": "Your Supplier Name",
  "pending_mode": "mixed",
  "facility_groups": [
    {
      "category_name": "Transport Fuels",
      "member_count": 3,
      "ready_for_group_pending": true
    }
  ],
  "standalone_non_metered_line_count": 1,
  "use_group_pending_body": true,
  "use_line_pending_body": true
}
```

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
      "position": [0, 200],
      "name": "Pending Mode — GET"
    }
  ],
  "connections": {},
  "pinData": {}
}
```

---

## 3 · NM Inferred Empty — Group *(unchanged)*

Call after all invoices for a period are submitted. Marks remaining non-metered `PENDING` in confirmed months as `INFERRED_EMPTY`.

Use **`category`** = the NGERS reporting category for that facility group (same string as **`facility_groups[].category_name`** from **Pending Mode — GET**, section **2b**, when you loop one inferred-empty call per group).

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

## 4b · NM Revert Pending — Group *(new)*

The **very last** step of a group confirm cycle. Run it **after** **NM Inferred Empty — Group** for the same `category`. Deletes every `non_metered_records` row still `PENDING` for the group (across all input types / months), returning those months to **"no data"**. `CONFIRMED` and `INFERRED_EMPTY` records are left untouched.

Use the same **`category`** you passed to inferred-empty (the NGERS `facility_groups[].category_name` from **Pending Mode — GET**, section **2b**). When looping per group, call inferred-empty then revert-pending for each `category`.

**Response:** `{ "mode": "group", "reverted": n }`

```json
{
  "nodes": [
    {
      "parameters": {
        "method": "POST",
        "url": "https://data-tracker-sse-production-185f.up.railway.app/api/ingestion/revert-pending",
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
      "position": [480, 600],
      "name": "NM Revert Pending — Group"
    }
  ],
  "connections": {},
  "pinData": {}
}
```

---

## 4c · NM Revert Pending — Line *(new)*

Same as 4b, but for a single standalone non-metered line. Run it **after** **NM Inferred Empty — Line** for the same line. Deletes every `PENDING` record for that facility + supplier + input type, returning those months to **"no data"**. Add `facility_name` when more than one site matches.

**Response:** `{ "mode": "line", "reverted": n }`

```json
{
  "nodes": [
    {
      "parameters": {
        "method": "POST",
        "url": "https://data-tracker-sse-production-185f.up.railway.app/api/ingestion/revert-pending",
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
      "position": [720, 600],
      "name": "NM Revert Pending — Line"
    }
  ],
  "connections": {},
  "pinData": {}
}
```

---

## 4d · Metered Revert Pending *(new)*

The **very last** step of a metered confirm cycle. Deletes every `actual_invoices` row still `PENDING` for the matched meters, returning those months to **"no data"**. `CONFIRMED` / `IMPORTED` / `MANUAL_ENTRY` / `DEACTIVATED` rows are left untouched — confirmed months already had their `PENDING` consumed by **Confirm — Unified**, so this only clears the unconfirmed leftover months (e.g. you seeded Jan–Jun and only confirmed March).

There is **no inferred-empty step for metered** — run this on its own at the end of the metered cycle. This overlaps with unified-confirm's optional `prune_orphan_pending` flag, but the endpoint also sweeps meters that weren't in the last confirm batch.

**Bulk (all meters for client+supplier):** `{ "mode": "metered", "client_name", "supplier_name" }` — optionally narrow with `utility_name` (input type name) and/or `facility_name`.
**Response (bulk):** `{ "mode": "metered", "meters": n, "reverted": n }`

```json
{
  "nodes": [
    {
      "parameters": {
        "method": "POST",
        "url": "https://data-tracker-sse-production-185f.up.railway.app/api/ingestion/revert-pending",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            { "name": "Authorization", "value": "Bearer YOUR_INGESTION_API_KEY" }
          ]
        },
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "{\n  \"mode\": \"metered\",\n  \"client_name\": \"Your Client Name\",\n  \"supplier_name\": \"Your Supplier Name\",\n  \"utility_name\": \"Electricity\"\n}",
        "options": {}
      },
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.4,
      "position": [960, 600],
      "name": "Metered Revert Pending"
    }
  ],
  "connections": {},
  "pinData": {}
}
```

**Specific meter:** add `identifier_type` + `lookup1` (and optional `lookup2`) to target one meter.
**Response (specific):** `{ "mode": "metered", "meter_id": "...", "reverted": n }`

```json
{
  "nodes": [
    {
      "parameters": {
        "method": "POST",
        "url": "https://data-tracker-sse-production-185f.up.railway.app/api/ingestion/revert-pending",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            { "name": "Authorization", "value": "Bearer YOUR_INGESTION_API_KEY" }
          ]
        },
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "{\n  \"mode\": \"metered\",\n  \"client_name\": \"Your Client Name\",\n  \"supplier_name\": \"Your Supplier Name\",\n  \"facility_name\": \"Site A\",\n  \"utility_name\": \"Electricity\",\n  \"identifier_type\": \"NMI\",\n  \"lookup1\": \"12345678901\"\n}",
        "options": {}
      },
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.4,
      "position": [1200, 600],
      "name": "Metered Revert Pending (specific meter)"
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

## 8 · Set Line Item to ERROR ⭐ NEW

One node for **any** error source. When a confirm / inferred-empty / revert-pending call fails, flip that month's `PENDING` row → `ERROR`. Auto-detects scope the same way **Confirm — Unified** does, so it works even for errors that happen *before* the workflow's group/line branch:

- `NMI` / `MIRN` / `Account Number` / `Meter Number` present → metered (`actual_invoices`)
- no meter identifier + non-empty `Category` → non-metered group (`facility_groups`)
- no meter identifier + no `Category` → non-metered line (`non_metered_lines`)

Only `PENDING` rows are flipped. `CONFIRMED` / `INFERRED_EMPTY` / other GREEN statuses are untouched. The optional `reason` is recorded on the `ingestion_events` log.

**Body:** the original NGERS row context + `reason` (built from the row that failed, e.g. `{{ $('If').first().json.Company }}` and `{{ $json.error.message }}` for the reason).

**Response:** `{ "scope": "metered" | "group" | "line", "updated": n, "period_start_date": "YYYY-MM-01", "meter_id"?: "...", "group_id"?: ... }`

```json
{
  "nodes": [
    {
      "parameters": {
        "method": "POST",
        "url": "https://data-tracker-sse-production-185f.up.railway.app/api/ingestion/unified-error",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            { "name": "Authorization", "value": "Bearer YOUR_INGESTION_API_KEY" }
          ]
        },
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "{\n  \"Company\": \"Your Client Name\",\n  \"Provider\": \"Your Supplier Name\",\n  \"Facility\": \"Site A\",\n  \"Category\": \"Electricity\",\n  \"Input Type\": \"kWh\",\n  \"Date Range\": \"01/03/2026 - 31/03/2026\",\n  \"NMI\": \"12345678901\",\n  \"reason\": \"upstream confirm failed: ...\"\n}",
        "options": {}
      },
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.4,
      "position": [720, 900],
      "name": "Set Line Item to ERROR",
      "onError": "continueErrorOutput"
    }
  ],
  "connections": {},
  "pinData": {}
}
```

**Wiring:** fan-out each error output to this node **and** your error-logging node (e.g. Google Sheets) in parallel — don't chain it in front of the logger, or the logger loses the original `$json.error`. This node's `onError: continueErrorOutput` means if the error API itself fails, the item is just dropped and logging is unaffected.

---

## v2 → v3 migration

| v2 node | v3 replacement |
|---------|---------------|
| `NM Confirm — Group` (§3) | **Confirm — Unified** (§2) — include rows without meter identifier fields and with `Category` |
| `NM Confirm — Line` (§4) | **Confirm — Unified** (§2) — include rows without meter identifier fields and without `Category` |
| `Metered Confirm` (§5) | **Confirm — Unified** (§2) — include rows with `NMI`/`MIRN`/`Account Number`/`Meter Number` |
| All other nodes | Unchanged — same endpoint, same body |

The old `POST /api/ingestion/confirm` and `POST /api/ingestion/metered/confirm` endpoints still work and can be called directly if needed.
