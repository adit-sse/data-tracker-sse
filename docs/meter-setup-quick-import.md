# Meter Setup — Quick Import Template

**Use this when onboarding a new client.** One spreadsheet creates the client's
facilities, meters/supply lines, and a monthly record for every month you say
data exists. It replaces doing it by hand in the UI, one facility at a time.

**Files**

| File | Purpose |
| --- | --- |
| [`templates/meter-setup-quick-import.csv`](templates/meter-setup-quick-import.csv) | Blank template — start here |
| [`templates/meter-setup-quick-import-example.csv`](templates/meter-setup-quick-import-example.csv) | Filled example showing every pattern |

**Where to upload:** the client's page → **Upload** (`/clients/<client id>/upload`).
Do this *after* the client record itself exists.

> **The one rule that matters most:** `Input Type` must be an EnviroCapture
> input type name, spelled the EnviroCapture way. It selects the NGERS
> emissions factor, so a wrong value is a wrong number, not a cosmetic problem.
> The accepted values are listed in [section 2](#2-input-type--the-important-one).

---

## 1. The columns

The blank template has the five core columns. Add any of the three optional
columns only if you need them — the header row then becomes:

```
Facility,Input Type,Supplier,Address,MonthsWithData,Identifier,Category,MonthsDeactivated
```

### Core columns

| Column | Required? | What to put in it |
| --- | --- | --- |
| `Facility` | Yes | Site name, e.g. `Perth Office`. Created if it doesn't exist, matched if it does. Leave blank (or write `(Client-wide)`) only for organisation-level Scope 3 rows. |
| `Input Type` | Yes | The EnviroCapture input type — see [section 2](#2-input-type--the-important-one). |
| `Supplier` | Usually | Retailer/provider, e.g. `Synergy`. **Required on every row except Electricity** (see [section 3](#3-electricity-vs-fuels)). Standardised automatically. |
| `Address` | No | Street address. Only used when the facility is *created* — see [Gotchas](#6-rules-and-gotchas). |
| `MonthsWithData` | No | Months you already hold data for. Format in [section 4](#4-monthswithdata-format). |

### Optional columns

| Column | What to put in it |
| --- | --- |
| `Identifier` | NMI or meter number. **Electricity rows only** — ignored on fuel rows. Leave blank for whole-of-site billing; one facility-level meter is created, named `<Facility> <Input Type>`. |
| `Category` | NGERS reporting group — see [section 2](#2-input-type--the-important-one). Optional but recommended. Must match the Input Type's scope. |
| `MonthsDeactivated` | Months the account was switched off / not in service. Same format as `MonthsWithData`. Recorded as `DEACTIVATED` rather than showing as gaps to chase. |

One row per **facility + input type**. A site with electricity and diesel gets
two rows.

---

## 2. `Input Type` — the important one

Values must match EnviroCapture. These are the input types currently loaded in
the tracker:

| `Input Type` | Scope | Matching `Category` |
| --- | --- | --- |
| `Electricity` | 2 | `ELECTRICITY` |
| `Diesel oil` | 1 | `Transport Fuels` or `Stationary Fuels` |
| `Gasoline` | 1 | `Transport Fuels` |
| `Gasoline (other than for use as fuel in an aircraft)` | 1 | `Stationary Fuels` |
| `Liquefied petroleum gas (LPG)` | 1 | `Transport Fuels` or `Stationary Fuels` |
| `Natural gas distributed in a pipeline` | 1 | `Stationary Fuels` |
| `Ethanol` | 1 | `Transport Fuels` |
| `Petroleum based greases` | 1 | `Stationary Fuels` |
| `Petroleum based oils (other than petroleum based oil used as fuel), e.g. lubricants` | 1 | `Stationary Fuels` |
| `A biogas that is captured for combustion, other than those mentioned in items 28, 29 and 29A (methane only) (30)` | 1 | `Fuel for electricity generation` |

`Category` values are the NGERS reporting groups: `ELECTRICITY` (Scope 2), and
`Transport Fuels`, `Stationary Fuels`, `Fuel for electricity generation`,
`Other` (Scope 1). Mixing scopes — Scope 1 input type with `ELECTRICITY`, say —
fails the row.

Two of these names contain commas, so a spreadsheet will quote them
automatically. If you are hand-editing a CSV in a text editor, quote them
yourself.

### Spellings that are corrected for you

Common variants resolve automatically, so copying from an EnviroCapture export
generally works:

| You write | Resolves to |
| --- | --- |
| `LPG`, `Liquified Petroleum Gas` | `Liquefied petroleum gas (LPG)` |
| `Diesel` | `Diesel oil` |
| `Petrol`, `ULP`, `Regular Petrol`, `Premium Petrol`, `Motor Gasoline` | `Gasoline` |
| `Natural Gas`, `NG` | `Natural gas distributed in a pipeline` |
| `WA - SWIS`, `NSW & ACT`, `QLD`, `VIC`, and the other grid regions | `Electricity` |

Casing and spacing never matter.

That last row is worth understanding: EnviroCapture records the electricity
**grid region** in its Input Type column. This tracker doesn't model regions —
it has a single `Electricity` input type — so pasting a region resolves to
`Electricity` and the region itself is not stored. That is fine here; this
template captures *which months exist*, not consumption.

### Anything else is rejected on purpose

An input type that isn't in the table above fails its row with a
"Did you mean…" suggestion. It is **not** guessed at, because NGERS names that
look nearly identical are different fuels with different factors —
`Diesel oil` and `Diesel oil (40)` differ by three characters and are not
interchangeable.

If the client genuinely uses a fuel that isn't listed (LNG, CNG, coal, SF₆ and
others exist in EnviroCapture but are not loaded here), add it under **Manage
Input Types** first, spelled exactly as EnviroCapture spells it, then upload.

---

## 3. Electricity vs fuels

This distinction drives most of the template's behaviour:

|  | `Electricity` | Every other input type |
| --- | --- | --- |
| Treated as | Metered | Non-metered |
| Creates | A meter | A supply line |
| `Supplier` | Optional | **Required** when months are present |
| `Identifier` | Used (NMI / meter number) | Ignored |

So: **if the row is not Electricity, it needs a Supplier.**

---

## 4. `MonthsWithData` format

Month and year, `Mon YYYY`. Every month in the range gets a monthly record.

| You write | You get |
| --- | --- |
| `Jul 2025` | That single month |
| `Jul 2025 - Nov 2025` | Jul, Aug, Sep, Oct, Nov 2025 |
| `Jul 2025 - Sep 2025; Nov 2025` | Jul–Sep and Nov — **October is left as a gap** |
| `July 2025 - June 2026` | Full month names work too |

- Separate non-contiguous blocks with a **semicolon** `;`.
- `JUL 2025`, `jul 2025`, and `Jul 2025` are all accepted.
- An en dash (`–`) pasted from Word works as well as a plain hyphen.
- Anything else — `2025-07`, `Q1 2025`, `07/2025` — fails the row.

Use gaps deliberately: a month you omit is a month the tracker will show as
outstanding and chase. A month in `MonthsDeactivated` is one it won't.

---

## 5. Client and supplier names

`Supplier` is standardised against the operations team's **emailMapping**
workbook — the same list the mailbox uses to attribute inbound email — so
`AMPOL`, `Ampol` and `ampol` all land on one supplier instead of three. Matching
is exact first, then case/punctuation-insensitive, then fuzzy above a
confidence floor; an unrecognised supplier is kept as typed and created, because
the workbook always lags reality a little.

Client names are standardised the same way when data arrives through the
ingestion API. The tracker's own client names win where they differ.

Practical advice: **spell the supplier the way the workbook does** if you know
it. Standardisation is a safety net, not a licence to improvise — it will not
merge `BP AUSTRALIA/ Fleet Card` into `BP`, and it deliberately refuses to guess
between similar names such as `Refuel AUS` and `Refuel Solutions`.

To refresh the list after the workbook changes:

```
node scripts/build-canonical-data.mjs "<path to emailMapping.xlsx>"
```

---

## 6. Rules and gotchas

**Blank `MonthsWithData` inherits from the row above.** This is deliberate — it
makes Excel merged cells work — but it surprises people. If rows 2–4 share the
same period, fill it once on row 2 and leave 3–4 blank. If you want a row to
have *no* months while an earlier row has some, you can't leave it blank; put
that row in a separate setup-only file where the column is empty on every row.

**Input Types are never auto-created.** See [section 2](#2-input-type--the-important-one).

**Existing facilities keep their existing address.** `Address` is only applied
when the facility is created. To correct an address on a facility that already
exists, edit it in the UI — the upload won't overwrite it.

**Never add a `Company` or `Date Range` column.** Those two headers together
switch the file to the *invoice* import format and this template stops working.

**Header spelling is exact** for `Facility`, `Supplier`, `Address` and
`Identifier` — capital first letter, no trailing spaces. Don't rename them.
(`Input Type`, `Category`, `MonthsWithData` and `MonthsDeactivated` are matched
case-insensitively.)

**Re-uploading is safe.** Facilities, suppliers, and meters are matched before
being created, and monthly records that already exist are skipped rather than
duplicated. Fixing a typo and uploading the whole file again is the normal
workflow. It does not *remove* anything, though — a row deleted from the
spreadsheet leaves whatever it created last time in place.

**One row fails, the rest still import.** Errors are reported per row as
`Row 7: <reason>`, where the number is the spreadsheet row (header is row 1).

**CSV or XLSX.** For `.xlsx`/`.xls` only the **first sheet** is read.

---

## 7. Error messages

| Message | Fix |
| --- | --- |
| `Unknown Input Type: "X". Did you mean…` | Use the suggested EnviroCapture name, or add `X` under Manage Input Types. |
| `Invalid MonthsWithData format: X` | Use `Mon YYYY` or `Mon YYYY - Mon YYYY`, semicolons between blocks. |
| `Missing Facility name` | Fill in `Facility` (only Scope 3 rows may leave it blank). |
| `Missing Supplier (required for non-metered Fuel/LPG/etc.)` | Add the `Supplier` — every non-Electricity row needs one. |
| `Missing Supplier for Scope 3 row` | Same — Scope 3 rows always need a supplier. |
| `Unknown Category (reporting group): "X". Did you mean…` | Use a listed reporting group, or clear the cell. |
| `Category "X" is Scope N, but this Input Type is Scope M` | Pair a Scope 1 fuel with a Scope 1 group, or `Electricity` with `ELECTRICITY`. |
| `Meter identifier "X" already exists for a different facility` | That NMI is on another site. Check which facility is correct. |
| `File is empty or has no valid data rows` | Only the header row was filled in. |

---

## 8. Checklist before uploading

- [ ] Client record exists in the tracker
- [ ] Every `Input Type` is spelled exactly as in [section 2](#2-input-type--the-important-one)
- [ ] Every non-Electricity row has a `Supplier`
- [ ] `Category` matches the Input Type's scope (or is blank)
- [ ] `MonthsWithData` values all look like `Jul 2025 - Nov 2025`
- [ ] Deliberate gaps are actually gaps; off-supply periods are in `MonthsDeactivated`
- [ ] No `Company` or `Date Range` column
- [ ] Saved as `.csv` or `.xlsx`, data on the first sheet

---

## Reference

Row handling: `lib/upload/process-meter-setup-row.ts`. Month parsing:
`lib/upload/month-ranges.ts`. Format detection and blank-cell carry-down:
`lib/upload/spreadsheet.ts`. Name standardisation: `lib/canonical/` (with
`data.ts` generated from emailMapping.xlsx by
`scripts/build-canonical-data.mjs`).

Note for developers: the template's `Input Type` header matches EnviroCapture's
own export column. A legacy `Utility` column is still accepted as a fallback
(`types/index.ts`) for older spreadsheets, but new templates should use
`Input Type`.
