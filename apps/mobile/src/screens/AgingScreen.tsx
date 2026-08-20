// AgingScreen.tsx — requirement 7, within-shop. docs/BUILD_PLAN.md Phase 4:
// "the shopkeeper answers 'how much am I owed, by whom, and how long?' in one
// screen without scrolling." This is the highest-value screen after credit
// entry.
//
// ===========================================================================
// THE DESIGN, AND WHY IT IS NOT A SORTED LIST
// ===========================================================================
// The obvious build is: every customer with a balance, sorted by days idle.
// That fails the actual requirement. A shop with sixty debtors scrolls, no
// matter how the rows are styled, and "without scrolling" is the exit
// criterion, not a nicety — a screen you have to scroll does not answer a
// question at a glance while a customer waits.
//
// So the screen is three things, in descending size:
//
//   1. ONE NUMBER — the total owed, the largest element on screen. That alone
//      answers "how much am I owed", which is the question most often asked.
//   2. THE PEOPLE WORTH A LOOK — at most ATTENTION_ROW_CAP rows, each with a
//      name, an amount, and a fact. Answers "by whom" and "how long".
//   3. A COUNTED REMAINDER — "the other 19", collapsed behind a tap. They are
//      not hidden, they are just not competing for attention with the rows
//      that need it.
//
// The outer container is a View, NOT a ScrollView, on purpose: the primary
// view cannot scroll because there is structurally nothing to scroll. Only the
// expanded "everyone" list scrolls, and that is a deliberate second mode.
//
// ===========================================================================
// FACTS, NOT SCORES — the constraint this screen exists under
// ===========================================================================
// AGENTS.md §4.8, SECURITY.md §7, UI_SPEC.md "Uncertainty and risk": never
// render a risk score where a customer can see it. Use ৪৫ দিন, never উচ্চ ঝুঁকি.
//
// This is the screen most at risk of breaking that, because it is literally
// held up at a counter with the customer opposite. So, concretely, in this
// file:
//   - there is no red, no amber, and no severity colour anywhere
//   - there is no badge, chip, pill, or icon attached to a person
//   - the only per-row text besides name and amount is `attentionFact`, which
//     the domain produced and i18n rendered as a statement of what happened
//   - the section is headed "দেখা দরকার" (worth a look) — the shopkeeper's
//     attention, not a verdict on the customer
// v1 shipped a colour-coded CustomerRiskBadge on the customer list. Nothing
// here may grow into one.
//
// The screen does NO arithmetic and NO ordering: `AgingVM.attentionRows`
// arrives already ordered and already formatted (see viewmodels/screens.ts).
//
// FLAG_SECURE (SECURITY.md §2: "FLAG_SECURE on screens showing balances, the
// customer list, and customer detail. Blocks screenshots and screen
// recording, and blanks the app in the recents switcher.") — MISSING until
// this audit. This screen is, verbatim, "the customer list" with every
// customer's balance on it, and `security/screenSecure.ts`'s
// `useScreenSecure()` hook already existed for exactly this, built in Step
// 11 and left unwired because no screen existed yet to wire it into ("Step
// 8's job" — this screen is that job). Found and fixed during a
// whole-project audit: without it, this is the one screen most likely to
// end up in a phone's recents-switcher thumbnail or a screenshot, showing
// every customer's name and what they owe.

import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '../ui/Button';
import { Card, Divider, SyncDot } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import { useScreenSecure } from '../security/screenSecure';
import { fontFamily, fontSize, minTouchTarget, spacing } from '../ui/typography';
import { colors } from '../ui/colors';
import { t, type Locale } from '../i18n';
import type { AgingRowVM, AgingVM } from '../viewmodels/screens';

export interface AgingScreenProps {
  vm: AgingVM;
  locale: Locale;
  onSelectCustomer?: (id: string) => void;
}

