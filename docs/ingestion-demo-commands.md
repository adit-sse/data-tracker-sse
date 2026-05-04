# Ingestion API — demo command sheet

Each block is **copy-paste** ready (localhost + Bearer key inlined). Rotate the key in `.env.local` if this file is shared.

> Adjust **supplier / facility / category names** if yours differ. **`client_name`** and NGERS **`Company`** use **`Test Client`** everywhere below. Dates use **FY2026** (Jul 2025–Jun 2026); **Feb/Mar 2026** = `FEB 26` / `MAR 26` in the UI.  
> Run **`node scripts/seed-ingestion-test-subject.mjs`** first so **`Test Client`** exists together with **`BFcards`** and Scope 1 lines (see [ingestion-test-subject.md](./ingestion-test-subject.md)).  
> **`404`** on **`POST .../pending`** (body is only `client_name` + `supplier_name`) means **no Scope 1 coverage** for that pair in the database—wrong supplier name, client not seeded, or nothing linked yet.  
> **PowerShell:** In **`@{ ... }`** bodies, use **single quotes** for names that contain **`[INGESTION TEST]`** (e.g. `utility_name = '[INGESTION TEST] …'`). Double quotes make `[...]` act like wildcards and can produce a `400` error.

---

## Logical flow

```
A1: Pending  →  A2: Confirm (one invoice at a time)  →  A5: Inferred Empty (after all invoices in)
                A4: Error (on parse failure)
```

Key behaviour:
- **Confirm only touches what you send.** Other facilities, other months, and other input types are always left as-is.
- **Pending is always safe to re-run.** It skips months that already have any record.
- **Inferred Empty** finalises a period: for every month that has at least one CONFIRMED record in the group, any remaining PENDING records in that month are set to INFERRED_EMPTY. Months with no confirmed records are left untouched.

---

## Part A — **Group** workflow (seeded supplier **BFcards**)

Uses the same names as **`scripts/seed-ingestion-test-subject.mjs`** (**BFcards**, **`[INGESTION TEST] Sandbox Transport`**, Group Site Alpha/Beta).

Alpha tracks **`[INGESTION TEST] Sandbox Fuel Alpha`**; Beta tracks **`[INGESTION TEST] Sandbox Fuel Beta`**.

### A1 — Pending (Scope 1: client + supplier only)

`POST /api/ingestion/pending` seeds **all** Scope 1 non-metered coverage for this client–supplier pair (every qualifying facility group **and** standalone lines). You do **not** need `utility_name` here.

To seed **only** the sandbox Transport group instead of everything for **Test Client** + **BFcards**, add `utility_name = '[INGESTION TEST] Sandbox Transport'` (NGERS category name on the group).

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/ingestion/pending" -Method POST `
  -Headers @{ Authorization = "Bearer kYMHYor0QzncWaLS_qI1ID6gVqDHcH1QvBz6Xd3bHXE" } `
  -ContentType "application/json; charset=utf-8" `
  -Body (@{
    client_name   = "Test Client"
    supplier_name = "BFcards"
  } | ConvertTo-Json)
```

### A2 — Confirm **February 2026** (Alpha + Beta, separate input types in one call)

Each site has its own **`Input Type`**. Batching both rows in one call is fine because they group by `(Company, Provider, Category, Input Type)` separately.

`Consumption` and `Amount ($)` are **not** stored — omit them.

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/ingestion/confirm" -Method POST `
  -Headers @{ Authorization = "Bearer kYMHYor0QzncWaLS_qI1ID6gVqDHcH1QvBz6Xd3bHXE" } `
  -ContentType "application/json; charset=utf-8" `
  -Body @'
[
  {
    "Company": "Test Client",
    "Facility": "[INGESTION TEST] Group Site Alpha",
    "Provider": "BFcards",
    "Category": "[INGESTION TEST] Sandbox Transport",
    "Input Type": "[INGESTION TEST] Sandbox Fuel Alpha",
    "Date Range": "01/02/2026 - 28/02/2026"
  },
  {
    "Company": "Test Client",
    "Facility": "[INGESTION TEST] Group Site Beta",
    "Provider": "BFcards",
    "Category": "[INGESTION TEST] Sandbox Transport",
    "Input Type": "[INGESTION TEST] Sandbox Fuel Beta",
    "Date Range": "01/02/2026 - 28/02/2026"
  }
]
'@
```

**Expected response:** `{ "mode": "group", "confirmed": 2, "warnings": [] }`

### A2b — Confirm only one site (per-facility invoice example)

In real workflows, invoices arrive one facility at a time. Call confirm for each as it arrives — the other facility's records are untouched.

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/ingestion/confirm" -Method POST `
  -Headers @{ Authorization = "Bearer kYMHYor0QzncWaLS_qI1ID6gVqDHcH1QvBz6Xd3bHXE" } `
  -ContentType "application/json; charset=utf-8" `
  -Body @'
