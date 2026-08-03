# invoice-tracker — Codebase Audit

*Audit date: 2026-07-22*

Everything below is verified against the code — `tsc --noEmit` passes clean, and several
suspicions were checked and turned out to be non-issues (noted where relevant).

---

## 1. Structure & Architecture

**Stack:** Next.js 14.2.35 (App Router) + React 18.3.1 + Supabase (Postgres/Auth/RLS) + Tailwind 3.4. TypeScript 5.9.3, `strict: true`. ~22,700 lines across 100 TS/TSX files.

**Layout:**

| Path | Role |
|---|---|
| `app/api/**` | ~50 route handlers. Two auth regimes (below). |
| `app/**/page.tsx` | 12 pages, near-universally client components |
| `components/**` | 21 shared components, form/modal heavy |
| `lib/**` | Domain logic — 2 clusters: `lib/upload/*` (spreadsheet ingest) and `lib/ingestion-*` (external NGERS API pipeline) |
| `supabase/migrations/**` | 16 sequential SQL migrations |
| `types/index.ts` | 379-line central type barrel |

**Two distinct data paths — this is the key architectural fact:**

1. **Browser path** — `middleware.ts:41-51` enforces session on everything except `/login` and `/api/ingestion/*`. API routes use `createSupabaseServerClient()` (cookie-scoped, anon key), so **Postgres RLS is the actual authorization boundary**. 31 routes use this.
2. **Machine path** — `/api/ingestion/*` (12 routes) is exempt from middleware, authenticates via `Bearer INGESTION_API_KEY` (`lib/ingestion-auth.ts`), and uses `createSupabaseServiceRoleClient()` which **bypasses RLS entirely**.

**Credit where due — the security architecture is better than typical:**
- `supabase/migrations/002_auth_rls_membership.sql` is thorough: every domain table has RLS, policies route through `user_can_access_client()`, and `SECURITY DEFINER` functions correctly pin `search_path = public` (avoids the classic search-path hijack).
- I verified **every table created across all 16 migrations has `ENABLE ROW LEVEL SECURITY`** — no gaps.
- I verified **all 12 ingestion routes call `checkApiKey`** — no unguarded RLS-bypass endpoint.
- `app/api/clients/[id]/upload/route.ts:50-71` is the only non-ingestion route touching service role, and it does it correctly: proves session access via the RLS-scoped client *first* (lines 61-68), then promotes. That's the right pattern.
- `lib/supabase/guard-public-key.ts` is a genuinely thoughtful guard against pasting `sb_secret_` into the public env var.

**Version health:** Next 14.2.35, React 18.3.1, Supabase JS 2.107.0 are all current-enough and unpatched-CVE-free. Next 14 is a major behind 15 but not deprecated. **The one real problem is `xlsx@0.18.5` — see §4.**

---

## 2. Code Quality

### Test coverage: **zero**

There are no test files. Not "thin" — none.

- `playwright@1.58.2` is a devDependency, but **there is no `playwright.config.*`** and no test runner (`package.json` has no `test` script).
- The only thing importing playwright is `scripts/test-date-behavior.js` — a 37-line throwaway that hardcodes `http://localhost:3001/clients/1/invoices/new`, requires a running dev server and a seeded client id 1, and prints to console with no assertions. It is a debugging transcript, not a test.
- `scripts/compute-end.js` (26 lines) is a scratch pad that redefines `computeEnd` locally and console-logs three dates — it doesn't import the app's real implementation, so it verifies nothing about shipped code.
- `scripts/timing-test.mjs` is a real perf harness (asserts against time budgets) but is manual, needs live env + service-role key, and covers only latency.

The irony worth naming: `lib/upload/parse.ts:5` documents itself as *"fully unit-testable with a File/Blob stub"* — and has no tests. Same for `lib/ingestion-dates.ts`, `lib/coverage.ts`, `lib/upload/month-ranges.ts`. This is pure date/period arithmetic driving billing coverage calculations, all pure functions, all trivially testable, all untested. That is the highest-value untested surface in the repo.

### ESLint has never run

