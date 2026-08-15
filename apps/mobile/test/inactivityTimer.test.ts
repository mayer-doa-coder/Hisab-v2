// inactivityTimer.test.ts — SECURITY.md §2 auto-lock, Step 11 audit item 3.
// Fully deterministic: setTimeout/clearTimeout are injected fakes, not real
// timers, so this runs in milliseconds and never actually waits 5 minutes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_INACTIVITY_MS, InactivityTimer } from '../src/security/inactivityTimer.ts';

/** A minimal fake clock: setTimeout schedules, advance() fires everything due. */
function fakeTimers() {
  let nextId = 1;
  const scheduled = new Map<number, { fireAt: number; fn: () => void }>();
  let now = 0;

  const setTimeoutFake = ((fn: () => void, ms: number) => {
    const id = nextId++;
    scheduled.set(id, { fireAt: now + ms, fn });
    return id as unknown as ReturnType<typeof globalThis.setTimeout>;
  }) as typeof globalThis.setTimeout;

  const clearTimeoutFake = ((id: unknown) => {
    scheduled.delete(id as number);
  }) as typeof globalThis.clearTimeout;

  function advance(ms: number): void {
    now += ms;
    for (const [id, entry] of [...scheduled.entries()]) {
      if (entry.fireAt <= now) {
        scheduled.delete(id);
        entry.fn();
      }
    }
  }

  return { setTimeoutFake, clearTimeoutFake, advance, pendingCount: () => scheduled.size };
}

void test('default timeout is 5 minutes', () => {
  assert.equal(DEFAULT_INACTIVITY_MS, 5 * 60 * 1000);
});

void test('rejects a timeout below the floor — "not disableable"', () => {
  assert.throws(() => new InactivityTimer({ timeoutMs: 1000, onLock: () => {} }), /at least/);
  assert.throws(() => new InactivityTimer({ timeoutMs: 0, onLock: () => {} }), /at least/);
});

void test('locks after the configured idle window with no activity', () => {
  const timers = fakeTimers();
  let locked = 0;
  const timer = new InactivityTimer({
    timeoutMs: 60_000,
    onLock: () => locked++,
    setTimeout: timers.setTimeoutFake,
    clearTimeout: timers.clearTimeoutFake,
  });

  timer.start();
  timers.advance(59_999);
  assert.equal(locked, 0, 'must not lock a millisecond early');
  timers.advance(1);
  assert.equal(locked, 1);
  assert.equal(timer.isLocked(), true);
});

void test('recordActivity resets the countdown — no lock if activity keeps arriving', () => {
  const timers = fakeTimers();
  let locked = 0;
  const timer = new InactivityTimer({
    timeoutMs: 60_000,
    onLock: () => locked++,
    setTimeout: timers.setTimeoutFake,
    clearTimeout: timers.clearTimeoutFake,
  });

  timer.start();
  for (let i = 0; i < 10; i++) {
    timers.advance(50_000); // always less than the 60s window
    timer.recordActivity();
  }
  assert.equal(locked, 0, 'continuous activity within the window must never lock');

  timers.advance(60_000); // now let it actually go idle
  assert.equal(locked, 1);
});

void test('pause() stops the countdown without firing onLock — backgrounding is not idling', () => {
  const timers = fakeTimers();
  let locked = 0;
  const timer = new InactivityTimer({
    timeoutMs: 60_000,
    onLock: () => locked++,
    setTimeout: timers.setTimeoutFake,
    clearTimeout: timers.clearTimeoutFake,
  });

  timer.start();
  timers.advance(30_000);
  timer.pause();
  assert.equal(timers.pendingCount(), 0, 'pause must actually clear the pending timer');

  timers.advance(1_000_000); // long past the window — must not fire, nothing is scheduled
  assert.equal(locked, 0);
});

void test('once locked, recordActivity does not extend or silently unlock', () => {
  const timers = fakeTimers();
  let locked = 0;
  const timer = new InactivityTimer({
    timeoutMs: 60_000,
    onLock: () => locked++,
    setTimeout: timers.setTimeoutFake,
    clearTimeout: timers.clearTimeoutFake,
  });

  timer.start();
  timers.advance(60_000);
  assert.equal(locked, 1);

  timer.recordActivity(); // e.g. a stray touch on the lock screen itself
  timers.advance(1_000_000);
  assert.equal(locked, 1, 'must not fire onLock a second time or reschedule while already locked');
  assert.equal(timer.isLocked(), true);
});

void test('start() after a lock clears the locked state and begins a fresh countdown', () => {
  const timers = fakeTimers();
  let locked = 0;
  const timer = new InactivityTimer({
    timeoutMs: 60_000,
    onLock: () => locked++,
    setTimeout: timers.setTimeoutFake,
    clearTimeout: timers.clearTimeoutFake,
  });

  timer.start();
  timers.advance(60_000);
  assert.equal(locked, 1);

  timer.start(); // the shopkeeper unlocked with their PIN; caller calls start() again
  assert.equal(timer.isLocked(), false);
  timers.advance(59_999);
  assert.equal(locked, 1, 'still not locked again yet');
  timers.advance(1);
  assert.equal(locked, 2);
});
