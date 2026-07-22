/**
 * Row id normalisation.
 *
 * Postgres integer primary keys arrive from PostgREST as JS numbers, but ids
 * that pass through `lib/name-lookup` are normalised to strings. Mixing the two
 * is invisible to TypeScript — Supabase query results are `any`, so a field
 * annotated `string` can hold a number at runtime and still compile.
 *
 * That mismatch silently broke metered ingestion: `meter.supplier_id` (number
 * 16) was compared with `!==` against a looked-up `supplierId` (string "16"),
 * so every row was rejected as a supplier mismatch.
 *
 * Rules:
 *   - Comparing two ids     → `sameId(a, b)`, never `===` / `!==`
 *   - Keying a Map or Set   → `idKey(id)`, never the raw value
 *
 * Both accept either representation, so callers need not know which side of
 * the boundary a value came from. PostgREST coerces string ids in `.eq()` /
 * `.in()` filters and insert payloads, so normalised ids are safe to send back.
 */

/** An id as it may appear at runtime, regardless of its declared type. */
export type RowId = string | number | null | undefined;

/**
 * Canonical string form of an id, for Map/Set keys and equality.
 * Null and undefined collapse to '' — use `sameId` if absent ids must not match.
 */
export function idKey(id: RowId): string {
  return id === null || id === undefined ? '' : String(id);
}

/**
 * True when two ids refer to the same row, ignoring string/number representation.
 * Absent ids (null/undefined) never match, including against each other.
 */
export function sameId(a: RowId, b: RowId): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  return idKey(a) === idKey(b);
}