`package.json` declares `"lint": "next lint"` and `eslint-config-next@14.2.0`, but **there is no `.eslintrc*` file and no `eslintConfig` key**. Running `npx next lint` drops into the interactive "How would you like to configure ESLint?" setup prompt — meaning the lint script has never completed successfully in this repo.

Consequence: the `// eslint-disable-next-line react-hooks/exhaustive-deps` comments at `app/page.tsx:71` and `components/InvoiceForm.tsx:113` are **decorative**. Nothing was ever suppressing anything, and nothing is checking the dependency arrays they're waving off. Those two hooks have unverified stale-closure risk.

### Inconsistent error handling — four strategies in one file

`app/clients/[id]/page.tsx` handles fetch failure four different ways within 50 lines:

| Line | Strategy |
|---|---|
| 116 | `if (!response.ok) return;` — silent, no state change |
| 137-142 | `setError('Failed to load client')` — surfaced to user |
| 152 | `} catch {}` — **fully swallowed** |
| 159-164 | reset to `[]` — failure indistinguishable from empty result |

Pattern 4 is the insidious one: a failed coverage fetch renders as "this client has no meters," which is a *plausible* screen. Users can't tell breakage from emptiness.

Fully-silent `catch {}` also at `components/FacilityGroupManager.tsx:71,80,89` and `components/NeedsReviewBanner.tsx:23,45`.

Meanwhile the API layer is *internally* consistent (try/catch → `console.error` → JSON error), and async style is uniformly `async/await` — no promise/callback mixing anywhere. Credit there.

### No validation layer

No `zod`/`yup`/`valibot`. Every route hand-rolls truthiness checks. This produces type-confusion crashes:

`app/api/meters/route.ts:15-30` — guard is `if (!facility_id || !input_type_id || !identifier_type || !lookup1)`, then line 30 calls `lookup1.trim()`. Post `JSON.parse`, `lookup1: 12345` (a number, entirely plausible for a meter identifier) passes the truthy guard and throws `TypeError: lookup1.trim is not a function` → caught → **500 instead of 400**. Same shape at `lib/non-metered-lines.ts` callers via `String(...)` coercion inconsistency.

`app/api/non-metered-records/route.ts:20` — `status = 'MANUAL'` is client-overridable. *I checked the DB:* `001_scope_expansion.sql:65-66` has a `CHECK (status IN (...))` constraint, so this is **not** a data-integrity hole — but an invalid status returns a 500 with raw Postgres constraint text rather than a 400. Downgraded from what it first looked like.

### `any` usage: 45 occurrences

`tsc --noEmit` passes clean and `strict: true` is on, so baseline type health is real. But `any` is concentrated exactly where it hurts — Supabase result mapping, where the DB shape is the thing you most want typed:

- `app/api/clients/[id]/coverage/non-metered/route.ts` — **11 occurrences** (lines 39, 40, 85, 104, 125, 139, 144, 158, 165, 167, 172). Lines 158/165/167/172 cast *away* the types the query already implies: `(line as any).category`, `(line.supplier as any)?.name`. The 201-line coverage computation is effectively untyped.
- `app/api/view-by/route.ts` — 6 (lines 35, 43, 50, 56, 67, 72)
- `app/api/ingestion/pending/route.ts` — 4 (96, 119, 401, 402)
- `app/api/clients/[id]/route.ts:49` — `const updates: any = {}` on a PATCH builder, the exact place a typo silently no-ops

Notably absent: generated Supabase DB types (`supabase gen types typescript`). Adopting them would eliminate most of these mechanically.

### Duplication

- **Ingestion route triplication** — `confirm` (338 lines) / `unified-confirm` (172) / `metered/confirm` (104), and `error` (244) / `unified-error` (180) / `metered/error` (159). ~1,200 lines across six routes with three parallel implementations of the same confirm-and-log lifecycle. `unified-confirm` was clearly the intended consolidation (`classifyRow` at line 21 auto-detects what the other two required the caller to pre-sort), but **the superseded routes were never removed**. Every future ingestion change is a three-place edit with no test to catch a missed one.
- **API-key + service-role + parse + log boilerplate** repeated verbatim in all 12 ingestion routes (e.g. `unified-confirm/route.ts:140-171`). A single `withIngestionAuth(handler)` wrapper collapses ~15 lines × 12.
- **Supabase embed-shape normalization** — `firstCategory()` (`pending-mode/route.ts:18-23`) and `resolveInputType()` (`mixed-scope/route.ts:92-95`) are the same `Array.isArray(x) ? x[0] : x` function, defined twice, and the pattern is re-inlined as `as any` casts in the coverage route.

