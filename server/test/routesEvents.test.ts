// routesEvents.test.ts — parseSince/parseLimit, the query-param validation
// for GET /v1/events. Pure functions, no database — runs every time, unlike
// the rest of server/test/*, which SKIPs without DATABASE_URL.
//
// parseLimit is the fix: before this audit, server.ts passed `?limit=` to
// pullEvents as `Number(limitParam)` with no validation at all — unlike
// `since`, which parseSince already guarded. A malformed value (`limit=abc`,
// `limit=1.5`, `limit=-1`) produced NaN or a non-integer that flowed straight
// into a real `LIMIT $3` SQL parameter, surfacing as an unhandled Postgres
// type error and a bare 500 instead of a clean 400.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpError } from '../src/http/respond.ts';
import { parseLimit, parseSince } from '../src/routes/events.ts';

void test('parseSince: null or empty means "from the beginning"', () => {
  assert.equal(parseSince(null), 0);
  assert.equal(parseSince(''), 0);
});

void test('parseSince: accepts a non-negative integer', () => {
  assert.equal(parseSince('0'), 0);
  assert.equal(parseSince('42'), 42);
});

void test('parseSince: rejects malformed input with a 400, not a crash', () => {
  for (const bad of ['abc', '1.5', '-1', 'NaN', 'Infinity', '1e10x']) {
    assert.throws(() => parseSince(bad), (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 400);
      assert.equal(error.code, 'INVALID_SINCE');
      return true;
    });
  }
});

void test('parseLimit: null or empty falls back to the default page size', () => {
  assert.equal(parseLimit(null), 500);
  assert.equal(parseLimit(''), 500);
  assert.equal(parseLimit(null, 250), 250);
});

void test('parseLimit: accepts a positive integer', () => {
  assert.equal(parseLimit('1'), 1);
  assert.equal(parseLimit('1000'), 1000);
});

void test('REGRESSION: parseLimit rejects malformed input with a 400, never NaN through to SQL', () => {
  for (const bad of ['abc', '1.5', '0', '-1', 'NaN', 'Infinity', '1e10x', ' ']) {
    assert.throws(
      () => parseLimit(bad),
      (error: unknown) => {
        assert.ok(error instanceof HttpError, `"${bad}" must throw HttpError, not return NaN`);
        assert.equal(error.status, 400);
        assert.equal(error.code, 'INVALID_LIMIT');
        return true;
      },
      `"${bad}" must be rejected`,
    );
  }
});
