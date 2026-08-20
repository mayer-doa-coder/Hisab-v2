// ProductListScreen.tsx — the shop's goods. UI_SPEC.md's list rules carry over
// from the customer list: 48dp targets, left-aligned Bengali, generous
// line-height, and no risk badge.
//
// Stock is shown as a quantity and a fact, never as a coloured pill.
// `ProductRowVM.stockLevel` exists so the row can vary WEIGHT and ORDER, not
// hue — UI_SPEC.md: "Never rely on subtle colour differences alone."
//
// Uses FlatList rather than mapping inside a ScrollView: UI_SPEC.md's
// acceptance criteria require the customer list to scroll at 60fps with 500
// rows, and a shop's product list is the same order of magnitude. FlatList
// recycles; a mapped ScrollView mounts every row.

import { FlatList, StyleSheet, Text, View } from 'react-native';
import { Button } from '../ui/Button';
import { Row } from '../ui/Row';
import { SyncDot } from '../ui/Card';
import { fontFamily, fontSize, spacing } from '../ui/typography';
import { t, type Locale } from '../i18n';
import type { ProductRowVM } from '../viewmodels/product';

export interface ProductListScreenProps {
  rows: readonly ProductRowVM[];
  locale: Locale;
  onAddProduct: () => void;
  onSelectProduct: (id: string) => void;
}

export function ProductListScreen({
  rows,
  locale,
  onAddProduct,
  onSelectProduct,
}: ProductListScreenProps) {
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>{t(locale, 'products', 'productsTitle')}</Text>

      {rows.length === 0 ? (
        <View style={styles.emptyBlock}>
          <Text style={styles.emptyHeadline}>{t(locale, 'products', 'noProducts')}</Text>
          <Text style={styles.emptyHint}>{t(locale, 'products', 'noProductsHint')}</Text>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(row) => row.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <Row
              title={item.name}
              // The fact when there is one, the plain stock line otherwise.
              // Both are already-formatted strings from the domain side.
              subtitle={item.attentionReason ?? item.stockDisplay}
              trailing={
                <View style={styles.trailing}>
                  {item.priceDisplay !== null ? (
                    <Text style={styles.price}>{item.priceDisplay}</Text>
                  ) : null}
                  <SyncDot pending={item.syncPending} />
                </View>
              }
              onPress={() => onSelectProduct(item.id)}
            />
          )}
        />
      )}

      {/* Primary action, bottom, thumb-reachable (UI_SPEC.md physical
          constraints: "All primary actions in the lower half of the screen"). */}
      <Button
        label={t(locale, 'products', 'addProduct')}
        onPress={onAddProduct}
        style={styles.action}
      />
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
  title: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.lg,
    color: '#14231C',
    lineHeight: fontSize.lg * 1.5,
    textAlign: 'left',
    marginBottom: spacing.sm,
  },
  listContent: {
    paddingBottom: spacing.md,
  },
  trailing: {
    alignItems: 'flex-end',
    gap: spacing.xs,
  },
  price: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.md,
    color: '#14231C',
    textAlign: 'right',
  },
  action: {
    marginTop: spacing.sm,
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
