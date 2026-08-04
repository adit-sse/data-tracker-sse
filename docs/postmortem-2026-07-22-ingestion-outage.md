# Postmortem — the ingestion outage of 22 July 2026

**One-line summary:** ingestion was broken by three unrelated bugs stacked on top of each other,
each one hiding the next. Fixing them required merging a stale PR, which turned out to be
incomplete and to carry a security hole, against a database that had already half-migrated itself.

**Outcome:** all resolved. Metered ingestion, CSV upload, and the coverage UI are working, and the
database schema and application code now agree for the first time in ~10 days.

---

## Why this was confusing

Nothing here was one big failure. It was a **chain**: each bug stopped the request *before* it
reached the next broken thing. So every fix revealed a new error, which felt like "I fixed it and
broke something else" — but nothing new was breaking. Each fix simply let the request travel
further down the pipeline before hitting the next pre-existing problem.

```
n8n request
   │
   ├─▶ resolve meter ─────── ✗ BUG 1: false "different supplier" 409
   │                            (fixed → request continues)
   ├─▶ parse date range ──── ✗ BUG 2: 422 could not parse
   │                            (fixed → request continues)
   ├─▶ write to database ─── ✗ BUG 3: 500 'amount' column not found
   │                            (fixed → request completes)
   └─▶ ✓ success
```

A useful takeaway on its own: when fixing a pipeline, **expect a queue of failures, not one**.
Progress looks like the error message changing.

---

## The three bugs

### Bug 1 — every metered row rejected as "different supplier" (409)

```
Meter exists but is linked to a different supplier than Provider / supplier_name
```

**What was actually wrong:** the supplier was correct. The comparison was broken.

`suppliers.id` is an integer. Two pieces of code read the same id in different shapes:

| Source | Value | Type |
|---|---|---|
| `meter.supplier_id` — read directly from the database | `16` | number |
| `line.supplierId` — via the name-lookup helper, which did `String(row.id)` | `"16"` | **string** |

```js
if (meter.supplier_id !== line.supplierId)   // 16 !== "16" → always true
```

Every metered row whose meter had a supplier was rejected.

**Where it came from:** PR #59 (fuzzy name lookup) introduced the `String(row.id)`. Before that,
both sides were raw numbers and the comparison worked. It was a regression, not an old bug.

**Why nothing caught it:** Supabase returns query results typed as `any`. The field was *annotated*
`string` while *holding* a number at runtime — so TypeScript compiled it happily. There are no
tests on this path.

**The same defect elsewhere:** while sweeping for other raw `===` comparisons on ids, we found the
identical bug in the CSV upload path (`lib/upload/resolver.ts`), where a duplicate-meter conflict
reported *"already exists for a different facility"* for the **same** facility. So uploads had been
silently broken too, by the same root cause, unnoticed.

