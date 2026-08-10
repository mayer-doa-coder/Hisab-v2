// index.ts — the explicit t() lookup. AGENTS.md §4.1: "Localisation happens
// through explicit t() calls." No global string interception, no wrapper
// around Text that inspects children — every call site names its namespace
// and key directly. See docs/DECISIONS.md on why a global wrapper would
// recreate v1's monkey-patch risk even without touching .render.

import { common as commonBn } from './bn/common';
import { customers as customersBn } from './bn/customers';
import { products as productsBn } from './bn/products';
import { common as commonEn } from './en/common';
import { customers as customersEn } from './en/customers';
import { products as productsEn } from './en/products';

export type Locale = 'bn' | 'en';

const dictionaries = {
  common: { bn: commonBn, en: commonEn },
  customers: { bn: customersBn, en: customersEn },
  products: { bn: productsBn, en: productsEn },
} as const;

type Dictionaries = typeof dictionaries;

/** Explicit call, every time: t(locale, 'common', 'save'). No implicit lookup. */
export function t<N extends keyof Dictionaries>(
  locale: Locale,
  namespace: N,
  key: keyof Dictionaries[N]['bn'],
): string {
  // Both `bn` and `en` implement the exact same *Strings interface per
  // namespace (enforced at each en/*.ts file, not here), so this indexed
  // access is safe by construction — TS just can't prove it through a
  // generic union of otherwise-unrelated record types.
  const dict = dictionaries[namespace][locale] as unknown as Record<string, string>;
  return dict[key as string];
}