### Dead code / unused deps

- `scripts/compute-end.js` — orphan scratch file, imports nothing, imported by nothing.
- `scripts/test-date-behavior.js` — broken (hardcoded port 3001, client id 1).
- `playwright@1.58.2` — a heavy devDependency (downloads browser binaries) supporting only the broken script above. Either wire up real E2E or drop it.
- `migration-optional-supplier.sql`, `supabase-migration-mirn.sql`, `supabase-init.sql` sit at repo root outside the numbered `supabase/migrations/` sequence — unclear whether applied, and no ordering relative to `001`–`016`. Migration provenance is ambiguous. **`supabase-init.sql` is also stale**: it declares `clients`/`suppliers`/`facilities`/`meters`.id as `UUID`, but migration 001 rebuilt them as `serial` — the live schema does not match this file.
- No commented-out code blocks and **zero TODO/FIXME/HACK markers** — genuinely clean on that axis.

### Component architecture

- **28 of 31 `.tsx` files are `'use client'`.** The App Router is being used as a routing shell only; RSC data fetching is unused. Every page waterfalls: render → `useEffect` → `fetch` → render again.
- **God components**: `app/ingestion-overview/page.tsx` (1,528 lines, **36 `useState`**, 8 `useEffect`) and `app/clients/[id]/page.tsx` (1,454 lines, **35 `useState`**, 3 `useEffect`, 21 `fetch` call sites). At 35 independent `useState` hooks there is no coherent state model — transitions can't be reasoned about, and related state can go inconsistent between renders.
- No data-fetching library (SWR/React Query) — hence hand-rolled loading/error/refetch in 21 places in one file, which is *why* the four inconsistent error strategies exist.

---

## 3. Technical Debt (specific)

| # | Item | Location | Why it's a problem | Sev | Fix size |
|---|---|---|---|---|---|
| 1 | No tests at all | repo-wide | 22.7k lines, zero regression safety. Refactoring the duplicated ingestion routes is currently unsafe at any speed. | High | Large |
| 2 | ESLint unconfigured | no `.eslintrc*` | `npm run lint` hangs on setup prompt; hook-dep suppressions are inert | Med | **Quick** (~15 min) |
| 3 | `xlsx@0.18.5` | `lib/upload/parse.ts:9,39` | Known CVEs, no npm-registry fix (see §4) | High | Medium |
| 4 | Error detail leaked in 500s | `meters/route.ts:53`, `unified-confirm/route.ts:136` + ~20 more | Raw `error.message` → client (Postgres constraint/column names) | Med | **Quick** |
| 5 | Ingestion route triplication | `ingestion/{confirm,unified-confirm,metered/confirm}` + error trio | ~1,200 lines, 3-place edits, no test to catch drift | Med | Large |
| 6 | 11 `any` in coverage math | `coverage/non-metered/route.ts:39-172` | Billing coverage computed on untyped data; schema drift fails silently | Med | Medium |
| 7 | God components | `ingestion-overview/page.tsx` (1528/36 states), `clients/[id]/page.tsx` (1454/35) | Untestable, unreviewable, merge-conflict magnets | Med | Large |
| 8 | Inconsistent fetch error handling | `clients/[id]/page.tsx:116,137,152,163` | Failures render as empty states | Med | Medium |
| 9 | No validation layer | all POST/PATCH routes | Type confusion → 500s (`meters/route.ts:30`) | Med | Medium |
| 10 | Timing-unsafe key compare | `lib/ingestion-auth.ts:5` | `===` on secret — theoretical timing oracle | Low | **Quick** |
| 11 | Dead scripts + playwright dep | `scripts/compute-end.js`, `test-date-behavior.js` | Misleads newcomers into thinking tests exist | Low | **Quick** |
| 12 | Root-level stray SQL | `migration-optional-supplier.sql` etc. | Ambiguous migration state | Low | **Quick** |

