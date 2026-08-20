// EmptyState.tsx — a centred headline + hint pair, for a screen's "nothing
// here" state.
//
// FIXED — found during a whole-project audit: AgingScreen, AlertsScreen,
// DailySummaryScreen, and ProductListScreen each carried a byte-identical
// copy of this block/headline/hint style trio, only the two strings
// differing. Data-free, like every other ui/ primitive: plain text props,
// no viewmodel import.

import { StyleSheet, Text, View } from 'react-native';
import { colors } from './colors';
import { fontFamily, fontSize } from './typography';

export interface EmptyStateProps {
  headline: string;
  hint: string;
}

export function EmptyState({ headline, hint }: EmptyStateProps) {
  return (
    <View style={styles.block}>
      <Text style={styles.headline}>{headline}</Text>
      <Text style={styles.hint}>{hint}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { flex: 1, justifyContent: 'center' },
  headline: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.lg,
    color: colors.textPrimary,
    lineHeight: fontSize.lg * 1.5,
    textAlign: 'left',
  },
  hint: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.md,
    color: colors.textMuted,
    lineHeight: fontSize.md * 1.6,
    textAlign: 'left',
  },
});