export function AgingScreen({ vm, locale, onSelectCustomer }: AgingScreenProps) {
  useScreenSecure();
  const [showEveryone, setShowEveryone] = useState(false);

  if (vm.isEmpty) {
    return (
      <View style={styles.screen}>
        <Text style={styles.title}>{t(locale, 'customers', 'agingTitle')}</Text>
        <EmptyState
          headline={t(locale, 'customers', 'nothingOwed')}
          hint={t(locale, 'customers', 'nothingOwedHint')}
        />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>{t(locale, 'customers', 'agingTitle')}</Text>

      {/* 1. HOW MUCH — the largest element on screen (UI_SPEC.md physical
          constraints: "The amount is the most important thing on screen").
          Rendered as Text, not <Amount>, because AgingVM.totalOwedDisplay is
          already a formatted string: B does no money arithmetic and no
          re-formatting. */}
      <View style={styles.totalBlock}>
        <Text style={styles.totalLabel}>{t(locale, 'customers', 'totalOwed')}</Text>
        <Text style={styles.totalAmount} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>
          {vm.totalOwedDisplay}
        </Text>
        <Text style={styles.totalSub}>
          {vm.owedByCountDisplay} {t(locale, 'customers', 'fromCustomers')}
        </Text>
      </View>

      {/* 2. BY WHOM, AND HOW LONG */}
      {vm.attentionRows.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>
            {t(locale, 'customers', 'needsLooking')}  {vm.attentionCountDisplay}
          </Text>
          <Card>
            {vm.attentionRows.map((row, index) => (
              <View key={row.id}>
                {index > 0 ? <Divider /> : null}
                <AgingRow row={row} onPress={onSelectCustomer} />
              </View>
            ))}
          </Card>
          {vm.hiddenAttentionCount > 0 ? (
            <Text style={styles.moreNote}>+{vm.hiddenAttentionCountDisplay}</Text>
          ) : null}
          {/* Shown once under the list, not repeated per row — a negative
              balance is usually one payment recorded on two offline devices
              (EVENTS.md §8), and saying so once is enough. */}
          {vm.hasNegativeBalance ? (
            <Text style={styles.footnote}>{t(locale, 'customers', 'balanceNegativeHint')}</Text>
          ) : null}
        </View>
      ) : null}

      {/* 3. THE REMAINDER — counted, not listed, until asked for. */}
      <View style={styles.spacer} />

      {showEveryone ? (
        <ScrollView style={styles.everyoneList} contentContainerStyle={styles.everyoneContent}>
          <Card>
            {vm.otherRows.map((row, index) => (
              <View key={row.id}>
                {index > 0 ? <Divider /> : null}
                <AgingRow row={row} onPress={onSelectCustomer} />
              </View>
            ))}
          </Card>
        </ScrollView>
      ) : (
        <Text style={styles.restNote}>
          {vm.otherCountDisplay} · {t(locale, 'customers', 'everyoneElseFine')}
        </Text>
      )}

      {/* Bottom, thumb-reachable (UI_SPEC.md: "All primary actions in the
          lower half of the screen. Top is read-only."). */}
      {vm.otherRows.length > 0 ? (
        <Button
          label={
            showEveryone
              ? t(locale, 'customers', 'seeFewer')
              : t(locale, 'customers', 'seeEveryone')
          }
          variant="secondary"
          onPress={() => setShowEveryone((v) => !v)}
          style={styles.action}
        />
      ) : null}
    </View>
  );
}

/**
 * One person. Name and amount on the baseline, the fact underneath.
 *
 * The amount is bold and right-aligned so a column of them reads as a column;
 * the fact is regular weight and muted so it reads as a caption, not a verdict.
 * That is the entire visual hierarchy — no colour carries meaning here.
 */
function AgingRow({ row, onPress }: { row: AgingRowVM; onPress?: (id: string) => void }) {
  const body = (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <View style={styles.rowTopLine}>
          <Text style={styles.rowName} numberOfLines={1}>
            {row.displayName}
          </Text>
          <SyncDot pending={row.syncPending} />
        </View>
        {row.attentionFact !== null ? (
          <Text style={styles.rowFact} numberOfLines={1}>
            {row.attentionFact}
          </Text>
        ) : row.daysSinceActivityDisplay !== '' ? (
          <Text style={styles.rowFact} numberOfLines={1}>
            {row.daysSinceActivityDisplay}
          </Text>
        ) : null}
      </View>
      <Text style={styles.rowAmount} numberOfLines={1}>
        {row.balanceDisplay}
      </Text>
    </View>
  );

  if (onPress === undefined) return body;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => onPress(row.id)}
      style={({ pressed }) => (pressed ? styles.pressed : null)}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.screenBackground,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  title: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.md,
    color: colors.textMuted,
    textAlign: 'left',
    // Bengali needs more vertical room than Latin — ascenders, descenders,
    // the matra and conjuncts (UI_SPEC.md "Bengali interface rules").
    lineHeight: fontSize.md * 1.6,
  },
  totalBlock: {
    paddingVertical: spacing.sm,
  },
  totalLabel: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.textMuted,
    lineHeight: fontSize.sm * 1.6,
    textAlign: 'left',
  },
  totalAmount: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.amount,
    color: colors.textPrimary,
    includeFontPadding: false,
    textAlign: 'left',
  },
  totalSub: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.textMuted,
    lineHeight: fontSize.sm * 1.6,
    textAlign: 'left',
  },
  section: {
    marginTop: spacing.md,
  },
  sectionHeader: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.sm,
    color: colors.textMuted,
    lineHeight: fontSize.sm * 1.7,
    marginBottom: spacing.xs,
    textAlign: 'left',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.md,
  },
  rowText: {
    flex: 1,
  },
  rowTopLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  rowName: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.md,
    color: colors.textPrimary,
    lineHeight: fontSize.md * 1.5,
    textAlign: 'left',
    flexShrink: 1,
  },
  rowFact: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    // Muted, never coloured by severity. This is the line most at risk of
    // becoming a risk badge; it stays one neutral grey forever.
    color: colors.textMuted,
    lineHeight: fontSize.sm * 1.6,
    textAlign: 'left',
  },
  rowAmount: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.lg,
    color: colors.textPrimary,
    includeFontPadding: false,
    textAlign: 'right',
  },
  moreNote: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.textMuted,
    paddingTop: spacing.xs,
    paddingHorizontal: spacing.md,
    textAlign: 'left',
  },
  footnote: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.textMuted,
    lineHeight: fontSize.sm * 1.6,
    paddingTop: spacing.xs,
    paddingHorizontal: spacing.md,
    textAlign: 'left',
  },
  spacer: {
    flex: 1,
    minHeight: spacing.sm,
  },
  restNote: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.textMuted,
    lineHeight: fontSize.sm * 1.6,
    paddingBottom: spacing.sm,
    textAlign: 'left',
  },
  everyoneList: {
    maxHeight: 320,
  },
  everyoneContent: {
    paddingBottom: spacing.sm,
  },
  action: {
    marginTop: spacing.xs,
  },
  pressed: {
    opacity: 0.6,
  },
});
