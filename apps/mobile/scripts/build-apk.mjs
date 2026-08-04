#!/usr/bin/env node
// Release build, arm64-v8a only — AGENTS.md §3.4.
// OS-detected gradlew invocation: Windows locally uses gradlew.bat, CI
// (ubuntu-latest) uses ./gradlew — no cross-platform-shell dependency needed.

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const androidDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'android');
const isWindows = process.platform === 'win32';
const gradlew = path.join(androidDir, isWindows ? 'gradlew.bat' : 'gradlew');

execFileSync(gradlew, ['assembleRelease', '-PreactNativeArchitectures=arm64-v8a'], {
  cwd: androidDir,
  stdio: 'inherit',
  shell: isWindows,
});
