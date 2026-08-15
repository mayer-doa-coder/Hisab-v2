#!/usr/bin/env node
// Release build, arm64-v8a only — AGENTS.md §3.4.
// OS-detected gradlew invocation: Windows locally uses gradlew.bat, CI
// (ubuntu-latest) uses ./gradlew — no cross-platform-shell dependency needed.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const androidDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'android');
const isWindows = process.platform === 'win32';
const gradlew = path.join(androidDir, isWindows ? 'gradlew.bat' : 'gradlew');

// Reproduced on this machine, in this order: JAVA_HOME pointed at JDK 11
// (too old — Gradle itself requires 17+); PATH's `java` resolved to JDK 25
// (new enough for Gradle, but too new for this AGP/CMake/NDK toolchain,
// which failed with "A restricted method in java.lang.System has been
// called" during a native-module configure step — a real, reproduced
// failure, not a hypothetical upper bound). 17-21 is the range Android
// tooling is actually built and tested against.
const MIN_JAVA_MAJOR = 17;
const MAX_JAVA_MAJOR = 21;

/** java -version writes to stderr, not stdout — execFileSync's simple string
 * return only captures stdout, which is why an earlier version of this
 * check silently reported "unknown" for a real JDK. spawnSync exposes both. */
function javaMajorVersion(javaHome) {
  const bin = path.join(javaHome, 'bin', isWindows ? 'java.exe' : 'java');
  if (!existsSync(bin)) return null;
  const result = spawnSync(bin, ['-version'], { encoding: 'utf8' });
  const text = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const match = /version "(\d+)/.exec(text);
  return match ? Number(match[1]) : null;
}

function isCompatible(major) {
  return major !== null && major >= MIN_JAVA_MAJOR && major <= MAX_JAVA_MAJOR;
}

// Android Studio bundles a JetBrains Runtime specifically validated against
// the current AGP/NDK toolchain — the standard, well-known answer to "which
// JDK should build Android projects" on a machine that has Android Studio
// installed at all, which is true for effectively every Android developer.
// Checked, not assumed: only used if it actually exists and is in range.
const ANDROID_STUDIO_JBR_CANDIDATES = isWindows
  ? ['C:\\Program Files\\Android\\Android Studio\\jbr']
  : process.platform === 'darwin'
    ? ['/Applications/Android Studio.app/Contents/jbr/Contents/Home']
    : [`${process.env.HOME ?? ''}/android-studio/jbr`, '/opt/android-studio/jbr'];

/** Where PATH's `java` actually lives, two directories up from the binary. */
function pathJavaHome() {
  try {
    const bin = execFileSync(isWindows ? 'where' : 'which', ['java'], { encoding: 'utf8' }).split(/\r?\n/)[0];
    return bin ? path.dirname(path.dirname(bin)) : null;
  } catch {
    return null;
  }
}

function findCompatibleJavaHome() {
  const current = process.env.JAVA_HOME;
  if (current && isCompatible(javaMajorVersion(current))) {
    return { javaHome: current, source: 'JAVA_HOME (already compatible)' };
  }

  const onPath = pathJavaHome();
  if (onPath && isCompatible(javaMajorVersion(onPath))) {
    return { javaHome: onPath, source: 'java resolved from PATH' };
  }

  for (const candidate of ANDROID_STUDIO_JBR_CANDIDATES) {
    if (isCompatible(javaMajorVersion(candidate))) {
      return { javaHome: candidate, source: 'Android Studio bundled JBR' };
    }
  }

  return null;
}

const found = findCompatibleJavaHome();
const env = { ...process.env };

if (found) {
  if (found.javaHome !== env.JAVA_HOME) {
    console.warn(`Using ${found.source} at ${found.javaHome} (JAVA_HOME was ${env.JAVA_HOME ?? 'unset'}).`);
    env.JAVA_HOME = found.javaHome;
  }
} else {
  console.warn(
    `No Java ${MIN_JAVA_MAJOR}-${MAX_JAVA_MAJOR} found in JAVA_HOME, PATH, or the standard Android Studio ` +
      `JBR location. Falling back to PATH as-is; the build may fail. Install a JDK in that range ` +
      `(Android Studio's bundled JBR is the simplest source) and either set JAVA_HOME or install Android Studio.`,
  );
}

execFileSync(gradlew, ['assembleRelease', '-PreactNativeArchitectures=arm64-v8a'], {
  cwd: androidDir,
  stdio: 'inherit',
  shell: isWindows,
  env,
});
