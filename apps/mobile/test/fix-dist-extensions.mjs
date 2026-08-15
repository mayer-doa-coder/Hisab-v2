#!/usr/bin/env node
// fix-dist-extensions.mjs — test-tooling only, not app code. Same fix as
// packages/domain/test/fix-dist-extensions.mjs (Step 4): Node's ESM loader
// requires explicit file extensions on every relative import; this
// package's source files use extensionless relative imports throughout
// (valid under `moduleResolution: "bundler"`, what Metro and `tsc --noEmit`
// expect, but not valid at plain-Node runtime). Patches the already-
// compiled, gitignored `dist/` output in place — source files are never
// touched.

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const distDir = path.join(import.meta.dirname, '..', 'dist');

// Unlike packages/domain (flat, single-segment relative imports like
// './money'), this package's src/data/ and test/ files reference each other
// across directories ('../src/data/schema'), so the path portion must allow
// internal slashes too.
const BARE_RELATIVE_SPECIFIER = /(from\s+|import\s*\(\s*)(['"])(\.\.?\/[A-Za-z0-9_/-]+)\2/g;

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