[
  {
    "Company": "Test Client",
    "Facility": "[INGESTION TEST] Group Site Alpha",
    "Provider": "BFcards",
    "Category": "[INGESTION TEST] Sandbox Transport",
    "Input Type": "[INGESTION TEST] Sandbox Fuel Alpha",
    "Date Range": "01/03/2026 - 31/03/2026"
  }
]
'@
```

**Expected response:** `{ "mode": "group", "confirmed": 1, "warnings": [] }`  
Beta March is still PENDING — call A5 once Beta is confirmed too.

### A3 — Pending again (always safe — skips existing records)

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/ingestion/pending" -Method POST `
  -Headers @{ Authorization = "Bearer kYMHYor0QzncWaLS_qI1ID6gVqDHcH1QvBz6Xd3bHXE" } `
  -ContentType "application/json; charset=utf-8" `
  -Body (@{
    client_name   = "Test Client"
    supplier_name = "BFcards"
  } | ConvertTo-Json)
```

### A4 — **Error** March 2026 (group — flips March PENDING → ERROR for the whole group)

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/ingestion/error" -Method POST `
  -Headers @{ Authorization = "Bearer kYMHYor0QzncWaLS_qI1ID6gVqDHcH1QvBz6Xd3bHXE" } `
  -ContentType "application/json; charset=utf-8" `
  -Body (@{
    client_name   = "Test Client"
    supplier_name = "BFcards"
    utility_name  = '[INGESTION TEST] Sandbox Transport'
    date_range    = "01/03/2026 - 31/03/2026"
  } | ConvertTo-Json)
```

### A5 — **Inferred Empty** (call after all invoices for a period are confirmed)

Once all facility invoices for a period are submitted, this marks any remaining PENDING records in confirmed months as INFERRED_EMPTY. Months with no confirmed records are left untouched.

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/ingestion/inferred-empty" -Method POST `
  -Headers @{ Authorization = "Bearer kYMHYor0QzncWaLS_qI1ID6gVqDHcH1QvBz6Xd3bHXE" } `
  -ContentType "application/json; charset=utf-8" `
  -Body (@{
    client_name   = "Test Client"
    supplier_name = "BFcards"
    category      = '[INGESTION TEST] Sandbox Transport'
  } | ConvertTo-Json)
```

**Expected response:** `{ "mode": "group", "inferred_empty": n, "confirmed_periods_checked": n }`  
Any month where at least one member is CONFIRMED will have its remaining PENDING members set to INFERRED_EMPTY. Months with no confirmed records are left as PENDING.

---

## Part B — **NAPA** single line (Geraldton · GREASE)

> **Not** created by the seed script — only use these after you register **Test Client** + **NAPA** + **GREASE** + site **Geraldton** in the tracker. For copy-paste after **`seed-ingestion-test-subject.mjs`**, use **Part C** line commands (**Sandbox Standalone Utility** · **Line Only Site**) instead.  
> No facility group required. You can omit **`facility_name`** when only Geraldton has that line; otherwise pass **`facility_name`** or you may get **`409`**.

### B1 — Line pending

Explicit site:

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/ingestion/pending" -Method POST `
  -Headers @{ Authorization = "Bearer kYMHYor0QzncWaLS_qI1ID6gVqDHcH1QvBz6Xd3bHXE" } `
  -ContentType "application/json; charset=utf-8" `
  -Body (@{
    mode          = "line"
    client_name   = "Test Client"
    facility_name = "Geraldton"
    supplier_name = "NAPA"
    utility_name  = "GREASE"
  } | ConvertTo-Json)
```

Same call **without** `facility_name` (only valid when this supplier + GREASE line exists at a single facility under **Test Client**):

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/ingestion/pending" -Method POST `
  -Headers @{ Authorization = "Bearer kYMHYor0QzncWaLS_qI1ID6gVqDHcH1QvBz6Xd3bHXE" } `
  -ContentType "application/json; charset=utf-8" `
  -Body (@{
    mode          = "line"
    client_name   = "Test Client"
    supplier_name = "NAPA"
    utility_name  = "GREASE"
  } | ConvertTo-Json)
