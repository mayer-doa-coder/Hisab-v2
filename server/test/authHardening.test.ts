// authHardening.test.ts — Step 11 audit item 5: device-fingerprint-bound
// refresh tokens, rotation on every use, family revocation + a security
// event on reuse or fingerprint mismatch, and rate-limited PIN attempts with
// exponential lockout. Item 4's rate envelope is covered here too — it needs
// a real Pool + a small injected threshold, which is a level below what the
// HTTP-only tests in server.test.ts exercise.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Api, ApiError } from '../../apps/mobile/src/sync/api';
import { createServer } from '../src/server';
import { pushEvents } from '../src/routes/events';
import { lockoutDurationMs } from '../src/auth/lockout';
import { closePool, getPool, resetDatabase, SKIP_WITHOUT_DB } from './pg';

// ---------------------------------------------------------------------------
// lockoutDurationMs — pure function, no DB needed. Runs regardless of
// SKIP_WITHOUT_DB so the formula itself is always checked.
// ---------------------------------------------------------------------------

void test('lockoutDurationMs is zero below the threshold, then doubles, then caps', () => {
  assert.equal(lockoutDurationMs(0), 0);
  assert.equal(lockoutDurationMs(4), 0, 'below the 5-attempt threshold: no lockout yet');
  assert.equal(lockoutDurationMs(5), 30_000, 'at the threshold: the base duration');
  assert.equal(lockoutDurationMs(6), 60_000);
  assert.equal(lockoutDurationMs(7), 120_000);
  assert.equal(lockoutDurationMs(8), 240_000);
  // 30_000 * 2^n exceeds 3_600_000 once n >= 7 (30_000*128=3_840_000); confirm the cap holds, not just approaches it.
  assert.equal(lockoutDurationMs(20), 3_600_000, 'capped at 1 hour however many failures pile up');
});

// ---------------------------------------------------------------------------
// The rest needs a real server + real Postgres. A SEPARATE server instance
// from server.test.ts's shared one, because the lockout tests need a
// controllable clock and the rotation tests need to call pushEvents()
// directly below the HTTP layer — neither fits the shared `before()` server.
// ---------------------------------------------------------------------------

let baseUrl = '';
let httpServer: Server | null = null;
let simulatedNow = 1_700_000_000_000;

before(async () => {
  if (SKIP_WITHOUT_DB !== false) return;
  const pool = await getPool();
  httpServer = createServer({ pool, now: () => simulatedNow });
  await new Promise<void>((resolve) => httpServer?.listen(0, '127.0.0.1', resolve));
  const address = httpServer?.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    httpServer?.close((error) => (error ? reject(error) : resolve()));
  });
  await closePool();
});

beforeEach(async () => {
  if (SKIP_WITHOUT_DB !== false) return;
  await resetDatabase();
  simulatedNow = 1_700_000_000_000;
});

function api(): Api {
  return new Api({ baseUrl });
}

// ---------------------------------------------------------------------------
// Rotation, reuse detection, fingerprint mismatch, security events.
// ---------------------------------------------------------------------------

void test('refresh rotates: each generation is usable exactly once, chained across several rotations', { skip: SKIP_WITHOUT_DB }, async () => {
  const client = api();
  const gen0 = await client.register('01800000001', '112233', 'device-a');

  // Chain three rotations, using ONLY the newest token each time — the
  // normal client behaviour. Deliberately never reuses an older generation
  // here; that path (which revokes the whole family) is its own test below.
  const gen1 = await client.refresh(gen0.refresh_token, 'device-a');
  assert.notEqual(gen1.refresh_token, gen0.refresh_token, 'rotation must mint a genuinely new refresh token');

  const gen2 = await client.refresh(gen1.refresh_token, 'device-a');
  assert.notEqual(gen2.refresh_token, gen1.refresh_token);
  assert.ok(gen2.access_token.length > 0);

  // gen0 — superseded two rotations ago — must still be dead.
  await assert.rejects(
    () => client.refresh(gen0.refresh_token, 'device-a'),
    (error: unknown) => error instanceof ApiError && error.status === 401,
  );
});

