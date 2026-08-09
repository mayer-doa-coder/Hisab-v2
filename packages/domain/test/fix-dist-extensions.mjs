#!/usr/bin/env node
// fix-dist-extensions.mjs — test-tooling only, not domain code. Node's ESM
// loader requires explicit file extensions on every relative import; the
// domain package's source files (types.ts, money.ts, fold.ts, ...) use
// extensionless relative imports throughout, which is valid under
// tsconfig.base.json's `moduleResolution: "Bundler"` (what apps/mobile's
// Metro bundler and this package's own `tsc --noEmit` typecheck expect) but
// not valid at runtime under plain Node.
//
// Rather than rewrite every relative import across the shared, jointly-owned
// contract files just to satisfy this test runner, this script patches the
// already-compiled, gitignored `dist/` output in place after `tsc` emits it —
// appending `.js` to bare relative specifiers. Source files are never
// touched. This is a `.mjs` file specifically so ESLint's domain-purity
// rules (scoped to `packages/domain/**/*.ts`) do not apply to it, the same
// way `scripts/size-check.js` at the repo root uses `node:fs` outside any
// purity-rule scope.

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const distDir = path.join(import.meta.dirname, '..', 'dist');

const BARE_RELATIVE_SPECIFIER = /(from\s+|import\s*\(\s*)(['"])(\.\.?\/[A-Za-z0-9_-]+)\2/g;

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full);
    } else if (full.endsWith('.js')) {
      const before = readFileSync(full, 'utf8');
      const after = before.replace(BARE_RELATIVE_SPECIFIER, (match, keyword, quote, specifier) => {
        return `${keyword}${quote}${specifier}.js${quote}`;
      });
      if (after !== before) {
        writeFileSync(full, after);
      }
    }
  }
}

walk(distDir);
