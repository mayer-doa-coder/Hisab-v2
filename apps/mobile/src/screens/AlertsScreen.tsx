// AlertsScreen.tsx — low stock and expiry, both straight from A's domain
// logic. `productAttention()` decides what counts as low or out;
// `expiryRisks()` decides what can honestly be said about expiry. This screen
// decides nothing — it renders `AlertsVM`, which arrives ordered and
// formatted.
//
// TWO THINGS THIS SCREEN IS CAREFUL ABOUT
//
// 1. The expiry number is an UPPER BOUND, and the copy says so. `STOCK_SOLD`
//    carries no batch reference, so which batch is still on the shelf is
//    genuinely unknowable (EVENTS.md §4, DECISIONS.md 2026-08-20). The domain
//    reports min(on_hand, expired batch units); this screen renders it as
//    "সর্বোচ্চ N" — at most N. Rendering it as a flat count would send a
//    shopkeeper to bin stock that is probably fine, which is a worse failure
//    than saying nothing.
//
// 2. No severity colour. Out-of-stock is not red and low-stock is not amber.
//    UI_SPEC.md: "Never rely on subtle colour differences alone", and
//    AGENTS.md §4.8's facts-not-scores applies to goods as well as people —
//    the order of the list is the priority signal, and each row states what is
//    true.

import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Card, Divider } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import { fontFamily, fontSize, minTouchTarget, spacing } from '../ui/typography';
import { colors } from '../ui/colors';
import { t, type Locale } from '../i18n';
import type { AlertsVM } from '../viewmodels/screens';

export interface AlertsScreenProps {
  vm: AlertsVM;
  locale: Locale;
}

export function AlertsScreen({ vm, locale }: AlertsScreenProps) {
  if (vm.isAllClear) {
    return (
      <View style={styles.screen}>
        <Text style={styles.title}>{t(locale, 'products', 'alertsTitle')}</Text>
        <EmptyState
          headline={t(locale, 'products', 'alertsAllClear')}
          hint={t(locale, 'products', 'alertsAllClearHint')}
        />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>{t(locale, 'products', 'alertsTitle')}</Text>
      <ScrollView contentContainerStyle={styles.content}>
        {vm.stockAlerts.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionHeader}>{t(locale, 'products', 'stockSection')}</Text>
            <Card>
              {vm.stockAlerts.map((alert, index) => (
                <View key={alert.id}>
                  {index > 0 ? <Divider /> : null}
                  <View style={styles.row}>
                    <View style={styles.rowText}>
                      <Text style={styles.rowName} numberOfLines={1}>
                        {alert.name}
                      </Text>
                      <Text style={styles.rowFact} numberOfLines={1}>
                        {alert.fact}
                      </Text>
                    </View>
                    <Text style={styles.rowTrailing} numberOfLines={1}>
                      {alert.stockDisplay}
                    </Text>
                  </View>
                </View>
              ))}
            </Card>
          </View>
        ) : null}

        {vm.expiryAlerts.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionHeader}>{t(locale, 'products', 'expirySection')}</Text>
            <Card>
              {vm.expiryAlerts.map((alert, index) => (
                <View key={alert.id}>
                  {index > 0 ? <Divider /> : null}
                  <View style={styles.row}>
                    <View style={styles.rowText}>
                      <Text style={styles.rowName} numberOfLines={1}>
                        {alert.name}
                      </Text>
                      {/* "at most N" — never a flat count. See the header. */}
                      <Text style={styles.rowFact} numberOfLines={1}>
                        {t(locale, 'products', 'expiryAtMost')} {alert.atMostDisplay}
                      </Text>
                    </View>
                    <Text style={styles.rowTrailing} numberOfLines={1}>
                      {alert.expiredOn}
                    </Text>
                  </View>
                </View>
              ))}
            </Card>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.screenBackground,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
  },
  title: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.lg,
    color: colors.textPrimary,
    lineHeight: fontSize.lg * 1.5,
    textAlign: 'left',
  },
  content: {
    paddingBottom: spacing.lg,
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
  rowText: { flex: 1 },
  rowName: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.md,
    color: colors.textPrimary,
    lineHeight: fontSize.md * 1.5,
    textAlign: 'left',
  },
  rowFact: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    // One neutral grey. Never red for "out", never amber for "low".
    color: colors.textMuted,
    lineHeight: fontSize.sm * 1.6,
    textAlign: 'left',
  },
  rowTrailing: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.md,
    color: colors.textPrimary,
    textAlign: 'right',
  },
});