**Quick wins (one afternoon total):** #2, #4, #10, #11, #12.

---

## 4. Risks

### Security

**`xlsx@0.18.5` — highest-severity finding.** `lib/upload/parse.ts:39` calls `XLSX.read()` on **user-uploaded** file bytes, server-side. This version carries CVE-2023-30533 (prototype pollution, High) and CVE-2024-22363 (ReDoS). The critical wrinkle: **SheetJS stopped publishing to npm after 0.18.5** — `npm install xlsx@latest` still gives you the vulnerable version. There is no registry-based upgrade path. Options: repoint to `https://cdn.sheetjs.com/xlsx-0.20.x/xlsx-0.20.x.tgz`, or migrate to `exceljs`. Mitigating factor: reaching the parser requires an authenticated session with membership on the target client (`upload/route.ts:50-68` verifies before parsing), so this is not unauthenticated RCE-adjacent — but it is a privilege-escalation vector from any low-trust user account.

**Internal error text returned to clients.** `app/api/meters/route.ts:53` returns `details: error.message`; `unified-confirm/route.ts:136` returns `detail`. This surfaces Postgres constraint names, column names, and internal invariants. Standard practice: log server-side, return an opaque message plus a correlation id.

**Unbounded upload.** `upload/route.ts:32` does `await request.formData()` with no size check, and `maxDuration = 300` (line 3). App Router route handlers have no default body-size limit (the 4 MB cap is a Pages-API thing). A 500 MB xlsx buffers fully into memory before parsing. Add an explicit `file.size` guard before `parseUploadFile`.

**`formData.get('file') as File`** (line 33) is an unchecked cast. A non-file form field makes `file.name` undefined → `.toLowerCase()` throws (`parse.ts:51`) → 500. Should be `instanceof File`.

**Timing-unsafe secret comparison.** `lib/ingestion-auth.ts:5` uses `===` on the API key. Use `crypto.timingSafeEqual`. Low practical risk over network jitter, but it's a two-line fix on your only machine-facing auth boundary. *Positive note:* it fails closed if `INGESTION_API_KEY` is unset (compares against `undefined`), which is the right default.

**Shared-catalogue write policies.** `002_auth_rls_membership.sql:188-219` grants any authenticated user `INSERT` on `suppliers` and `INSERT`/`UPDATE` on `utility_categories` with `WITH CHECK (true)` — these are global, cross-tenant tables. The comments explain why (upload find-or-create), and it's a deliberate call, but it means any user of client A can rename a category row that client B's reports depend on. Worth revisiting as a tenant-scoped or admin-gated write.

**No secrets in the repo** — `.gitignore` correctly excludes `.env*.local`, `.env.local.example` contains only placeholders, and I found no hardcoded keys. Clean.

### Fragility

- **No error boundaries whatsoever.** There is no `error.tsx`, `global-error.tsx`, `loading.tsx`, or `not-found.tsx` anywhere in `app/`, and no `componentDidCatch`/`ErrorBoundary` component. With 28 client components doing 21+ ad-hoc fetches, any render-time throw (e.g. `.map` on an unexpected `null` from one of the `any`-typed responses) takes down the whole route with Next's default blank error screen. Adding `app/error.tsx` is a ~20-line, high-leverage fix.
- **RLS is a single point of failure.** Correct today, and well-written — but authorization lives entirely in SQL with **no test asserting it**. Nothing prevents a future `createSupabaseServiceRoleClient()` import into a browser-facing route from silently removing all tenant isolation. That combination — security wholly in RLS + zero tests + a service-role escape hatch one import away — is the structural risk I'd worry about most on a growing team.
- **Sequential per-row upload processing.** `upload/route.ts:92-114` awaits each row serially, and `process-invoice-row.ts:121` issues a duplicate-check query per row. *Credit:* `lib/upload/resolver.ts` implements a proper request-scoped cache (facility/supplier/category/meter Maps, lines 24-30) and the classic N+1 was already addressed — `pending/route.ts:183` is a deliberate chunked batch insert, not an N+1. So the remaining cost is one query/row, and `maxDuration = 300` suggests you've already hit the ceiling. It will resurface with larger files.
- **Supabase embed shape ambiguity** — the repeated `Array.isArray(category) ? category[0] : category` defensive code (`pending-mode/route.ts:18-23`) indicates nobody's certain what the client returns. Generated DB types resolve this definitively.

