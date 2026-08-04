/**
 * lib/canonical/match.ts
 *
 * Name standardisation shared by the upload and ingestion paths.
 *
 * Source data (clients, suppliers, sender domains) comes from the operations
 * team's emailMapping workbook, extracted into lib/canonical/data.ts by
 * scripts/build-canonical-data.mjs.
 *
 * Matching runs in three tiers, strongest first:
 *   1. exact match on the canonical name
 *   2. exact match after normalisation (case, punctuation, legal suffixes,
 *      "and"/"&", collapsed whitespace)
 *   3. trigram similarity above a threshold — the same Dice coefficient shape
 *      Postgres pg_trgm uses, so results agree with the get_*_by_name RPCs
 *
 * Tier 3 returns a *suggestion*, not a silent rewrite, wherever picking wrong
 * would mis-attribute data. Callers decide whether to auto-apply it.
 */

/** Words that carry no identity and only add noise to comparisons. */
const NOISE_WORDS = new Set([
  'pty', 'ltd', 'limited', 'inc', 'incorporated', 'group', 'holdings',
  'australia', 'australian', 'co', 'company', 'corporation', 'corp',
  'the', 'energy', 'services', 'service',
]);

/**
 * Lowercase, strip punctuation, expand "&", drop legal/filler words.
 * "Oil & Energy" and "Oil and Energy" both become "oil".
 */
export function normaliseName(raw: string): string {
  const base = (raw ?? '')
    .normalize('NFKC')
    .replace(/ /g, ' ')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  if (!base) return '';

  // Stripping is abandoned when it would leave a single word: "Water
  // Corporation" reduced to "water" collides with every other water utility,
  // and short generic stems are exactly where fuzzy matching goes wrong.
  const all = base.split(' ').filter(Boolean);
  const stripped = all.filter((w) => !NOISE_WORDS.has(w));
  return (stripped.length >= 2 || all.length === 1 ? stripped : all).join(' ') || base;
}

/** Trigrams of a normalised string, padded like pg_trgm does. */
function trigrams(s: string): Set<string> {
  const padded = `  ${s} `;
  const out = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3));
  return out;
}

/** Dice coefficient over trigrams: 0 (nothing shared) to 1 (identical). */
export function similarity(a: string, b: string): number {
  const na = normaliseName(a);
  const nb = normaliseName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  const ta = trigrams(na);
  const tb = trigrams(nb);
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return (2 * shared) / (ta.size + tb.size);
}

/** Default confidence floor. Below this, a match is reported but not applied. */
export const AUTO_APPLY_THRESHOLD = 0.72;

/**
 * A fuzzy winner must beat the runner-up by this much. "ReFuel" sitting between
 * "Refuel AUS" and "Refuel Solutions" is a question for a human, not a coin toss.
 */
const AMBIGUITY_MARGIN = 0.05;

export type CanonicalMatch = {
  /** The canonical name to use. */
  canonical: string;
  /** How the match was made. */
  via: 'exact' | 'normalised' | 'alias' | 'fuzzy';
  /** 1 for exact/normalised/alias; the similarity score for fuzzy. */
  score: number;
};

export type ResolveOptions = {
  /** Explicit alias → canonical overrides, checked before fuzzy matching. */
  aliases?: Record<string, string>;
  /** Minimum similarity for a fuzzy match to be returned. */
  threshold?: number;
};

/**
 * Resolve `input` against `canonicalNames`.
 * Returns null when nothing clears the threshold — the caller then keeps the
 * raw value or raises an error, depending on how costly a wrong guess is.
 */
export function resolveCanonical(
  input: string,
  canonicalNames: readonly string[],
  options: ResolveOptions = {},
): CanonicalMatch | null {
  const raw = (input ?? '').trim();
  if (!raw) return null;

  const threshold = options.threshold ?? AUTO_APPLY_THRESHOLD;

  for (const name of canonicalNames) {
    if (name === raw) return { canonical: name, via: 'exact', score: 1 };
  }

  const normalisedInput = normaliseName(raw);

  if (options.aliases) {
    for (const [alias, canonical] of Object.entries(options.aliases)) {
      if (normaliseName(alias) === normalisedInput) {
        return { canonical, via: 'alias', score: 1 };
      }
    }
  }

  for (const name of canonicalNames) {
    if (normaliseName(name) === normalisedInput) {
      return { canonical: name, via: 'normalised', score: 1 };
    }
  }

  let best: { name: string; score: number } | null = null;
  let runnerUp = 0;
  for (const name of canonicalNames) {
    const score = similarity(raw, name);
    if (score < threshold) continue;
    if (!best || score > best.score) {
      runnerUp = best ? best.score : runnerUp;
      best = { name, score };
    } else if (score > runnerUp) {
      runnerUp = score;
    }
  }

  if (!best) return null;
  // Two plausible candidates: refuse rather than guess.
  if (best.score - runnerUp < AMBIGUITY_MARGIN) return null;

  return { canonical: best.name, via: 'fuzzy', score: best.score };
}

/**
 * The closest `limit` names to `input`, best first — for "did you mean…"
 * messages. Unlike resolveCanonical this has no threshold, so it always
 * returns something to show the user when a value is rejected.
 */
export function suggestNames(
  input: string,
  canonicalNames: readonly string[],
  limit = 3,
): string[] {
  return canonicalNames
    .map((name) => ({ name, score: similarity(input, name) }))
    .filter((s) => s.score > 0.2)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.name);
}
