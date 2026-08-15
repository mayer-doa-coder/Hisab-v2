#!/usr/bin/env node
// Local equivalent of .github/workflows/size-gate.yml — AGENTS.md §3.4.
// Run after `npm run build:apk`. Raising LIMIT_MB requires an entry in
// docs/DECISIONS.md explaining what was bought and why it was worth it.

import { execSync } from 'node:child_process';
import fs from 'node:fs';

const LIMIT_MB = 25;

// Filename no longer encodes the ABI (build-apk.mjs used to rely on Gradle's
// `splits { abi {...} }` producing `app-arm64-v8a-release.apk`; that block
// was lost when android/ got regenerated and replaced with
// expo-build-properties' `buildArchs: ["arm64-v8a"]`, which restricts the
// packaged native libraries just as effectively — verified directly by
// unzipping the APK and checking lib/ — but names the single output plain
// `app-release.apk`). Matching on `*release*.apk` instead of assuming an
// ABI-named file; the actual restriction is verified at build time, not
// inferred from a filename.
const found = execSync('find . -name "*release*.apk" -not -path "*/node_modules/*"', {
  encoding: 'utf8',
}).trim();

if (!found) {
  console.error('No APK found. Run `npm run build:apk` first.');
  process.exit(1);
}

const apkPath = found.split('\n')[0];
const { size } = fs.statSync(apkPath);
const mb = size / 1024 / 1024;

console.log(`APK: ${mb.toFixed(2)} MB  |  Limit: ${LIMIT_MB} MB  (${apkPath})`);

if (mb > LIMIT_MB) {
  console.error(`Budget exceeded (${mb.toFixed(2)} MB > ${LIMIT_MB} MB). See AGENTS.md §3.4.`);
  process.exit(1);
}
