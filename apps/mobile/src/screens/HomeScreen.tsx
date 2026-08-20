// HomeScreen.tsx — UI_SPEC.md screen 1. "Total owed to me. One large button:
// বাকি লিখুন. Recent activity." No KPI grid, no charts, no period selector —
// one number, one button, a short list.

import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '../ui/Button';
import { Card, Divider } from '../ui/Card';
import { fontFamily, fontSize, spacing } from '../ui/typography';
import { t, type Locale } from '../i18n';
import { getHomeVM } from '../data/customerQueries';
import type { Database } from '../data/db';
import type { ViewModelFormatter } from '@hisab/domain';
import type { HomeVM, RecentActivityRowVM } from '../viewmodels/screens';

export interface HomeScreenProps {
  db: Database;
  format: ViewModelFormatter;
  locale: Locale;
  onRecordCredit: () => void;
  onViewCustomers: () => void;
  /** Bumped by the caller after a write, so Home refetches without polling. */
  refreshToken: number;
}

export function HomeScreen({
  db,
  format,
  locale,
  onRecordCredit,
  onViewCustomers,
  refreshToken,
}: HomeScreenProps) {
  const [vm, setVm] = useState<HomeVM | null>(null);

  const load = useCallback(() => {
    void getHomeVM(db, format).then(setVm);
  }, [db, format]);

  useEffect(() => {
    load();
  }, [load, refreshToken]);

  if (vm === null) {
    return <View style={styles.screen} />;
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.totalBlock}>
          <Text style={styles.totalLabel}>{t(locale, 'customers', 'totalOwed')}</Text>
          <Text style={styles.totalAmount} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>
            {vm.totalOwedDisplay}
          </Text>
          {!vm.isEmpty ? (
            <Text style={styles.totalSub}>
              {vm.owedByCountDisplay} {t(locale, 'customers', 'fromCustomers')}
            </Text>
          ) : null}
          <Text accessibilityRole="button" onPress={onViewCustomers} style={styles.viewCustomers}>
            {t(locale, 'customers', 'seeEveryone')}
          </Text>
        </View>

        {vm.recentActivity.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionHeader}>{t(locale, 'customers', 'recentActivityTitle')}</Text>
            <Card>
              {vm.recentActivity.map((row, index) => (
                <View key={row.id}>
                  {index > 0 ? <Divider /> : null}
                  <ActivityRow row={row} locale={locale} />
                </View>
              ))}
            </Card>
          </View>
        ) : null}
      </ScrollView>

      {/* Bottom, thumb-reachable — the one large button UI_SPEC.md names for this screen. */}
      <View style={styles.actions}>
        <Button label={t(locale, 'customers', 'recordCredit')} onPress={onRecordCredit} style={styles.action} />
      </View>
    </View>
  );
}

function ActivityRow({ row, locale }: { row: RecentActivityRowVM; locale: Locale }) {
  const kindLabel =
    row.kind === 'CREDIT' ? t(locale, 'customers', 'creditLabel') : t(locale, 'customers', 'paymentLabel');
  return (
    <View style={styles.activityRow}>
      <View style={styles.activityText}>
        <Text style={styles.activityName} numberOfLines={1}>
          {row.displayName}
        </Text>
        <Text style={styles.activityKind}>{kindLabel}</Text>
      </View>
      <Text style={styles.activityAmount}>{row.amountDisplay}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F6F8F7',
  },
  content: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  totalBlock: { paddingVertical: spacing.sm },
  totalLabel: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: '#5B6B62',
    lineHeight: fontSize.sm * 1.6,
    textAlign: 'left',
  },
  totalAmount: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.amount,
    color: '#14231C',
    includeFontPadding: false,
    textAlign: 'left',
  },
  totalSub: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: '#5B6B62',
    lineHeight: fontSize.sm * 1.6,
    textAlign: 'left',
  },
  viewCustomers: {
    marginTop: spacing.sm,
    fontFamily: fontFamily.bold,
    fontSize: fontSize.sm,
    color: '#1B6E4A',
  },
  section: { marginTop: spacing.lg },
  sectionHeader: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.sm,
    color: '#5B6B62',
    lineHeight: fontSize.sm * 1.7,
    marginBottom: spacing.xs,
    textAlign: 'left',
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.md,
  },
  activityText: { flex: 1 },
  activityName: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.md,
    color: '#14231C',
    textAlign: 'left',
  },
  activityKind: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: '#5B6B62',
    textAlign: 'left',
  },
  activityAmount: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.md,
    color: '#14231C',
    textAlign: 'right',
  },
  actions: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  action: {},
});
