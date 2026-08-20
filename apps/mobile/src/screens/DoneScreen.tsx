// DoneScreen.tsx — UI_SPEC.md screens 4/5's "[Done]" step: "Immediate. No
// spinner. The write already happened locally. Name, new total balance,
// UNDO for 10 seconds. One tap: show this to the customer."
//
// The "show this to the customer" view is UI_SPEC.md physical constraints:
// "A customer-facing view is required, not optional" — a full-screen modal
// with just the name and new balance in huge text, dismissed by a tap
// anywhere. No device-rotation handling; that is a real future refinement,
// not attempted here.

import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { fontFamily, fontSize, spacing } from '../ui/typography';
import { t, type Locale } from '../i18n';

const UNDO_WINDOW_SECONDS = 10;

export interface DoneScreenProps {
  entryKind: 'CREDIT' | 'PAYMENT';
  customerName: string;
  newBalanceDisplay: string;
  locale: Locale;
  onUndo: () => void;
  onContinue: () => void;
}

export function DoneScreen({
  entryKind,
  customerName,
  newBalanceDisplay,
  locale,
  onUndo,
  onContinue,
}: DoneScreenProps) {
  const [secondsLeft, setSecondsLeft] = useState(UNDO_WINDOW_SECONDS);
  const [showingCustomer, setShowingCustomer] = useState(false);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft]);

  const kindLabel =
    entryKind === 'CREDIT' ? t(locale, 'customers', 'creditLabel') : t(locale, 'customers', 'paymentLabel');

  return (
    <View style={styles.screen}>
      <View style={styles.top}>
        <Text style={styles.kind}>{kindLabel}</Text>
        <Text style={styles.name} numberOfLines={1}>
          {customerName}
        </Text>
        <Text style={styles.balanceLabel}>{t(locale, 'customers', 'newBalance')}</Text>
        <Text style={styles.balance} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>
          {newBalanceDisplay}
        </Text>
      </View>

      <View style={styles.actions}>
        <Text accessibilityRole="button" onPress={() => setShowingCustomer(true)} style={styles.showCustomer}>
          {t(locale, 'customers', 'showCustomer')}
        </Text>

        {secondsLeft > 0 ? (
          <Text accessibilityRole="button" onPress={onUndo} style={styles.undo}>
            {t(locale, 'customers', 'undo')} ({secondsLeft})
          </Text>
        ) : null}

        <Text accessibilityRole="button" onPress={onContinue} style={styles.continueLabel}>
          {t(locale, 'common', 'back')}
        </Text>
      </View>

      <Modal visible={showingCustomer} animationType="fade" onRequestClose={() => setShowingCustomer(false)}>
        <Pressable style={styles.customerModal} onPress={() => setShowingCustomer(false)}>
          <Text style={styles.customerName} numberOfLines={1}>
            {customerName}
          </Text>
          <Text
            style={styles.customerBalance}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.4}
          >
            {newBalanceDisplay}
          </Text>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: 'space-between',
    padding: spacing.md,
    backgroundColor: '#FFFFFF',
  },
  top: {
    alignItems: 'center',
    paddingTop: spacing.lg * 2,
  },
  kind: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.md,
    color: '#1B6E4A',
  },
  name: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.lg,
    color: '#14231C',
    lineHeight: fontSize.lg * 1.6,
    marginTop: spacing.xs,
  },
  balanceLabel: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: '#5B6B62',
    marginTop: spacing.lg,
  },
  balance: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.amount,
    color: '#14231C',
    includeFontPadding: false,
  },
  actions: {
    alignItems: 'center',
    gap: spacing.md,
    paddingBottom: spacing.lg,
  },
  showCustomer: {
    minHeight: 48,
    textAlignVertical: 'center',
    fontFamily: fontFamily.bold,
    fontSize: fontSize.md,
    color: '#FFFFFF',
    backgroundColor: '#1B6E4A',
    borderRadius: 12,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    overflow: 'hidden',
  },
  undo: {
    minHeight: 48,
    textAlignVertical: 'center',
    fontFamily: fontFamily.bold,
    fontSize: fontSize.md,
    color: '#8A3B2A',
    padding: spacing.sm,
  },
  continueLabel: {
    minHeight: 48,
    textAlignVertical: 'center',
    fontFamily: fontFamily.regular,
    fontSize: fontSize.md,
    color: '#5B6B62',
    padding: spacing.sm,
  },
  customerModal: {
    flex: 1,
    backgroundColor: '#14231C',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  customerName: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xl,
    color: '#FFFFFF',
  },
  customerBalance: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.amount * 1.4,
    color: '#FFFFFF',
    includeFontPadding: false,
    marginTop: spacing.md,
  },
});
