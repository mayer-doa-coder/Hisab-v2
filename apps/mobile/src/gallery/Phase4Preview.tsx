// Phase4Preview.tsx — a DEV harness that wires the Phase 4 screens to the real
// pipeline (events → fold → viewmodel builder → ViewModelFormatter) using the
// synthetic log in demoLedger.ts.
//
// Sibling to Gallery.tsx and held to the same rule: dev-only, renders no
// persisted data, writes nothing. It exists so the screens can be looked at on
// a real device — Bengali shaping, line-height, touch targets and the
// "one screen without scrolling" claim are not things a unit test can check.
//
// The product form's draft is held here rather than inside ProductFormScreen,
// which is the lifting ProductFormScreen.tsx's header describes. In the real
// app this state belongs to the data layer so it can persist on every
// keystroke (UI_SPEC.md); here it is plain useState, and that difference is
// exactly why this file is a harness and not a screen.

import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AppShell } from '../navigation/AppShell';
import { AgingScreen } from '../screens/AgingScreen';
import { AlertsScreen } from '../screens/AlertsScreen';
import { DailySummaryScreen } from '../screens/DailySummaryScreen';
import { ProductListScreen } from '../screens/ProductListScreen';
import {
  EMPTY_PRODUCT_DRAFT,
  ProductFormScreen,
  type ProductDraft,
} from '../screens/ProductFormScreen';
import {
  buildAgingVM,
  buildAlertsVM,
  buildDailySummaryVM,
  buildProductListVM,
} from '../data/screenViewmodels';
import { createFormatter } from '../i18n/formatter';
import { t, type Locale } from '../i18n';
import { fontFamily, fontSize, spacing } from '../ui/typography';
import { colors } from '../ui/colors';
import type { NumeralScript } from '../ui/formatDigits';
import { DEMO_NOW, buildDemoState } from './demoLedger';

// Bangladesh is UTC+6 with no DST. The day window is stated here, at the call
// site, rather than hidden inside the summary builder — the same reason
// `daily_sales` is still unbuilt in the domain (DECISIONS.md 2026-08-20).
const BST_OFFSET_MS = 6 * 60 * 60 * 1000;

export function Phase4Preview() {
  const [locale, setLocale] = useState<Locale>('bn');
  const [numeralScript, setNumeralScript] = useState<NumeralScript>('arabic');
  const [draft, setDraft] = useState<ProductDraft>(EMPTY_PRODUCT_DRAFT);
  const [formOpen, setFormOpen] = useState(false);

  const { events, state } = useMemo(() => buildDemoState(), []);
  const format = useMemo(() => createFormatter(locale, numeralScript), [locale, numeralScript]);

  const aging = useMemo(
    () =>
      buildAgingVM(
        {
          customers: [...state.customers.values()],
          balances: state.balances,
          pendingCustomerIds: state.pendingCustomerIds,
        },
        DEMO_NOW,
        format,
      ),
    [state, format],
  );

  const alerts = useMemo(() => buildAlertsVM(state, events, DEMO_NOW, format), [state, events, format]);
  const products = useMemo(() => buildProductListVM(state, format), [state, format]);

  const summary = useMemo(() => {
    const localMidnight = Math.floor((DEMO_NOW + BST_OFFSET_MS) / 86_400_000) * 86_400_000 - BST_OFFSET_MS;
    return buildDailySummaryVM(
      state,
      events,
      {
        dayStart: localMidnight,
        dayEnd: localMidnight + 86_400_000,
        dateDisplay: new Date(DEMO_NOW).toISOString().slice(0, 10),
      },
      format,
    );
  }, [state, events, format]);

  return (
    <View style={styles.root}>
      <View style={styles.devBar}>
        <Toggle label="বাংলা" active={locale === 'bn'} onPress={() => setLocale('bn')} />
        <Toggle label="EN" active={locale === 'en'} onPress={() => setLocale('en')} />
        <Toggle
          label={t(locale, 'common', 'numeralScriptArabic')}
          active={numeralScript === 'arabic'}
          onPress={() => setNumeralScript('arabic')}
        />
        <Toggle
          label={t(locale, 'common', 'numeralScriptBengali')}
          active={numeralScript === 'bengali'}
          onPress={() => setNumeralScript('bengali')}
        />
      </View>

      <AppShell
        tabs={[
          {
            key: 'aging',
            label: t(locale, 'customers', 'agingTitle'),
            render: () => <AgingScreen vm={aging} locale={locale} />,
          },
          {
            key: 'products',
            label: t(locale, 'products', 'productsTitle'),
            render: () =>
              formOpen ? (
                <ProductFormScreen
                  draft={draft}
                  onChange={setDraft}
                  onSubmit={() => {
                    setDraft(EMPTY_PRODUCT_DRAFT);
                    setFormOpen(false);
                  }}
                  onCancel={() => setFormOpen(false)}
                  locale={locale}
                  format={format}
                />
              ) : (
                <ProductListScreen
                  rows={products}
                  locale={locale}
                  onAddProduct={() => setFormOpen(true)}
                  onSelectProduct={() => setFormOpen(true)}
                />
              ),
          },
          {
            key: 'alerts',
            label: t(locale, 'products', 'alertsTitle'),
            render: () => <AlertsScreen vm={alerts} locale={locale} />,
          },
          {
            key: 'summary',
            label: t(locale, 'summary', 'summaryTitle'),
            render: () => <DailySummaryScreen vm={summary} locale={locale} />,
          },
        ]}
      />
    </View>
  );
}

function Toggle({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.toggle}>
      <Text style={[styles.toggleLabel, active && styles.toggleLabelActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.screenBackground },
  devBar: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
    backgroundColor: '#ECF1EF',
  },
  toggle: { paddingVertical: spacing.xs, paddingHorizontal: spacing.sm },
  toggleLabel: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.textMuted },
  toggleLabelActive: { fontFamily: fontFamily.bold, color: colors.accent },
});
