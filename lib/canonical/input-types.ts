/**
 * lib/canonical/input-types.ts
 *
 * Input Type names must match EnviroCapture exactly — they select the NGERS
 * emissions factor, so a wrong match is a wrong number rather than a cosmetic
 * inconsistency. The canonical set is therefore whatever is in the tracker's
 * input_types table (preloaded per upload), never a list hardcoded here.
 *
 * This module supplies two things around that set:
 *   - aliases for spellings that are unambiguously the same NGERS item
 *   - a resolver that refuses to guess, and suggests instead
 *
 * What is deliberately NOT aliased: anything that would merge distinct NGERS
 * items. "Diesel oil (40)" (fuel for electricity generation) is not folded into
 * "Diesel oil", and neither Gasoline variant is folded into the other. Those
 * are decisions for whoever owns the factors, not for an importer.
 */

import { resolveCanonical, suggestNames } from '@/lib/canonical/match';

/**
 * Alias → canonical EnviroCapture Input Type name.
 *
 * Only spelling, casing, and abbreviation variants observed in real EC exports.
 * An alias is applied only when its target actually exists in input_types, so
 * adding a new input type can never silently change what an alias resolves to.
 */
export const INPUT_TYPE_ALIASES: Readonly<Record<string, string>> = {
  // LPG — "Liquified" is a common misspelling of "Liquefied" in the exports.
  'LPG': 'Liquefied petroleum gas (LPG)',
  'Liquified Petroleum Gas': 'Liquefied petroleum gas (LPG)',
  'Liquefied Petroleum Gas': 'Liquefied petroleum gas (LPG)',
  'Liquified petroleum gas (LPG)': 'Liquefied petroleum gas (LPG)',

  // Diesel — the bare word only ever means the transport/stationary fuel.
  'Diesel': 'Diesel oil',
  'Diesel Oil': 'Diesel oil',

  // Petrol/gasoline synonyms for the plain "Gasoline" item.
  'Petrol': 'Gasoline',
  'Motor Gasoline': 'Gasoline',
  'Regular Petrol': 'Gasoline',
  'Premium Petrol': 'Gasoline',
  'Unleaded': 'Gasoline',
  'ULP': 'Gasoline',

  // Natural gas delivered by pipeline.
  'Natural Gas': 'Natural gas distributed in a pipeline',
  'NG': 'Natural gas distributed in a pipeline',
  'Pipeline Natural Gas': 'Natural gas distributed in a pipeline',
};

/**
 * EnviroCapture records the electricity *grid region* as the Input Type on
 * Scope 2 rows ("WA - SWIS", "NSW & ACT", …). This tracker does not model the
 * region — it has a single "Electricity" input type — so these all resolve to
 * that. The region itself is not stored; it is not part of what the setup
 * template captures.
 */
export const ELECTRICITY_REGION_ALIASES: readonly string[] = [
  'WA - SWIS', 'WA - NWIS', 'NT - DKIS', 'NSW & ACT', 'QLD', 'VIC', 'SA', 'TAS',
  'NEM', 'OFF-GRID', 'Market-Based',
  'Queensland', 'Victoria', 'Tasmania', 'South Australia',
  'New South Wales and Australian Capital Territory',
  'Western Australia - South West Interconnected System (SWIS)',
  'South West Interconnected System (SWIS) in Western Australia',
  'Western Australia - North Western Interconnected System (NWIS)',
];

const ELECTRICITY = 'Electricity';

/**
 * Input Types never fuzzy-match. NGERS names differ from each other by a token
 * or two while naming genuinely different fuels with different factors —
 * "Diesel oil" vs "Diesel oil (40)" (fuel for electricity generation) score
 * 0.9 similar and are not interchangeable. Only exact, normalised, and
 * explicitly aliased values are accepted; everything else is reported with
 * suggestions so a person decides.
 */
const NO_FUZZY = 1.01;

export type InputTypeResolution =
  | { ok: true; name: string; via: 'exact' | 'normalised' | 'alias' | 'fuzzy' | 'region' }
  | { ok: false; error: string };

/**
 * Resolve a raw Input Type cell against the names that exist in input_types.
 *
 * `availableNames` is the live list from the database, so this never accepts a
 * value the importer would fail on later.
 */
export function resolveInputTypeName(
  raw: string,
  availableNames: readonly string[],
): InputTypeResolution {
  const input = (raw ?? '').trim();
  if (!input) return { ok: false, error: 'Missing Input Type' };

  const has = (name: string) => availableNames.some((n) => n.toLowerCase() === name.toLowerCase());
  const actual = (name: string) => availableNames.find((n) => n.toLowerCase() === name.toLowerCase())!;

  // Electricity grid regions collapse to the single Electricity input type.
  const isRegion = ELECTRICITY_REGION_ALIASES.some(
    (r) => r.toLowerCase() === input.toLowerCase(),
  );
  if (isRegion && has(ELECTRICITY)) {
    return { ok: true, name: actual(ELECTRICITY), via: 'region' };
  }

  // Aliases apply only where the target exists — otherwise fall through to
  // normal matching rather than resolving to something that isn't there.
  const applicableAliases: Record<string, string> = {};
  for (const [alias, canonical] of Object.entries(INPUT_TYPE_ALIASES)) {
    if (has(canonical)) applicableAliases[alias] = actual(canonical);
  }

  const match = resolveCanonical(input, availableNames, {
    aliases: applicableAliases,
    threshold: NO_FUZZY,
  });

  if (match) return { ok: true, name: match.canonical, via: match.via };

  const suggestions = suggestNames(input, availableNames);
  const hint = suggestions.length
    ? ` Did you mean: ${suggestions.map((s) => `"${s}"`).join(', ')}?`
    : '';

  return {
    ok: false,
    error:
      `Unknown Input Type: "${input}".${hint} ` +
      'Input Type must match the EnviroCapture name exactly — see ' +
      'docs/meter-setup-quick-import.md, or add it under Manage Input Types.',
  };
}