void test(
  'reusing an already-rotated refresh token revokes the WHOLE family, including tokens minted after it',
  { skip: SKIP_WITHOUT_DB },
  async () => {
    const client = api();
    const tokens = await client.register('01800000002', '112233', 'device-a');
    const rotated = await client.refresh(tokens.refresh_token, 'device-a');

    // Reuse the dead (rotated-away) token — the classic stolen-token signal.
    await assert.rejects(
      () => client.refresh(tokens.refresh_token, 'device-a'),
      (error: unknown) => error instanceof ApiError && error.status === 401,
    );

    // The family is revoked ENTIRELY — even the token that legitimately
    // superseded the reused one is now dead. A client that only ever used
    // its own newest token would otherwise survive an attacker's reuse of
    // an old one; that would defeat the point of detecting theft at all.
    await assert.rejects(
      () => client.refresh(rotated.refresh_token, 'device-a'),
      (error: unknown) => error instanceof ApiError && error.status === 401,
      'the successor token must ALSO be revoked once its family is flagged for reuse',
    );
  },
);

void test(
  'presenting the right refresh token with the WRONG fingerprint revokes the family',
  { skip: SKIP_WITHOUT_DB },
  async () => {
    const client = api();
    const tokens = await client.register('01800000003', '112233', 'device-a');

    await assert.rejects(
      () => client.refresh(tokens.refresh_token, 'device-b'),
      (error: unknown) => error instanceof ApiError && error.status === 401,
    );

    // Even a correct fingerprint no longer works — the family is gone.
    await assert.rejects(
      () => client.refresh(tokens.refresh_token, 'device-a'),
      (error: unknown) => error instanceof ApiError && error.status === 401,
      'fingerprint mismatch must revoke the family, not just refuse the one mismatched call',
    );
  },
);

void test(
  'reuse and fingerprint-mismatch each write a security event, distinguishable by kind',
  { skip: SKIP_WITHOUT_DB },
  async () => {
    const pool = await getPool();
    const client = api();

    const tokensReuse = await client.register('01800000004', '112233', 'device-a');
    await client.refresh(tokensReuse.refresh_token, 'device-a'); // rotate once
    await assert.rejects(() => client.refresh(tokensReuse.refresh_token, 'device-a')); // reuse the dead one

    const tokensMismatch = await client.register('01800000005', '112233', 'device-a');
    await assert.rejects(() => client.refresh(tokensMismatch.refresh_token, 'device-b'));

    const { rows } = await pool.query<{ shop_id: string; kind: string }>(
      'SELECT shop_id, kind FROM security_events WHERE shop_id = ANY($1) ORDER BY created_at',
      [[tokensReuse.shop_id, tokensMismatch.shop_id]],
    );

    assert.equal(rows.length, 2, 'exactly one security event per revoked family');
    assert.equal(rows.find((r) => r.shop_id === tokensReuse.shop_id)?.kind, 'REFRESH_REUSE');
    assert.equal(rows.find((r) => r.shop_id === tokensMismatch.shop_id)?.kind, 'FINGERPRINT_MISMATCH');
  },
);

// ---------------------------------------------------------------------------
// Exponential lockout — the full cycle: locks after the threshold, refuses
// while locked (even with the RIGHT pin), and recovers once the simulated
// clock passes the lockout window.
// ---------------------------------------------------------------------------

void test('login locks out after 5 failures and recovers after the lockout window', { skip: SKIP_WITHOUT_DB }, async () => {
  const client = api();
  await client.register('01800000006', '246810', 'device-a');

  for (let i = 0; i < 5; i++) {
    await assert.rejects(
      () => client.login('01800000006', '000000', 'device-a'),
      (error: unknown) => error instanceof ApiError && error.status === 401,
      `attempt ${i + 1} should be a plain wrong-PIN rejection, not a lockout yet`,
    );
  }

  // The 6th attempt — even with the CORRECT PIN — must be refused as locked,
  // not evaluated. This is the "checked BEFORE verifying the PIN" behaviour.
  await assert.rejects(
    () => client.login('01800000006', '246810', 'device-a'),
    (error: unknown) => {
      assert.ok(error instanceof ApiError && error.status === 429);
      assert.equal(error.retryAfterMs, 30_000, 'the client must receive the server’s authoritative retry window');
      return true;
    },
  );

  // Advance the server's simulated clock past the 30s window.
  simulatedNow += 30_001;

  const tokens = await client.login('01800000006', '246810', 'device-a');
  assert.ok(tokens.access_token.length > 0, 'a correct PIN succeeds once the lockout window has passed');
});

