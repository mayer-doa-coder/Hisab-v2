// CustomerListScreen.tsx — UI_SPEC.md screen 2 ("Recent-first... Search
// across Bangla / Banglish / phone") and, in `mode="pick"`, the "Who?" step
// of the credit-entry flow (screen 4's picker: "last 8 customers, most
// recent first... + নতুন always visible at the bottom").
//
// Search here is a plain case-insensitive substring match on name and phone
// — NOT the Bangla/Banglish/phonetic matcher `src/search/` is specified for
// and still empty. Flagged as a simplification: this screen works today, the
// real matcher is a separate, larger piece of work for that directory.
//
// FLAG_SECURE (SECURITY.md §2 names this screen by name: "the customer
// list") — every row here is a name and a balance.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from '../ui/Button';
import { Row } from '../ui/Row';
import { SyncDot } from '../ui/Card';
import { useScreenSecure } from '../security/screenSecure';
import { fontFamily, fontSize, spacing } from '../ui/typography';
import { t, type Locale } from '../i18n';
import { listCustomerRows } from '../data/customerQueries';
import type { Database } from '../data/db';
import type { ViewModelFormatter } from '@hisab/domain';
import type { CustomerRowVM } from '../viewmodels/customer';

const PICK_MODE_ROW_CAP = 8;

export interface CustomerListScreenProps {
  db: Database;
  format: ViewModelFormatter;
  locale: Locale;
  mode: 'browse' | 'pick';
  refreshToken: number;
  onSelectCustomer: (customer: CustomerRowVM) => void;
  onAddCustomer: () => void;
  onBack: () => void;
}

function matches(row: CustomerRowVM, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  if (row.displayName.toLowerCase().includes(needle)) return true;
  return row.phone !== null && row.phone.toLowerCase().includes(needle);
}

export function CustomerListScreen({
  db,
  format,
  locale,
  mode,
  refreshToken,
  onSelectCustomer,
  onAddCustomer,
  onBack,
}: CustomerListScreenProps) {
  useScreenSecure();
  const [rows, setRows] = useState<CustomerRowVM[] | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    void listCustomerRows(db, Date.now(), format).then(setRows);
  }, [db, format, refreshToken]);

  const filtered = useMemo(() => {
    if (rows === null) return [];
    const matched = rows.filter((row) => matches(row, query));
    return mode === 'pick' && query.trim() === '' ? matched.slice(0, PICK_MODE_ROW_CAP) : matched;
  }, [rows, query, mode]);

  const renderItem = useCallback(
    ({ item }: { item: CustomerRowVM }) => (
      <Row
        title={item.displayName}
        subtitle={item.daysSinceActivityDisplay !== '' ? item.daysSinceActivityDisplay : undefined}
        trailing={
          <View style={styles.trailing}>
            <Text style={styles.balance}>{item.balanceDisplay}</Text>
            <SyncDot pending={item.syncPending} />
          </View>
        }
        onPress={() => onSelectCustomer(item)}
      />
    ),
    [onSelectCustomer],
  );

  return (
    <View style={styles.screen}>
      <Text accessibilityRole="button" onPress={onBack} style={styles.back}>
        {t(locale, 'common', 'back')}
      </Text>
      <TextInput
        style={styles.search}
        value={query}
        onChangeText={setQuery}
        placeholder={t(locale, 'customers', 'searchPlaceholder')}
        placeholderTextColor="#9AA8A1"
        autoFocus={mode === 'pick'}
        accessibilityLabel={t(locale, 'customers', 'searchPlaceholder')}
      />

      {rows === null ? (
        <View style={styles.screen} />
      ) : filtered.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>{t(locale, 'customers', 'searchNoResults')}</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          style={styles.list}
        />
      )}

      {/* "+ নতুন always visible at the bottom" — UI_SPEC.md screen 4. */}
      <View style={styles.actions}>
        <Button label={t(locale, 'customers', 'newCustomer')} variant="secondary" onPress={onAddCustomer} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F6F8F7' },
  back: {
    minHeight: 48,
    textAlignVertical: 'center',
    marginHorizontal: spacing.sm,
    marginTop: spacing.md,
    paddingHorizontal: spacing.sm,
    fontFamily: fontFamily.regular,
    fontSize: fontSize.md,
    color: '#5B6B62',
  },
  search: {
    minHeight: 48,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D8E1DD',
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    fontFamily: fontFamily.regular,
    fontSize: fontSize.md,
    color: '#14231C',
    textAlign: 'left',
  },
  list: { flex: 1, marginTop: spacing.sm },
  trailing: { alignItems: 'flex-end', gap: spacing.xs },
  balance: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.md,
    color: '#14231C',
    textAlign: 'right',
  },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.md,
    color: '#5B6B62',
  },
  actions: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
});
