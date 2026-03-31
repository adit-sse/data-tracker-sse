// Shared rules for utility category scope / metered flag (upload + ingestion).

const CATEGORY_RULES: Array<{
  keywords: string[];
  scope: number;
  is_metered: boolean;
}> = [
  { keywords: ['ELECTRICITY'], scope: 2, is_metered: true },
  { keywords: ['GASOLINE', 'PETROL'], scope: 1, is_metered: false },
  // Before standalone GAS so "Bio gas" / BIOGAS are non-metered fuel, not pipeline gas
  {
    keywords: ['DIESEL', 'FUEL', 'LPG', 'OIL', 'GREASE', 'BIOGAS', 'BIO GAS'],
    scope: 1,
    is_metered: false,
  },
  { keywords: ['GAS'], scope: 1, is_metered: true },
  {
    keywords: [
      'SCOPE 3',
      'PURCHASED',
      'CAPITAL GOODS',
      'UPSTREAM TRANSPORT',
      'DOWNSTREAM TRANSPORT',
      'BUSINESS TRAVEL',
      'WASTE',
      'WATER',
    ],
    scope: 3,
    is_metered: false,
  },
];

export function keywordMatches(normalised: string, keyword: string): boolean {
  return new RegExp(`\\b${keyword}\\b`).test(normalised);
}

export function classifyCategory(name: string): {
  scope: number;
  is_metered: boolean;
  needs_review: boolean;
} {
  const normalised = name.trim().toUpperCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some((k) => keywordMatches(normalised, k))) {
      return { scope: rule.scope, is_metered: rule.is_metered, needs_review: false };
    }
  }
  return { scope: 1, is_metered: false, needs_review: true };
}
