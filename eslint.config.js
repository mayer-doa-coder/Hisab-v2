// eslint.config.js — the rules that mechanically enforce AGENTS.md
//
// Everything here maps to a specific rule in AGENTS.md and, in most cases, to a
// specific bug in Hisab v1. Do not add eslint-disable comments to work around
// these; if a rule genuinely blocks correct code, the design is wrong — raise it.

import tseslint from 'typescript-eslint';

export default tseslint.config(
  // ---------------------------------------------------------------------------
  // AGENTS.md §3.1 — the domain layer has ZERO I/O.
  // This is the single most important rule in the codebase. It is what makes the
  // financial logic testable in milliseconds, lets the app and server share one
  // implementation instead of two that drift, and keeps a future Kotlin port a
  // mechanical translation rather than a rewrite.
  // ---------------------------------------------------------------------------
  {
    files: ['packages/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['react', 'react-*'],        message: 'AGENTS.md §3.1: domain is pure. No React.' },
          { group: ['react-native', 'react-native-*'], message: 'AGENTS.md §3.1: domain is pure. No React Native.' },
          { group: ['expo', 'expo-*'],          message: 'AGENTS.md §3.1: domain is pure. No Expo.' },
          { group: ['*sqlite*', 'pg', 'knex', 'drizzle-*', 'mongoose'], message: 'AGENTS.md §3.1: domain is pure. No database.' },
          { group: ['axios', 'node-fetch', 'undici'], message: 'AGENTS.md §3.1: domain is pure. No network.' },
          { group: ['node:fs', 'node:path', 'fs', 'path'], message: 'AGENTS.md §3.1: domain is pure. No filesystem.' },
          { group: ['@react-navigation/*'],     message: 'AGENTS.md §3.1: domain is pure. No navigation.' },
        ],
      }],
      'no-restricted-globals': ['error',
        { name: 'fetch',      message: 'AGENTS.md §3.1: domain is pure. No network.' },
        { name: 'localStorage',   message: 'AGENTS.md §3.1: domain is pure. No storage.' },
        { name: 'sessionStorage', message: 'AGENTS.md §3.1: domain is pure. No storage.' },
      ],
      // Date.now() makes folds non-deterministic and untestable. Time is passed in.
      'no-restricted-properties': ['error',
        { object: 'Date', property: 'now', message: 'AGENTS.md §3.1: pass time in as a parameter. Folds must be deterministic.' },
      ],
      'no-restricted-syntax': ['error',
        { selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'AGENTS.md §3.1: pass time in as a parameter. Folds must be deterministic.' },
        // AGENTS.md §3.2 — money is integer poisha. No float ops on it.
        { selector: "CallExpression[callee.name='parseFloat']",
          message: 'AGENTS.md §3.2: money is an integer count of poisha. parseFloat is never correct here.' },
        { selector: "MemberExpression[property.name='toFixed']",
          message: 'AGENTS.md §3.2: formatting belongs at the render boundary via toDisplayTaka(), not in domain logic.' },
      ],
    },
  },

  // ---------------------------------------------------------------------------
  // AGENTS.md §3.3 — the event log is append-only.
  // v1 stored Customer.currentDue, Supplier.totalOwed, and duplicated
  // Product.quantity alongside InventoryBatch.quantity. Those drifted under
  // offline sync, which is why v1 needed four conflict token types, three
  // resolution strategies, and three validate*Consistency functions.
  // ---------------------------------------------------------------------------
  {
    files: ['apps/mobile/src/data/**/*.ts', 'server/src/db/**/*.ts'],
    rules: {
      'no-restricted-syntax': ['error',
        { selector: "Literal[value=/UPDATE\\s+events/i]",
          message: 'AGENTS.md §3.3: the events table is append-only. A correction is an ENTRY_VOIDED event.' },
        { selector: "Literal[value=/DELETE\\s+FROM\\s+events/i]",
          message: 'AGENTS.md §3.3: the events table is append-only. Nothing is ever destroyed.' },
      ],
    },
  },

  // ---------------------------------------------------------------------------
  // AGENTS.md §4.1 — never monkey-patch React Native internals.
  // v1's App.js overrode Text.render / TextInput.render / Alert.alert at module
  // scope to inject a font and auto-translate string children. That ran a
  // translation lookup on every string in every render pass, broke React.memo,
  // made components untestable, and could silently corrupt user-entered data.
  //
  // AGENTS.md §8 — no unencrypted storage for anything sensitive.
  // ---------------------------------------------------------------------------
  {
    files: ['apps/mobile/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': ['error',
        { selector: "AssignmentExpression[left.property.name='render'][left.object.name=/^(Text|TextInput|View|ScrollView)$/]",
          message: 'AGENTS.md §4.1: never patch a React Native prototype. This was the single worst bug in v1.' },
        { selector: "AssignmentExpression[left.object.name='Alert'][left.property.name='alert']",
          message: 'AGENTS.md §4.1: never patch Alert.alert.' },
      ],
      'no-restricted-imports': ['error', {
        paths: [
          { name: '@react-native-async-storage/async-storage',
            message: 'AGENTS.md §8 / docs/SECURITY.md §2: AsyncStorage is unencrypted. Use expo-secure-store.' },
          { name: 'onnxruntime-react-native',
            message: 'AGENTS.md §4.5: 10-20 MB, and Whisper on top of it breaks the 2 GB RAM budget. See docs/DECISIONS.md.' },
        ],
      }],
      'no-restricted-globals': ['error',
        { name: 'localStorage',   message: 'Not available in React Native, and unencrypted where it is.' },
        { name: 'sessionStorage', message: 'Not available in React Native, and unencrypted where it is.' },
      ],
    },
  },

  // ---------------------------------------------------------------------------
  // AGENTS.md §8 — never log PII. Log ids, never names, phones, or amounts
  // tied to an identity. Also: no console.log in a release build.
  // ---------------------------------------------------------------------------
  {
    files: ['apps/mobile/**/*.{ts,tsx}', 'server/**/*.ts'],
    rules: {
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },

  // ---------------------------------------------------------------------------
  // Global TypeScript discipline. AGENTS.md §6.
  // ---------------------------------------------------------------------------
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': ['error', {
        'ts-ignore': 'allow-with-description',
        minimumDescriptionLength: 20,
      }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      eqeqeq: ['error', 'always'],
    },
  },
);