```

### B2 — Line confirm (March 2026 example)

`Input Type` is required. `Category` is optional for line mode and omitted here.

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/ingestion/confirm" -Method POST `
  -Headers @{ Authorization = "Bearer kYMHYor0QzncWaLS_qI1ID6gVqDHcH1QvBz6Xd3bHXE" } `
  -ContentType "application/json; charset=utf-8" `
  -Body (@{
    mode = "line"
    rows = @(
      @{
        Company      = "Test Client"
        Facility     = "Geraldton"
        Provider     = "NAPA"
        "Input Type" = "GREASE"
        "Date Range" = "01/03/2026 - 31/03/2026"
      }
    )
  } | ConvertTo-Json -Depth 6)
```

### B3 — Line pending again

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/ingestion/pending" -Method POST `
  -Headers @{ Authorization = "Bearer kYMHYor0QzncWaLS_qI1ID6gVqDHcH1QvBz6Xd3bHXE" } `
  -ContentType "application/json; charset=utf-8" `
  -Body (@{
    mode          = "line"
    client_name   = "Test Client"
    facility_name = "Geraldton"
    supplier_name = "NAPA"
    utility_name  = "GREASE"
  } | ConvertTo-Json)
```

### B4 — Line error (March 2026 — PENDING → ERROR for that line only)

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/ingestion/error" -Method POST `
  -Headers @{ Authorization = "Bearer kYMHYor0QzncWaLS_qI1ID6gVqDHcH1QvBz6Xd3bHXE" } `
  -ContentType "application/json; charset=utf-8" `
  -Body (@{
    mode          = "line"
    client_name   = "Test Client"
    facility_name = "Geraldton"
    supplier_name = "NAPA"
    utility_name  = "GREASE"
    date_range    = "01/03/2026 - 31/03/2026"
  } | ConvertTo-Json)
```

---

## Part C — Seeded sandbox (**Test Client**)

Use this after seeding an isolated client (dev/staging only). The seed creates **`Test Client`** plus **`[INGESTION TEST] …`** suppliers and facilities (see table in [ingestion-test-subject.md](./ingestion-test-subject.md)).

```powershell
node scripts/seed-ingestion-test-subject.mjs
# or reset:
node scripts/seed-ingestion-test-subject.mjs --force
```

### C0 — Pending (**Scope 1 bulk** — client + supplier only)

Seeds all Scope 1 group + standalone lines for **Test Client** (BFcards group + BFcards standalone + **Agas national** standalone).

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/ingestion/pending" -Method POST `
  -Headers @{ Authorization = "Bearer kYMHYor0QzncWaLS_qI1ID6gVqDHcH1QvBz6Xd3bHXE" } `
  -ContentType "application/json; charset=utf-8" `
  -Body (@{
    client_name   = "Test Client"
    supplier_name = "BFcards"
  } | ConvertTo-Json)
```

### C1 — Pending (**group** — single NGERS category)

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/ingestion/pending" -Method POST `
  -Headers @{ Authorization = "Bearer kYMHYor0QzncWaLS_qI1ID6gVqDHcH1QvBz6Xd3bHXE" } `
  -ContentType "application/json; charset=utf-8" `
  -Body (@{
    client_name   = "Test Client"
    supplier_name = "BFcards"
    utility_name  = '[INGESTION TEST] Sandbox Transport'
  } | ConvertTo-Json)
```

### C2 — **GET** pending-mode (branch group vs line before calling pending)

```powershell
$baseUrl = "http://localhost:3000"
$c = "Test Client"
$s = "BFcards"
$q = "client_name=$([uri]::EscapeDataString($c))&supplier_name=$([uri]::EscapeDataString($s))"
Invoke-RestMethod -Uri "$baseUrl/api/ingestion/pending-mode?$q" `
  -Headers @{ Authorization = "Bearer kYMHYor0QzncWaLS_qI1ID6gVqDHcH1QvBz6Xd3bHXE" }
```

### C3 — Pending (**line** mode — standalone utility, BFcards)

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/ingestion/pending" -Method POST `
  -Headers @{ Authorization = "Bearer kYMHYor0QzncWaLS_qI1ID6gVqDHcH1QvBz6Xd3bHXE" } `
  -ContentType "application/json; charset=utf-8" `
  -Body (@{
    mode           = "line"
    client_name    = "Test Client"
    supplier_name  = "BFcards"
    utility_name   = '[INGESTION TEST] Sandbox Standalone Utility'
    facility_name  = '[INGESTION TEST] Line Only Site'
  } | ConvertTo-Json)
