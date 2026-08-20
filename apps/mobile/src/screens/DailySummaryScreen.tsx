// DailySummaryScreen.tsx — what happened today, in numbers and plain words.
//
// UI_SPEC.md screen 1 bans a KPI grid, charts and a period selector on HOME.
// This is a separate screen, so it may state today's figures — but it inherits
// the spirit and there is deliberately no chart, no sparkline, no trend arrow,
// and no comparison against a target nobody set. Four numbers and a sentence.
//
// The net line uses a WORD, not a colour: "বাকি বেড়েছে" / "বাকি কমেছে". Painting
// a rising credit balance red would be a judgement rendered on a screen a
// customer can see, which is the same rule the aging view lives under
// (AGENTS.md §4.8, SECURITY.md §7). It is also just wrong — more baki on the
// books is not automatically bad, and the app does not get to decide that.

import { StyleSheet, Text, View } from 'react-native';
import { Card, Divider } from '../ui/Card';
import { fontFamily, fontSize, spacing } from '../ui/typography';
import { t, type Locale } from '../i18n';
import type { DailySummaryVM } from '../viewmodels/screens';

export interface DailySummaryScreenProps {
  vm: DailySummaryVM;
  locale: Locale;
}

export function DailySummaryScreen({ vm, locale }: DailySummaryScreenProps) {
  const netLabelKey =
    vm.netDirection === 'UP'
      ? 'netChangeUp'
      : vm.netDirection === 'DOWN'
        ? 'netChangeDown'
        : 'netChangeFlat';

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>{t(locale, 'summary', 'summaryTitle')}</Text>
      <Text style={styles.date}>{vm.dateDisplay}</Text>

      {vm.isEmpty ? (
        <View style={styles.emptyBlock}>
          <Text style={styles.emptyHeadline}>{t(locale, 'summary', 'nothingToday')}</Text>
          <Text style={styles.emptyHint}>{t(locale, 'summary', 'nothingTodayHint')}</Text>
        </View>
      ) : (
        <>
          {/* The headline pair: what went out on credit, what came back in. */}
          <Card style={styles.card}>
            <StatLine label={t(locale, 'summary', 'creditGiven')} value={vm.creditGivenDisplay} big />
            <Divider />
            <StatLine
              label={t(locale, 'summary', 'paymentsReceived')}
              value={vm.paymentsReceivedDisplay}
              big
            />
          </Card>

          <Card style={styles.card}>
            <StatLine label={t(locale, 'summary', netLabelKey)} value={vm.netChangeDisplay} />
            <Divider />
            <StatLine
              label={t(locale, 'summary', 'entriesCount')}
              value={vm.entryCountDisplay}
            />
            <Divider />
            <StatLine label={t(locale, 'summary', 'goodsSold')} value={vm.goodsSoldCountDisplay} />
          </Card>

          {/* Subtle, and only when true. UI_SPEC.md: "No offline banner" —
              offline is the normal state, so this states a fact once rather
              than warning permanently. */}
          {vm.hasUnsynced ? (
            <Text style={styles.footnote}>{t(locale, 'summary', 'unsyncedNote')}</Text>
          ) : null}
        </>
      )}
    </View>
  );
}

function StatLine({ label, value, big = false }: { label: string; value: string; big?: boolean }) {
  return (
    <View style={styles.statLine}>
      <Text style={styles.statLabel} numberOfLines={2}>
        {label}
      </Text>
      <Text style={big ? styles.statValueBig : styles.statValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F6F8F7',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
  },
  title: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.lg,
    color: '#14231C',
    lineHeight: fontSize.lg * 1.5,
    textAlign: 'left',
  },
  date: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: '#5B6B62',
    lineHeight: fontSize.sm * 1.6,
    textAlign: 'left',
  },
  card: {
    marginTop: spacing.md,
  },
  statLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.md,
  },
  statLabel: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.md,
    color: '#5B6B62',
    lineHeight: fontSize.md * 1.5,
    textAlign: 'left',
    flexShrink: 1,
  },
  statValue: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.lg,
    color: '#14231C',
    textAlign: 'right',
  },
  statValueBig: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.xl,
    color: '#14231C',
    includeFontPadding: false,
    textAlign: 'right',
  },
  footnote: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: '#5B6B62',
    lineHeight: fontSize.sm * 1.6,
    paddingTop: spacing.sm,
    textAlign: 'left',
  },
  emptyBlock: { flex: 1, justifyContent: 'center' },
  emptyHeadline: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.lg,
    color: '#14231C',
    lineHeight: fontSize.lg * 1.5,
    textAlign: 'left',
  },
  emptyHint: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.md,
    color: '#5B6B62',
    lineHeight: fontSize.md * 1.6,
    textAlign: 'left',
  },
});
