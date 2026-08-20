// Card.tsx — a plain surface container with a hairline separator option.
// Data-free: plain primitive props only, no viewmodel import.
//
// Deliberately has NO `tone` / `severity` / `variant: 'warning'` prop. Every
// screen that shows customer or stock data is a screen a customer can see over
// the counter, and a card that turns amber or red is a risk badge by another
// name (AGENTS.md §4.8, SECURITY.md §7, UI_SPEC.md: "Never render a risk score
// where a customer can see it"). v1's colour-coded CustomerRiskBadge is the
// thing this omission prevents. Hierarchy comes from size and weight
// (UI_SPEC.md: "Two font weights only... Size and colour carry the rest").

import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { spacing } from './typography';
import { colors } from './colors';

export interface CardProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function Card({ children, style }: CardProps) {
  return <View style={[styles.card, style]}>{children}</View>;
}

/** A hairline rule between rows. One colour, no state. */
export function Divider() {
  return <View style={styles.divider} />;
}

/**
 * The per-row sync dot UI_SPEC.md requires ("each row carries its own sync
 * dot"). Neutral grey when pending, invisible when synced — never red, because
 * offline is the normal state, not an error ("No offline banner").
 */
export function SyncDot({ pending }: { pending: boolean }) {
  if (!pending) return null;
  return <View style={styles.syncDot} accessibilityLabel="unsynced" />;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderRadius: 16,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  divider: {
    height: 1,
    backgroundColor: colors.divider,
    marginHorizontal: spacing.md,
  },
  syncDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.syncDot,
  },
});
