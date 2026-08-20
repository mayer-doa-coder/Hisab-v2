// PinScreen.tsx — the minimal PIN entry screen. INTENTIONALLY ROUGH.
//
// OWNERSHIP: this lives in src/security/ (A's, per .github/CODEOWNERS) rather
// than src/screens/ (B's, and currently empty because Step 8 has not run). It
// is a self-contained component built from B's existing ui/ primitives, for B
// to mount in navigation when the app shell exists. Flagged in Step 10's
// report — A creating the first file in B's directory is exactly the case
// CLAUDE.md says to stop and say so about.
//
// WHAT THIS DOES
//   * Reuses B's <Keypad/> — no system keyboard, 48dp targets already met
//   * Masked entry (dots), never a digit echo: the customer is eighteen
//     inches away, the same reasoning behind SECURITY.md §2's FLAG_SECURE
//   * Configurable PIN length, default 6 (see pinSession.ts on why)
//   * Local attempt counter and cooldown — the local half of SECURITY.md §4
//   * A bare two-step set flow (choose / re-enter), because a PIN that was
//     never set cannot be entered and the screen would be unreachable
//
// WHAT THIS DELIBERATELY DOES NOT DO
//   * No signup, phone entry, OTP, or onboarding. UI_SPEC.md Onboarding:
//     "Nothing before first value" — account creation comes AFTER a baki has
//     been recorded, and Step 8 has not built that screen yet. A signup gate
//     in front of an app with nothing behind it is v1's exact failure.
//   * No tutorial, no carousel, no explainer. Same section.
//   * No PIN change / re-key, no auto-lock timer, no FLAG_SECURE, no
//     biometrics, no SQLCipher — all Step 11. THIS SCREEN IS SCREENSHOTTABLE
//     as it stands; that is a known gap, not an oversight.
//   * No "forgot PIN" recovery. Once Step 11 derives the database key from
//     the PIN, a forgotten PIN is unrecoverable loss of a shop's ledger. That
//     needs an answer before the pilot. It does not need one this step.
//   * No microphone affordance, ever. AGENTS.md §4.6.

import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Keypad, type KeypadKey } from '../ui/Keypad';
import { fontFamily, fontSize, spacing } from '../ui/typography';
import { colors } from '../ui/colors';
import { DEFAULT_PIN_LENGTH, type PinResult, type PinSession } from './pinSession';

type Mode = 'ENTER' | 'SET' | 'CONFIRM';

export interface PinScreenStrings {
  readonly pinPrompt: string;
  readonly pinSetPrompt: string;
  readonly pinConfirmPrompt: string;
  readonly pinMismatch: string;
  readonly pinIncorrect: string;
  readonly pinLocked: string;
}

export interface PinScreenProps {
  readonly session: PinSession;
  /** Strings come from B's i18n via the caller — this component never calls t() itself. */
  readonly strings: PinScreenStrings;
  readonly onUnlocked: () => void;
  /** 'SET' runs the two-step choose/confirm flow for a device with no PIN yet. */
  readonly initialMode?: 'ENTER' | 'SET';
  readonly pinLength?: number;
}

