// CustomerDetailScreen.tsx — UI_SPEC.md screen 6. "Running balance, full
// history." No risk score anywhere — see AgingRowVM's header in
// viewmodels/screens.ts for why.
//
// FLAG_SECURE (SECURITY.md §2 names this screen by name: "customer detail").

import { useCallback, useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { Button } from '../ui/Button';
import { SyncDot } from '../ui/Card';
import { useScreenSecure } from '../security/screenSecure';
import { fontFamily, fontSize, spacing } from '../ui/typography';
import { t, type Locale } from '../i18n';
import { getCustomerRow } from '../data/customerQueries';
import { buildCustomerDetailVM } from '../data/screenViewmodels';
import type { Database } from '../data/db';
import type { EventStore } from '../data/eventStore';
import type { ViewModelFormatter } from '@hisab/domain';
import type { CustomerDetailVM, CustomerHistoryRowVM } from '../viewmodels/screens';

export interface CustomerDetailScreenProps {
  db: Database;
  store: EventStore;
  format: ViewModelFormatter;
  locale: Locale;
  customerId: string;
  refreshToken: number;
  onRecordCredit: () => void;
  onRecordPayment: () => void;
  onBack: () => void;
}

export function CustomerDetailScreen({
  db,
  store,
  format,
  locale,
  customerId,
  refreshToken,
  onRecordCredit,
  onRecordPayment,
  onBack,
}: CustomerDetailScreenProps) {
  useScreenSecure();
  const [vm, setVm] = useState<CustomerDetailVM | null>(null);

  useEffect(() => {
    let cancelled = false;
    const now = Date.now();
    void (async () => {
      const customerRow = await getCustomerRow(db, customerId, now, format);
      if (customerRow === null) {
        if (!cancelled) setVm(null);
        return;
      }
      const events = await store.eventsForCustomer(customerId);
      const detail = buildCustomerDetailVM(customerRow, events, now, format);
      if (!cancelled) setVm(detail);
    })();
    return () => {
      cancelled = true;
    };
  }, [db, store, customerId, format, refreshToken]);

  const renderHistoryRow = useCallback(
    ({ item }: { item: CustomerHistoryRowVM }) => <HistoryRow row={item} locale={locale} />,
    [locale],
  );

  if (vm === null) {
    return <View style={styles.screen} />;
  }

  return (
    <View style={styles.screen}>
      <Text accessibilityRole="button" onPress={onBack} style={styles.back}>
        {t(locale, 'common', 'back')}
      </Text>
      <View style={styles.header}>
        <View style={styles.headerTopLine}>
          <Text style={styles.name} numberOfLines={1}>
            {vm.displayName}
          </Text>
          <SyncDot pending={vm.syncPending} />
        </View>
        <Text style={styles.balanceLabel}>{t(locale, 'customers', 'customerBalance')}</Text>
        <Text style={styles.balance} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>
          {vm.balanceDisplay}
        </Text>
        {vm.daysSinceActivityDisplay !== '' ? (
          <Text style={styles.subLine}>{vm.daysSinceActivityDisplay}</Text>
        ) : null}
      </View>

      <View style={styles.actions}>
        <Button
          label={t(locale, 'customers', 'recordCredit')}
          onPress={onRecordCredit}
          style={styles.actionButton}
        />
        <Button
          label={t(locale, 'customers', 'recordPayment')}
          variant="secondary"
          onPress={onRecordPayment}
          style={styles.actionButton}
        />
      </View>

      <Text style={styles.historyTitle}>{t(locale, 'customers', 'historyTitle')}</Text>
      {vm.isHistoryEmpty ? (
        <Text style={styles.emptyHistory}>{t(locale, 'customers', 'noHistoryYet')}</Text>
      ) : (
        <FlatList data={vm.history} keyExtractor={(row) => row.id} renderItem={renderHistoryRow} style={styles.list} />
      )}
    </View>
  );
}

function HistoryRow({ row, locale }: { row: CustomerHistoryRowVM; locale: Locale }) {
  const kindLabel =
    row.kind === 'CREDIT' ? t(locale, 'customers', 'creditLabel') : t(locale, 'customers', 'paymentLabel');
  return (
    <View style={[styles.historyRow, row.voided && styles.historyRowVoided]}>
      <View style={styles.historyText}>
        <Text style={styles.historyKind}>{kindLabel}</Text>
        <Text style={styles.historyWhen}>
          {row.whenDisplay}
          {row.voided ? ` · ${t(locale, 'customers', 'voidedLabel')}` : ''}
        </Text>
      </View>
      <View style={styles.historyAmounts}>
        <Text style={[styles.historyAmount, row.voided && styles.strikethrough]}>{row.amountDisplay}</Text>
        {!row.voided ? <Text style={styles.historyBalanceAfter}>{row.balanceAfterDisplay}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F6F8F7',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  back: {
    minHeight: 48,
    textAlignVertical: 'center',
    marginHorizontal: -spacing.sm,
    fontFamily: fontFamily.regular,
    fontSize: fontSize.md,
    color: '#5B6B62',
  },
  header: { paddingBottom: spacing.sm },
  headerTopLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.lg,
    color: '#14231C',
    lineHeight: fontSize.lg * 1.5,
    textAlign: 'left',
  },
  balanceLabel: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: '#5B6B62',
    marginTop: spacing.sm,
  },
  balance: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.amount,
    color: '#14231C',
    includeFontPadding: false,
  },
  subLine: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: '#5B6B62',
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  actionButton: { flex: 1 },
  historyTitle: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.sm,
    color: '#5B6B62',
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
    textAlign: 'left',
  },
  emptyHistory: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.md,
    color: '#5B6B62',
  },
  list: { flex: 1 },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: '#E4EAE7',
  },
  historyRowVoided: { opacity: 0.6 },
  historyText: { flex: 1 },
  historyKind: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.md,
    color: '#14231C',
  },
  historyWhen: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: '#5B6B62',
  },
  historyAmounts: { alignItems: 'flex-end' },
  historyAmount: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.md,
    color: '#14231C',
  },
  strikethrough: { textDecorationLine: 'line-through' },
  historyBalanceAfter: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: '#5B6B62',
  },
});