**Fix (PR #61):** normalise ids to strings at the lookup boundary, and compare through helpers
(`lib/row-id.ts` — `idKey` for map keys, `sameId` for comparisons) rather than raw `===`.

*Why strings and not numbers?* The obvious alternative — stop stringifying, keep raw numbers —
works for these three lookups but doesn't generalise: this schema mixes `serial`, `uuid`, and
`bigint` primary keys. A number can't hold a uuid, and `bigint` loses precision past 2^53. String
is the only representation that's lossless for all three.

---

### Bug 2 — date range rejected (422)

```
Could not parse Date Range "20/05/2026-19/06/2026"
   — expected format: "DD/MM/YYYY - DD/MM/YYYY"
```

**What was actually wrong:** the dates were fine. The parser was too rigid.

```js
const parts = dateRange.split(' - ');   // literal space-hyphen-space
```

The incoming value had no spaces around the hyphen, so the split found nothing and the parse
failed. `"20/05/2026 - 19/06/2026"` would have worked.

**Not the same class as Bug 1** — no ids, no type coercion. Just a literal string format that
didn't tolerate a real-world variation.

**Fix (PR #63):** one anchored regex accepting any amount of whitespace (or none) around the dash.
Dates in this format only ever contain `/`, never `-`, so treating the hyphen as the separator is
unambiguous. Malformed input is still rejected.

---

### Bug 3 — column not found (500)

```
Could not find the 'amount' column of 'actual_invoices' in the schema cache
```

**What was actually wrong:** the database and the code had diverged.

Migration `017_drop_legacy_invoice_columns.sql` had been **applied to the live database**, removing
nine columns (`amount`, `consumption`, `invoice_number`, …). But the code that adapts to that
change lived on branch `40-drop-legacy-invoice-columns…` (PR #58), which was **never merged** — and
by then was 17 commits behind `main`.

So production was running code that wrote to columns the database no longer had.

**Why it surfaced only now:** ingestion never got as far as the database write. Bugs 1 and 2 were
failing earlier in the request. This had been broken since 017 was applied.

**Fix:** rebase and merge PR #58 — which turned into the larger part of the work below.

---

## Merging PR #58

### The rebase

17 commits behind `main`, three conflicts. All three had the same shape: **`main` and the branch
had changed the same code for different reasons.** The resolution in each case was to keep *both*
intents rather than pick a side.

| File | `main` wanted | Branch wanted | Resolution |
|---|---|---|---|
| `ingestion-group-pending.ts` | single-fetch query restructure (#56) | narrow "green" statuses to CONFIRMED/DEACTIVATED | `main`'s structure + branch's status list |
| `metered/pending/route.ts` | seed from meter's **earliest record** (#56) | replace insert loop with **month slots** | earliest-record range + slot mechanism |
| `pending/route.ts` | earliest record, plus N+1 avoidance | month slots | all three combined |

The trap avoided: taking the branch wholesale would have silently reverted PR #56, a deliberate
behaviour fix, because the branch simply predated it.

### Problem A — the branch was only half-finished

The branch moved *seeding*, *confirm*, and *coverage* onto the new `meter_month_slots` table, but
left three paths still reading PENDING from `actual_invoices`:

| Path | Consequence | How it failed |
|---|---|---|
| `markMeteredError` | errors never recorded | **silently** — returned `ok: true, updated: 0` |
| `revert-pending` | reverted nothing | **silently** — returned `reverted: 0` |
| `activity/stuck` | metered "stuck" list always empty | silently |

Two of the three would have reported success while doing nothing — the same failure mode that had
already cost most of a day.

Critically, these would have broken **on deploy**, not on the cleanup migration. Once seeding
writes slots instead of invoice rows, no new PENDING ever lands in `actual_invoices` again.

**Fixed:** all three migrated to slots. `markMeteredError` now *upserts*, so it records an error
even for a month that was never seeded, instead of no-opping. `activity/stuck` also got more
accurate — it had been deriving "how long has this been stuck" from the *month being covered*
rather than a real timestamp; slots carry a genuine `created_at`.

### Problem B — the new table had no access control

Migration 018 created `meter_month_slots` with **no row-level security and no policies**.

Two browser-facing routes read that table through the cookie-scoped anon key, so RLS *is* the
tenant boundary there. Without policies, **any logged-in user could read and write every client's
data** in that table. Every other table in this schema has RLS; this one silently broke that rule.

**Fixed:** added the four policies, mirroring how `actual_invoices` is protected.

---

## The database had moved on its own

Partway through, applying migration 018 failed:

```
ERROR: 42P07: relation "meter_month_slots" already exists
```

Someone had already applied it. A read-only audit of the live schema showed:

| Check | Result |
|---|---|
| Table structure | ✅ matched 018 exactly, including the unique constraint the code depends on |
| **RLS enabled** | ❌ **No — 0 policies** (the hole above, live in production) |
| Slots backfilled | 347 rows |
| PENDING/ERROR still in `actual_invoices` | **124 rows** |

Those last two numbers were the important find. **They can't both be post-backfill.** 018's backfill
copies workflow state from `actual_invoices` into slots — but the old code stayed deployed and kept
writing new PENDING rows afterwards. Those 124 rows had never reached the slots table.

**Running the cleanup migration at that moment would have permanently deleted the workflow state of
124 rows.** They'd simply have vanished.

**Fixed** by splitting the remaining work into properly ordered migrations:

| # | Purpose | Why separate |
|---|---|---|
| `020` | enable RLS | 018 was already applied and must not be edited |
| `021` | re-run the backfill | capture the 124 drifted rows |
| `022` | purge PENDING/ERROR (was 019) | renumbered so **numeric order = run order** |

### Final sequence, and why the order mattered

1. **020 (RLS)** — immediately; independent of the deploy, closed a live security hole
2. **Merge + deploy** — drift stops here: new code writes slots, not invoice rows
3. **021 (re-backfill)** — rescued 114 slots from the 124 drifted rows
4. **Verify** — two gates, both required to return zero:
   - invoice rows with **no matching slot** (would vanish on purge)
   - `ERROR` rows whose slot wasn't `ERROR` (would silently downgrade, since the backfill only
     inserts and can't upgrade an existing slot)
5. **022 (purge)** — irreversible, and only after the gates passed

Final state: 0 PENDING/ERROR in `actual_invoices`, 461 slots, coverage intact.

---

## Lessons

### 1. A migration applied to production is a deploy
Migration 017 was run against the live database while its code sat unmerged in a PR. That single
mismatch caused Bug 3 and everything downstream. **Schema changes and the code that depends on them
have to ship together** — or the schema change has to be backward-compatible until the code lands.

### 2. Silent success is worse than a crash
Three separate places returned `ok: true` while doing nothing: the two unmigrated paths, and the
original error-marking function. A crash gets investigated in minutes; a silent no-op can run for
weeks. **If a handler can't do its job, it should say so** — prefer a loud failure over a
reassuring zero.

### 3. TypeScript will not save you at the database boundary
Supabase returns `any`. A field annotated `string` held a number, and the compiler was satisfied.
Both Bug 1 instances were invisible to `tsc`. **Treat every value crossing the DB boundary as
untyped** and normalise it deliberately — that's what `lib/row-id.ts` now exists for. Adopting
generated Supabase types would close most of this gap.

### 4. Error messages should say what was found, not just that something was wrong
The original 409 said only *"linked to a different supplier"*. Adding the matched meter's details
to the message exposed the id-type bug **on the very first run** — the fix was visible in the
output (`supplier "(unknown supplier id 16)"`). The same pattern would have shortened issue #33,
where someone had to query the database by hand to work out the same class of answer.
**Diagnostics that name both sides of a comparison pay for themselves immediately.**

### 5. Never edit a migration that has been applied
Once 018 was live, it became immutable. The RLS fix had to move into a new `020`. Editing it in
place would have meant the file no longer described any real database.

### 6. Verify before anything irreversible — and verify the *right* thing
Row counts looked plausible while 124 rows were unprotected. What actually caught it was checking
for invoice rows with **no matching slot** — a question about individual rows, not totals.
**Before a destructive step, ask "what would be lost?", not "do the numbers look about right?"**

### 7. New tables don't get security by default
`meter_month_slots` was created without RLS. In Supabase that means fully open to anyone with the
anon key. **Enabling RLS should be part of creating a table**, not a follow-up.

### 8. The real root cause is the absence of tests
Every bug here reached production, and several were invisible until a human noticed odd behaviour.
The highest-value target is the pure functions — date parsing, coverage arithmetic, id
normalisation. They take no database and no mocking, and would have caught Bug 1, Bug 2, and the
resolver regression outright.

### 9. Rebasing a stale branch: check what the *branch* meant, not just what conflicts
Every conflict was resolved by first asking "what did this branch actually intend to change here?"
(`git show <commit> -- <file>`). In one case the branch's real intent was a **single line**; the
rest of the conflict was `main` restructuring around it. Taking either side wholesale would have
silently reverted a deliberate fix.

---

## Reference

| Item | Where |
|---|---|
| Id normalisation helpers | `lib/row-id.ts` |
| Date range parser | `lib/ingestion-dates.ts` |
| Month slot helpers | `lib/meter-month-slots.ts` |
| Migrations added | `020` RLS, `021` re-backfill, `022` purge |
| PRs | #61 id types · #62 inline meter editing · #63 date range · #58 schema refactor |
| Pre-rebase branch tip | tag `backup/pr58-before-rebase` |

**Still outstanding:** no automated tests exist on any of these paths. The wider codebase audit is
in `CODEBASE_AUDIT.md`.
