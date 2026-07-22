/**
 * NMI (National Metering Identifier) handling.
 *
 * A NMI is 10 characters. An optional 11th character is the AEMO checksum, so
 * the same meter legitimately appears in source data as either form:
 *
 *   7001127349   ← 10-char NMI
 *   70011273496  ← same NMI plus checksum "6"
 *
 * Meter lookup matches lookup1 exactly, so without reconciling these a meter
 * stored in one form is invisible to a row sent in the other — and "create the
 * meter first" advice then produces a duplicate meter for one physical site,
 * splitting its consumption silently.
 */

/** Characters in a NMI before the optional checksum digit. */
const NMI_LENGTH = 10;

/**
 * AEMO NMI checksum: a modified Luhn over the ASCII values of the 10 characters.
 *
 * Walk right to left, double every second value, sum the digits of the results,
 * then take the amount needed to reach the next multiple of ten. Operates on
 * ASCII rather than digits because a NMI may contain letters.
 */
export function nmiChecksum(base: string): string {
  const value = base.trim().toUpperCase();
  let total = 0;

  for (let i = 0; i < value.length; i++) {
    let v = value.charCodeAt(value.length - 1 - i);
    if (i % 2 === 0) v *= 2;
    while (v > 0) {
      total += v % 10;
      v = Math.floor(v / 10);
    }
  }

  return String((10 - (total % 10)) % 10);
}

/** True if `value` is an 11-character NMI whose final character is a valid checksum. */
export function hasValidNmiChecksum(value: string): boolean {
  const v = (value ?? '').trim();
  if (v.length !== NMI_LENGTH + 1) return false;
  return nmiChecksum(v.slice(0, NMI_LENGTH)) === v.slice(NMI_LENGTH);
}

/**
 * The forms a NMI could be stored as, for an `.in()` lookup. Always includes the
 * value as given, first.
 *
 *   10 chars           → [value, value + checksum]
 *   11 chars, valid    → [value, value without checksum]
 *   11 chars, invalid  → [value]  ← the last character is data, not a checksum
 *   any other length   → [value]
 *
 * The invalid-checksum case is the important one: stripping a character that
 * merely looks like a checksum would match the wrong meter.
 */
export function nmiLookupCandidates(value: string): string[] {
  const v = (value ?? '').trim();
  if (!v) return [];

  if (v.length === NMI_LENGTH) {
    return [v, v + nmiChecksum(v)];
  }

  if (v.length === NMI_LENGTH + 1 && hasValidNmiChecksum(v)) {
    return [v, v.slice(0, NMI_LENGTH)];
  }

  return [v];
}

/**
 * Lookup candidates for any identifier type. Only NMIs get checksum treatment —
 * MIRNs, account numbers and meter numbers have no such convention, and trimming
 * a character from those would be wrong.
 */
export function identifierLookupCandidates(
  identifierType: string,
  lookup1: string
): string[] {
  const v = (lookup1 ?? '').trim();
  if (!v) return [];
  return identifierType === 'NMI' ? nmiLookupCandidates(v) : [v];
}
