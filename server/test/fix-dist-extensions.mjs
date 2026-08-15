#!/usr/bin/env node
// fix-dist-extensions.mjs — test-tooling only, not app code. Same fix as
// packages/domain/test/ and apps/mobile/test/: Node's ESM loader requires
// explicit file extensions on every relative import, while the source files
// use extensionless ones (valid under `moduleResolution: "bundler"`, which is
// what Metro and `tsc --noEmit` expect). Patches the already-compiled,
// gitignored dist/ output in place; source files are never touched.
//
// Bare specifiers (@hisab/domain, pg, zod, sql.js) are left alone — only
// relative paths need the extension.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const distDir = path.join(import.meta.dirname, '..', 'dist');

// Unlike the packages/domain and apps/mobile copies, this one must handle
// MULTI-LEVEL relative paths ('../../apps/mobile/src/sync/api'), because the
// convergence test reaches across workspaces. Those earlier regexes matched
// the path body with [A-Za-z0-9_/-]+, which cannot cross a second '..' — so
// the specifier is captured as "anything up to the closing quote" here, and
// the already-has-an-extension case is handled in the replacer instead.
const RELATIVE_SPECIFIER = /(from\s+|import\s*\(\s*)(['"])(\.{1,2}\/[^'"]*)\2/g;
const ALREADY_EXTENSIONED = /\.(js|mjs|cjs|json|node)$/;

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full);
    } else if (full.endsWith('.js')) {
      const before = readFileSync(full, 'utf8');
      const after = before.replace(RELATIVE_SPECIFIER, (match, keyword, quote, specifier) =>
        ALREADY_EXTENSIONED.test(specifier) ? match : `${keyword}${quote}${specifier}.js${quote}`,
      );
      if (after !== before) writeFileSync(full, after);
    }
  }
}

walk(distDir);