export function PinScreen({
  session,
  strings,
  onUnlocked,
  initialMode = 'ENTER',
  pinLength = DEFAULT_PIN_LENGTH,
}: PinScreenProps) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [digits, setDigits] = useState('');
  const [firstEntry, setFirstEntry] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const promptFor = (m: Mode): string =>
    m === 'ENTER' ? strings.pinPrompt : m === 'SET' ? strings.pinSetPrompt : strings.pinConfirmPrompt;

  const applyResult = useCallback(
    (result: PinResult) => {
      switch (result.kind) {
        case 'OK':
          onUnlocked();
          return;
        case 'INCORRECT':
          setMessage(strings.pinIncorrect);
          return;
        case 'LOCKED_OUT':
          setMessage(strings.pinLocked);
          return;
        case 'UNAVAILABLE':
          // Not "wrong PIN" — the shopkeeper typed nothing wrong. Until
          // Step 11 makes unlock offline-capable, this is what bad signal
          // looks like here (see pinSession.ts's header).
          setMessage(strings.pinLocked);
          return;
      }
    },
    [onUnlocked, strings],
  );

  const complete = useCallback(
    async (pin: string) => {
      setBusy(true);
      try {
        if (mode === 'SET') {
          setFirstEntry(pin);
          setMode('CONFIRM');
          setMessage(null);
          return;
        }
        if (mode === 'CONFIRM') {
          if (pin !== firstEntry) {
            setMode('SET');
            setFirstEntry('');
            setMessage(strings.pinMismatch);
            return;
          }
          applyResult(await session.setPin(pin));
          return;
        }
        applyResult(await session.submit(pin));
      } finally {
        setDigits('');
        setBusy(false);
      }
    },
    [applyResult, firstEntry, mode, session, strings.pinMismatch],
  );

  const onKeyPress = useCallback(
    (key: KeypadKey) => {
      if (busy) return;

      if (key === 'backspace') {
        setDigits((current) => current.slice(0, -1));
        setMessage(null);
        return;
      }
      // No confirm key: the PIN submits on its last digit. One less tap on a
      // fixed-length secret, and the keypad's ✓ would be dead weight.
      if (key === 'confirm') return;
      if (digits.length >= pinLength) return;

      // FIXED — found during a whole-project audit: `complete(next)` used to
      // be called from inside the `setDigits` updater function above. A React
      // state updater must be pure — React's documented contract allows it to
      // invoke the function more than once for one state change (this is
      // exactly what StrictMode's deliberate double-invocation checks for in
      // development, and is not guaranteed to stay a non-issue in production
      // across React versions) — so a real network mutation (`session.submit`
      // / `session.setPin`, on the PIN-entry path specifically) living inside
      // it risked firing twice per keystroke: a duplicate login attempt that
      // could burn two lockout strikes for one real one, or a duplicate
      // registration call. Computing `next` from the closed-over `digits`
      // and calling `complete` as an ordinary side effect after `setDigits`
      // makes it fire exactly once per digit, matching every other
      // side-effecting call in this file.
      const next = digits + key;
      setDigits(next);
      setMessage(null);
      if (next.length === pinLength) void complete(next);
    },
    [busy, complete, digits, pinLength],
  );

  return (
    <View style={styles.container}>
      <View style={styles.top}>
        <Text style={styles.prompt}>{promptFor(mode)}</Text>

        {/* Masked. The digit itself is never rendered — a customer standing at
            the counter can see this screen. */}
        <View style={styles.dots} accessibilityLabel={`${digits.length} of ${pinLength}`}>
          {Array.from({ length: pinLength }, (_, i) => (
            <View key={i} style={[styles.dot, i < digits.length && styles.dotFilled]} />
          ))}
        </View>

        {/* Facts, not scolding (AGENTS.md §4.8). No attempt counter is shown —
            "3 tries left" is pressure at a counter, and the cooldown already
            communicates the limit when it matters. */}
        <Text style={styles.message}>{message ?? ''}</Text>
      </View>

      <View style={styles.keypad}>
        <Keypad onKeyPress={onKeyPress} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'space-between',
    padding: spacing.md,
    backgroundColor: colors.white,
  },
  // UI_SPEC.md: "All primary actions in the lower half of the screen. Top is
  // read-only." The keypad is at the bottom; the prompt and dots are the
  // read-only top.
  top: {
    alignItems: 'center',
    paddingTop: spacing.lg * 2,
  },
  prompt: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.lg,
    color: colors.textPrimary,
    // Bengali needs more vertical room than Latin (AGENTS.md §6).
    lineHeight: fontSize.lg * 1.6,
  },
  dots: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.accent,
  },
  dotFilled: {
    backgroundColor: colors.accent,
  },
  message: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.md,
    lineHeight: fontSize.md * 1.6,
    color: colors.error,
    marginTop: spacing.md,
    minHeight: fontSize.md * 1.6, // reserved, so the keypad never shifts under the thumb
  },
  keypad: {
    paddingBottom: spacing.lg,
  },
});