---

## 5. Prioritized Summary

| # | Issue | Severity | Effort | File(s) |
|---|---|---|---|---|
| 1 | `xlsx@0.18.5` — CVEs, no npm fix path; parses user uploads server-side | **High** | Med | `lib/upload/parse.ts:9,39` |
| 2 | Zero automated tests across 22.7k lines | **High** | Large | repo-wide; start `lib/ingestion-dates.ts`, `lib/coverage.ts`, `lib/upload/parse.ts` |
| 3 | ESLint never configured — `npm run lint` can't run; hook suppressions inert | **High** | **Quick** | no `.eslintrc*`; `app/page.tsx:71`, `components/InvoiceForm.tsx:113` |
| 4 | No error boundaries — any render throw blanks the route | Med-High | **Quick** | missing `app/error.tsx`, `app/global-error.tsx` |
| 5 | Internal error messages leaked to clients | Med | **Quick** | `api/meters/route.ts:53`, `ingestion/unified-confirm/route.ts:136`, ~20 more |
| 6 | Ingestion route triplication (~1,200 lines, 3 impls) | Med | Large | `api/ingestion/{confirm,unified-confirm,metered/confirm}` + error trio |
| 7 | Inconsistent fetch error handling — failures render as empty states | Med | Med | `app/clients/[id]/page.tsx:116,137,152,163`; `FacilityGroupManager.tsx:71,80,89` |
| 8 | God components (1528/36 states, 1454/35 states) | Med | Large | `app/ingestion-overview/page.tsx`, `app/clients/[id]/page.tsx` |
| 9 | No validation layer → type-confusion 500s | Med | Med | `api/meters/route.ts:15-30`; all POST/PATCH routes |
| 10 | 11 `any` casts in coverage computation | Med | Med | `api/clients/[id]/coverage/non-metered/route.ts:39-172` |
| 11 | Unbounded upload size + unchecked `as File` cast | Med | **Quick** | `api/clients/[id]/upload/route.ts:3,32-33` |
| 12 | Timing-unsafe API key comparison | Low | **Quick** | `lib/ingestion-auth.ts:5` |

**Suggested first week:** #3 → #5 → #4 → #11 → #12 (all quick, all reduce blast radius), then #1 (needs a dependency decision), then start #2 on the pure date/coverage functions — which is also the prerequisite that makes #6 and #8 safe to attempt.

**Honest overall read:** the *security architecture* is above average for a project this size — the RLS design is careful, the service-role escape hatch is gated correctly, and the env-key guard shows someone thinking about failure modes. The *engineering discipline around it* is where the debt sits: no tests, no working linter, no validation layer, no error boundaries, and 3,000 lines concentrated in two unmaintainable page components. The gap between "the security model is well-designed" and "nothing verifies the security model still holds" is the thing I'd flag to whoever owns this.

---

## Addendum — since this audit was written

Two production regressions were found and fixed after this audit (see PR #61, merged 2026-07-22):
row ids returned by the fuzzy-name-lookup RPC helpers (`lib/name-lookup.ts`) came back as strings
while sibling PostgREST reads stayed numeric, so a `===` comparison in metered ingestion
(`lib/ingestion-metered.ts`) and the upload resolver (`lib/upload/resolver.ts`) silently rejected
valid data. Both are exactly the class of defect flagged in §2 ("Supabase results are `any`, so a
field annotated `string` can hold a number at runtime and still compile") and in §3 item #1
(no tests to catch it). `lib/row-id.ts` now centralises id comparison (`sameId`) and keying
(`idKey`) — worth grepping for other unguarded `===`/`!==` on ids if this pattern recurs.
