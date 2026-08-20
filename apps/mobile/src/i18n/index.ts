// index.ts — the explicit t() lookup. AGENTS.md §4.1: "Localisation happens
// through explicit t() calls." No global string interception, no wrapper
// around Text that inspects children — every call site names its namespace
// and key directly. See docs/DECISIONS.md on why a global wrapper would
// recreate v1's monkey-patch risk even without touching .render.

import { common as commonBn } from './bn/common';
import { customers as customersBn } from './bn/customers';
import { products as productsBn } from './bn/products';
import { summary as summaryBn } from './bn/summary';
import { common as commonEn } from './en/common';
import { customers as customersEn } from './en/customers';
import { products as productsEn } from './en/products';
import { summary as summaryEn } from './en/summary';

export type Locale = 'bn' | 'en';

const dictionaries = {
  common: { bn: commonBn, en: commonEn },
  customers: { bn: customersBn, en: customersEn },
  products: { bn: productsBn, en: productsEn },
  summary: { bn: summaryBn, en: summaryEn },
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
  const value = dict[key as string];

  // Under `noUncheckedIndexedAccess` that lookup is `string | undefined`. It
  // used to be returned directly, typed as `string`, which compiled only
  // because apps/mobile/tsconfig.json extends expo's base and does NOT enable
  // that flag — the stricter test tsconfig caught it in Step 13 the moment
  // i18n was pulled into the test compile. A missing key would have rendered
  // the literal text "undefined" on screen.
  //
  // Throwing rather than falling back to English: a key present in one locale
  // and absent in the other is a programmer error (AGENTS.md §6, "Exceptions
  // are reserved for programmer error"), and the interface-per-namespace
  // pattern exists precisely so it is a compile error first. A silent
  // English fallback in a Bengali-first app is the failure mode this whole
  // arrangement was set up to avoid.
  if (value === undefined) {
    throw new Error(`t(): missing ${locale}.${namespace}.${String(key)}`);
  }
  return value;
}
