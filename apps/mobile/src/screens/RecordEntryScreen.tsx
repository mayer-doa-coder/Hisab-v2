// RecordEntryScreen.tsx — UI_SPEC.md screens 4 and 5, one component for
// both ("Record payment... Same flow, pre-filled with the full balance,
// editable"). Full-screen keypad, quick chips, no spinner, no confirm
// dialog, no system keyboard for the amount.
//
// ===========================================================================
// THE COMPOSING AMOUNT: WHY IT IS STRING-MANIPULATED, NOT DIVIDED
// ===========================================================================
// DECISIONS.md 2026-08-08 carves out that while an amount is being typed, the
// UI may add/subtract integer poisha in component state, but "may not divide
// it, may not use a float, and may not format it" — that stays money.ts's
// job once the amount is ledgered. The composing amount here is held as an
// integer poisha value the whole time (never a float, never taka), and:
//   - a digit press / backspace manipulates it via STRING append/slice, then
//     Number() to parse back — parsing, not dividing;
//   - a quick chip (৫০/১০০/২০০/৫০০/১০০০) adds a literal poisha constant via
//     plain `+` — exactly the case the carve-out names ("tap to add, tap
//     again to add again");
//   - display goes through formatDigits.ts's `formatComposingPoisha`, which
//     slices the integer's string form into whole/fraction parts (the last
//     two digits ARE the poisha) — no `/100` anywhere. Lives in
//     formatDigits.ts rather than here so it's a plain, unit-tested string
//     function like its siblings, not logic buried in a `.tsx` screen this
//     project's test suite can't import. The visual result matches
//     Amount.tsx without needing its `valueTaka` (already-ledgered-money)
//     contract.
// The moment Confirm is pressed, the integer poisha value is handed to the
// caller unchanged — it becomes ledgered money there, not here.

import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Keypad, type KeypadKey } from '../ui/Keypad';
import { formatComposingPoisha, toNumeralScript, type NumeralScript } from '../ui/formatDigits';
import { fontFamily, fontSize, spacing } from '../ui/typography';
import { colors } from '../ui/colors';
import { t, type Locale } from '../i18n';
import type { Poisha } from '@hisab/domain';

const QUICK_CHIPS_TAKA = [50, 100, 200, 500, 1000] as const;
/** Nine digits of poisha is comfortably above any real credit amount (~৳9,99,999.99). */
const MAX_POISHA_DIGITS = 9;

export interface RecordEntryScreenProps {
  entryKind: 'CREDIT' | 'PAYMENT';
  customerName: string;
  /** ৳0 for a fresh credit entry; the customer's current balance for a payment, editable from there. */
  initialAmountPoisha: Poisha;
  locale: Locale;
  numeralScript: NumeralScript;
  onConfirm: (amountPoisha: Poisha) => void;
  onCancel: () => void;
  /**
   * A write failure already turned into a string by the caller. FIXED —
   * found during a whole-project audit: CoreFlow.tsx used to swallow
   * `recordEntry`'s VALIDATION_ERROR entirely — pressing Confirm on a
   * failure did nothing visible at all, which reads as a frozen app rather
   * than an error.
   */
  errorMessage?: string | null;
}

export function RecordEntryScreen({
  entryKind,
  customerName,
  initialAmountPoisha,
  locale,
  numeralScript,
  onConfirm,
  onCancel,
  errorMessage = null,
}: RecordEntryScreenProps) {
  const [amountPoisha, setAmountPoisha] = useState<number>(initialAmountPoisha);

  const onKeyPress = (key: KeypadKey): void => {
    if (key === 'confirm') {
      if (amountPoisha > 0) onConfirm(amountPoisha as Poisha);
      return;
    }
    if (key === 'backspace') {
      setAmountPoisha((prev) => {
        const next = String(prev).slice(0, -1);
        return next === '' ? 0 : Number(next);
      });
      return;
    }
    setAmountPoisha((prev) => {
      const nextDigits = String(prev) + key;
      if (nextDigits.length > MAX_POISHA_DIGITS) return prev;
      return Number(nextDigits);
    });
  };

  const addChip = (chipTaka: number): void => {
    setAmountPoisha((prev) => prev + chipTaka * 100);
  };

  return (
    <View style={styles.screen}>
      <View style={styles.top}>
        <Text style={styles.prompt} numberOfLines={1}>
          {customerName}
        </Text>
        <Text
          style={styles.amount}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.4}
        >
          {formatComposingPoisha(amountPoisha, numeralScript)}
        </Text>

        {errorMessage !== null ? <Text style={styles.error}>{errorMessage}</Text> : null}

        <View style={styles.chipRow}>
          {QUICK_CHIPS_TAKA.map((taka) => (
            <Text
              key={taka}
              accessibilityRole="button"
              onPress={() => addChip(taka)}
              style={styles.chip}
            >
              {toNumeralScript(String(taka), numeralScript)}
            </Text>
          ))}
        </View>

        <Text style={styles.cancel} accessibilityRole="button" onPress={onCancel}>
          {t(locale, 'common', 'cancel')}
        </Text>
      </View>

      <View style={styles.keypad}>
        <Keypad onKeyPress={onKeyPress} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: 'space-between',
    padding: spacing.md,
    backgroundColor: colors.white,
  },
  top: {
    alignItems: 'center',
    paddingTop: spacing.lg,
  },
  prompt: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.lg,
    color: colors.textMuted,
    lineHeight: fontSize.lg * 1.6,
  },
  amount: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.amount,
    color: colors.textPrimary,
    includeFontPadding: false,
    marginTop: spacing.sm,
  },
  error: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.sm,
    color: colors.error,
    marginTop: spacing.sm,
  },
  chipRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  chip: {
    minHeight: 48,
    minWidth: 48,
    paddingHorizontal: spacing.md,
    textAlignVertical: 'center',
    textAlign: 'center',
    fontFamily: fontFamily.bold,
    fontSize: fontSize.md,
    color: colors.accent,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 12,
    overflow: 'hidden',
  },
  cancel: {
    marginTop: spacing.md,
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.textMuted,
    padding: spacing.sm,
  },
  keypad: {
    paddingBottom: spacing.lg,
  },
});