```

### C3b — Line pending (**Agas national**)

Same site as **C3** (`[INGESTION TEST] Line Only Site`); only one line row exists for **Test Client** + **Agas national** + **`[INGESTION TEST] Agas National Demo Utility`**, so **`facility_name`** may be omitted.

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/ingestion/pending" -Method POST `
  -Headers @{ Authorization = "Bearer kYMHYor0QzncWaLS_qI1ID6gVqDHcH1QvBz6Xd3bHXE" } `
  -ContentType "application/json; charset=utf-8" `
  -Body (@{
    mode           = "line"
    client_name    = "Test Client"
    supplier_name  = "Agas national"
    utility_name   = '[INGESTION TEST] Agas National Demo Utility'
  } | ConvertTo-Json)
```

Optional: add **`facility_name = '[INGESTION TEST] Line Only Site'`** explicitly.

### C4 — Metered pending (electricity at **Line Only Site**)

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/ingestion/metered/pending" -Method POST `
  -Headers @{ Authorization = "Bearer kYMHYor0QzncWaLS_qI1ID6gVqDHcH1QvBz6Xd3bHXE" } `
  -ContentType "application/json; charset=utf-8" `
  -Body (@{
    client_name     = "Test Client"
    supplier_name   = "BFcards"
    utility_name    = '[INGESTION TEST] Sandbox Test Electricity'
    facility_name   = '[INGESTION TEST] Line Only Site'
    identifier_type = "NMI"
    lookup1         = "999000111222333"
  } | ConvertTo-Json)
```

### C5 — Group **confirm** (March 2026 — Alpha then Beta, one per invoice)

Alpha and Beta have **different input types**, so confirm each as its invoice arrives.

**Alpha (Sandbox Fuel Alpha):**

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/ingestion/confirm" -Method POST `
  -Headers @{ Authorization = "Bearer kYMHYor0QzncWaLS_qI1ID6gVqDHcH1QvBz6Xd3bHXE" } `
  -ContentType "application/json; charset=utf-8" `
  -Body @'
[
  {
    "Company": "Test Client",
    "Facility": "[INGESTION TEST] Group Site Alpha",
    "Provider": "BFcards",
    "Category": "[INGESTION TEST] Sandbox Transport",
    "Input Type": "[INGESTION TEST] Sandbox Fuel Alpha",
    "Date Range": "01/03/2026 - 31/03/2026"
  }
]
'@
```

**Beta (Sandbox Fuel Beta):**

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/ingestion/confirm" -Method POST `
  -Headers @{ Authorization = "Bearer kYMHYor0QzncWaLS_qI1ID6gVqDHcH1QvBz6Xd3bHXE" } `
  -ContentType "application/json; charset=utf-8" `
  -Body @'
[
  {
    "Company": "Test Client",
    "Facility": "[INGESTION TEST] Group Site Beta",
    "Provider": "BFcards",
    "Category": "[INGESTION TEST] Sandbox Transport",
    "Input Type": "[INGESTION TEST] Sandbox Fuel Beta",
    "Date Range": "01/03/2026 - 31/03/2026"
  }
]
'@
```

### C6 — **Inferred Empty** (after all C5 confirms are done)

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/ingestion/inferred-empty" -Method POST `
  -Headers @{ Authorization = "Bearer kYMHYor0QzncWaLS_qI1ID6gVqDHcH1QvBz6Xd3bHXE" } `
  -ContentType "application/json; charset=utf-8" `
  -Body (@{
    client_name   = "Test Client"
    supplier_name = "BFcards"
    category      = '[INGESTION TEST] Sandbox Transport'
  } | ConvertTo-Json)
```

---

## Suggested demo order

1. **C0** / **A1** → amber pendings for sandbox Transport group (**Test Client** + **BFcards**)  
2. **A2** → Feb green for Alpha + Beta (both confirmed in one call)  
3. **A5** → inferred-empty for Feb (any PENDING sibling months that are confirmed → INFERRED_EMPTY)  
4. **A4** → March shows red **!** for sandbox Transport group rows  
5. **C5 Alpha** → confirm March for Alpha only (Beta March still PENDING)  
6. **C5 Beta** → confirm March for Beta  
7. **C6** → inferred-empty finalises March (both confirmed, no remaining PENDING → `inferred_empty: 0`)  
8. **B1** → NAPA/GREASE pending (needs manual fixture; **or** use **C3** after seed)  
9. **B2** → confirm March for that line (Input Type required)  
10. **C3b** → **Agas national** line pending (after seed)  
11. **C2**–**C4** → optional pending-mode, BFcards line, metered

---

## Production / key change

- Replace `http://localhost:3000` with your deployed URL.  
- Replace the Bearer token in each command with your current `INGESTION_API_KEY` (or delete this file from git / rotate the key if it was ever committed publicly).
