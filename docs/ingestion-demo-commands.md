# Ingestion API — demo command sheet

Each block is **copy-paste** ready (localhost + Bearer key inlined). Rotate the key in `.env.local` if this file is shared.

> Adjust **client / supplier / facility / category names** if yours differ. Dates use **FY2026** (Jul 2025–Jun 2026); **Feb/Mar 2026** = `FEB 26` / `MAR 26` in the UI.

---

## Part A — BFC Fuels **group** (Transport Fuels)

### A1 — Pending (all group members × member categories, current FY)

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/ingestion/pending" -Method POST `
  -Headers @{ Authorization = "Bearer kYMHYor0QzncWaLS_qI1ID6gVqDHcH1QvBz6Xd3bHXE" } `
  -ContentType "application/json; charset=utf-8" `
  -Body (@{
    client_name   = "DIAB"
    supplier_name = "BFC"
    utility_name  = "Transport Fuels"
  } | ConvertTo-Json)
```

### A2 — Confirm **February 2026** (Geraldton + Welshpool present; Pakenham absent → inferred empty)

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/ingestion/confirm" -Method POST `
  -Headers @{ Authorization = "Bearer kYMHYor0QzncWaLS_qI1ID6gVqDHcH1QvBz6Xd3bHXE" } `
  -ContentType "application/json; charset=utf-8" `
  -Body @'
[
  {"Company":"DIAB","Facility":"Geraldton","Provider":"BFC","Category":"Transport Fuels","Consumption":5552.66,"Date Range":"01/02/2026 - 28/02/2026","Amount ($)":8500},
  {"Company":"DIAB","Facility":"Welshpool","Provider":"BFC","Category":"Transport Fuels","Consumption":4619.94,"Date Range":"01/02/2026 - 28/02/2026","Amount ($)":7200}
]
'@
```

### A3 — Pending again (recreates amber months; confirm removed non-Feb pendings)

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/ingestion/pending" -Method POST `
  -Headers @{ Authorization = "Bearer kYMHYor0QzncWaLS_qI1ID6gVqDHcH1QvBz6Xd3bHXE" } `
  -ContentType "application/json; charset=utf-8" `
  -Body (@{
    client_name   = "DIAB"
    supplier_name = "BFC"
    utility_name  = "Transport Fuels"
  } | ConvertTo-Json)
```

### A4 — **Error** March 2026 (group — flips March PENDING → ERROR for the whole group)

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/ingestion/error" -Method POST `
  -Headers @{ Authorization = "Bearer kYMHYor0QzncWaLS_qI1ID6gVqDHcH1QvBz6Xd3bHXE" } `
  -ContentType "application/json; charset=utf-8" `
  -Body (@{
    client_name   = "DIAB"
    supplier_name = "BFC"
    utility_name  = "Transport Fuels"
    date_range    = "01/03/2026 - 31/03/2026"
  } | ConvertTo-Json)
```

---

## Part B — **NAPA** single line (Geraldton · GREASE)

> No facility group required. Response includes `resolved.facility_name` so you can confirm only **Geraldton** is targeted.

### B1 — Line pending

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/ingestion/pending" -Method POST `
  -Headers @{ Authorization = "Bearer kYMHYor0QzncWaLS_qI1ID6gVqDHcH1QvBz6Xd3bHXE" } `
  -ContentType "application/json; charset=utf-8" `
  -Body (@{
    mode          = "line"
    client_name   = "DIAB"
    facility_name = "Geraldton"
    supplier_name = "NAPA"
    utility_name  = "GREASE"
  } | ConvertTo-Json)
```

### B2 — Line confirm (March 2026 example)

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/ingestion/confirm" -Method POST `
  -Headers @{ Authorization = "Bearer kYMHYor0QzncWaLS_qI1ID6gVqDHcH1QvBz6Xd3bHXE" } `
  -ContentType "application/json; charset=utf-8" `
  -Body (@{
    mode = "line"
    rows = @(
      @{
        Company      = "DIAB"
        Facility     = "Geraldton"
        Provider     = "NAPA"
        Category     = "GREASE"
        Consumption  = 42.5
        "Date Range" = "01/03/2026 - 31/03/2026"
        "Amount ($)" = 1200
      }
    )
  } | ConvertTo-Json -Depth 6)
```

### B3 — Line pending again (after a line confirm cleared other months’ pendings, if you need ambers back)

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/ingestion/pending" -Method POST `
  -Headers @{ Authorization = "Bearer kYMHYor0QzncWaLS_qI1ID6gVqDHcH1QvBz6Xd3bHXE" } `
  -ContentType "application/json; charset=utf-8" `
  -Body (@{
    mode          = "line"
    client_name   = "DIAB"
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
    client_name   = "DIAB"
    facility_name = "Geraldton"
    supplier_name = "NAPA"
    utility_name  = "GREASE"
    date_range    = "01/03/2026 - 31/03/2026"
  } | ConvertTo-Json)
```

---

## Suggested demo order

1. **A1** → amber pendings for BFC group  
2. **A2** → Feb green + Pakenham Feb inferred empty; other pendings may be deleted  
3. **A3** → amber back for remaining FY months  
4. **A4** → March shows red **!** for BFC group rows  
5. **B1** → NAPA/GREASE pending (check `resolved` = Geraldton)  
6. **B2** → confirm March for that line  
7. **B3** / **B4** → optional repeat / error demo for NAPA line  

---

## Production / key change

- Replace `http://localhost:3000` with your deployed URL.  
- Replace the Bearer token in each command with your current `INGESTION_API_KEY` (or delete this file from git / rotate the key if it was ever committed publicly).