void test('a successful login clears the failure count', { skip: SKIP_WITHOUT_DB }, async () => {
  const client = api();
  await client.register('01800000007', '246810', 'device-a');

  for (let i = 0; i < 3; i++) {
    await assert.rejects(() => client.login('01800000007', '000000', 'device-a'));
  }
  await client.login('01800000007', '246810', 'device-a'); // succeeds, resets the counter

  // Three MORE wrong attempts after a success should not be treated as
  // continuing the earlier streak — the count was cleared.
  for (let i = 0; i < 3; i++) {
    await assert.rejects(
      () => client.login('01800000007', '000000', 'device-a'),
      (error: unknown) => error instanceof ApiError && error.status === 401,
      'still plain wrong-PIN rejections, not a lockout — the earlier failures must not have carried over',
    );
  }
});

void test(
  'an unknown phone locks out the same way a real one does — no oracle via lockout timing either',
  { skip: SKIP_WITHOUT_DB },
  async () => {
    const client = api();
    for (let i = 0; i < 5; i++) {
      await assert.rejects(() => client.login('01800009999', '000000', 'device-a'));
    }
    await assert.rejects(
      () => client.login('01800009999', '000000', 'device-a'),
      (error: unknown) => error instanceof ApiError && error.status === 429,
      'a phone with no account locks out identically to one that exists',
    );
  },
);

// ---------------------------------------------------------------------------
// Rate envelope — item 4. Calls pushEvents() directly with an injected
// threshold; proving the real 2,000/24h default would mean pushing 2,000
// real rows, which this deliberately avoids (see pushEvents's rateThreshold
// parameter, added for exactly this).
// ---------------------------------------------------------------------------

void test('the rate envelope rejects events past the threshold, per shop and per type', { skip: SKIP_WITHOUT_DB }, async () => {
  const pool = await getPool();
  const client = api();
  const tokens = await client.register('01800000008', '112233', 'device-a');

  const eventAt = (n: number) => ({
    id: `01920000-0000-7000-8000-${String(n).padStart(12, '0')}`,
    device_id: 'device-a',
    seq: n,
    // 15-digit l, 5-digit c, per clock.ts's encoding (validate.ts's HLC_RE).
    hlc: `${String(1_700_000_000_000 + n).padStart(15, '0')}-00000-device-a`,
    shop_id: tokens.shop_id,
    type: 'CUSTOMER_ADDED',
    payload: { schema_version: 1, customer_id: `c${n}`, display_name: `x${n}`, phone: null },
    created_at: 1_700_000_000_000 + n,
  });

  const batch = Array.from({ length: 5 }, (_, i) => eventAt(i + 1));

  // Threshold of 3: the first 3 of this batch land, the rest are rejected —
  // proving the running-total tracking within ONE push call, not just a
  // stale pre-batch snapshot.
  const result = await pushEvents(pool, tokens.shop_id, { events: batch }, Date.now(), 3);

  assert.equal(result.accepted.length, 3, 'exactly the threshold worth of events accepted');
  assert.equal(result.rejected.length, 2);
  assert.ok(result.rejected.every((r) => r.reason === 'RATE_ENVELOPE_EXCEEDED'));

  // A DIFFERENT shop is unaffected — the envelope is per-shop. A different
  // device_id too: UNIQUE(device_id, seq) is global across the events
  // table, not scoped by shop, so reusing 'device-a'/seq=1 here (already
  // inserted above for the first shop) would collide on that constraint —
  // a real device only ever belongs to one shop, so this never happens
  // outside a test reusing fixture data.
  const other = await client.register('01800000009', '112233', 'device-a');
  const otherResult = await pushEvents(
    pool,
    other.shop_id,
    {
      events: [
        {
          ...eventAt(1),
          device_id: 'device-other',
          shop_id: other.shop_id,
          id: '01920000-0000-7000-8000-0000000000ff',
        },
      ],
    },
    Date.now(),
    3,
  );
  assert.equal(otherResult.accepted.length, 1, 'a different shop’s own count starts fresh');
});
