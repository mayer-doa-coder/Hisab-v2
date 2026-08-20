// ProductFormScreen.tsx — add and edit a product. One component for both:
// the only difference is the title and whether the fields start populated,
// and two nearly-identical forms drift.
//
// ===========================================================================
// ONE REQUIRED FIELD
// ===========================================================================
// Name is required. Unit has a default. Price and low-stock threshold are
// optional and say so.
//
// SECURITY.md §6 and CLAUDE.md both name "being helpful by adding extra
// fields" as this project's specific failure mode — v1 asked for name, phone,
// address, credit limit and due terms for someone standing at a counter. A
// product form is the same trap: supplier, barcode, category, tax rate, reorder
// quantity and cost price are all things a stock app "should" have and all
// things that make the form slower than the notebook it replaces. Everything
// here maps to a field the domain actually folds (`PRODUCT_ADDED` in
// EVENTS.md §4) and nothing else may be added without a matching event field.
//
// COMPONENT STATE IS LIFTED, DELIBERATELY
// The draft lives in the parent, not here. UI_SPEC.md requires draft state to
// persist to disk on EVERY field change so the app survives backgrounding
// mid-entry — that is a data-layer job, and a form holding its own useState
// would make it impossible. This component is controlled: `draft` in,
// `onChange` out.

import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from '../ui/Button';
import { fontFamily, fontSize, minTouchTarget, spacing } from '../ui/typography';
import { t, type Locale } from '../i18n';
import type { ProductUnit } from '@hisab/domain';

/**
 * The editable draft. Text fields are STRINGS, not numbers: a half-typed "1."
 * is not a number, and coercing on every keystroke fights the user. The parent
 * converts once, on submit, through the domain command — which is what
 * validates them (`addProduct` in inventoryCommands.ts).
 */
export interface ProductDraft {
  readonly name: string;
  readonly unit: ProductUnit;
  readonly priceText: string;
  readonly thresholdText: string;
}

export const EMPTY_PRODUCT_DRAFT: ProductDraft = {
  name: '',
  unit: 'PIECE',
  priceText: '',
  thresholdText: '',
};

const UNITS: readonly ProductUnit[] = ['PIECE', 'KG', 'GRAM', 'LITRE', 'ML', 'PACKET', 'DOZEN'];

const UNIT_KEYS = {
  PIECE: 'unitPiece',
  KG: 'unitKg',
  GRAM: 'unitGram',
  LITRE: 'unitLitre',
  ML: 'unitMl',
  PACKET: 'unitPacket',
  DOZEN: 'unitDozen',
} as const satisfies Record<ProductUnit, string>;

export interface ProductFormScreenProps {
  draft: ProductDraft;
  onChange: (draft: ProductDraft) => void;
  onSubmit: () => void;
  onCancel: () => void;
  locale: Locale;
  /** True when editing an existing product — changes the title only. */
  isEdit?: boolean;
  /** A DomainError already turned into a string by the caller. */
  errorMessage?: string | null;
}

export function ProductFormScreen({
  draft,
  onChange,
  onSubmit,
  onCancel,
  locale,
  isEdit = false,
  errorMessage = null,
}: ProductFormScreenProps) {
  const nameMissing = draft.name.trim() === '';

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>
          {isEdit ? t(locale, 'products', 'editProduct') : t(locale, 'products', 'addProduct')}
        </Text>

        {/* The one required field, first and largest. */}
        <Field label={t(locale, 'products', 'nameLabel')}>
          <TextInput
            style={styles.input}
            value={draft.name}
            onChangeText={(name) => onChange({ ...draft, name })}
            placeholder={t(locale, 'products', 'namePlaceholder')}
            placeholderTextColor="#9AA8A1"
            autoFocus
            accessibilityLabel={t(locale, 'products', 'nameLabel')}
          />
        </Field>

        {/* Chips, not a picker: a dropdown costs a tap to open, a scroll and a
            tap to choose. Seven options fit on screen. */}
        <Field label={t(locale, 'products', 'unitLabel')}>
          <View style={styles.chipRow}>
            {UNITS.map((unit) => {
              const selected = draft.unit === unit;
              return (
                <Pressable
                  key={unit}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => onChange({ ...draft, unit })}
                  style={[styles.chip, selected && styles.chipSelected]}
                >
                  <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>
                    {t(locale, 'products', UNIT_KEYS[unit])}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Field>

        <Field label={t(locale, 'products', 'priceLabel')} help={t(locale, 'products', 'priceOptional')}>
          <TextInput
            style={styles.input}
            value={draft.priceText}
            onChangeText={(priceText) => onChange({ ...draft, priceText })}
            placeholder={t(locale, 'products', 'pricePlaceholder')}
            placeholderTextColor="#9AA8A1"
            keyboardType="numeric"
            accessibilityLabel={t(locale, 'products', 'priceLabel')}
          />
        </Field>

        <Field
          label={t(locale, 'products', 'thresholdLabel')}
          help={t(locale, 'products', 'thresholdHelp')}
        >
          <TextInput
            style={styles.input}
            value={draft.thresholdText}
            onChangeText={(thresholdText) => onChange({ ...draft, thresholdText })}
            placeholder={t(locale, 'products', 'thresholdPlaceholder')}
            placeholderTextColor="#9AA8A1"
            keyboardType="numeric"
            accessibilityLabel={t(locale, 'products', 'thresholdLabel')}
          />
        </Field>

        {errorMessage !== null ? <Text style={styles.error}>{errorMessage}</Text> : null}
        {nameMissing ? <Text style={styles.help}>{t(locale, 'products', 'nameRequired')}</Text> : null}
      </ScrollView>

      {/* Bottom, thumb-reachable. No confirm dialog — UI_SPEC.md and CLAUDE.md
          are explicit that a confirm taxes every user forever; a mistake here
          is fixed by editing the product or archiving it. */}
      <View style={styles.actions}>
        <Button
          label={t(locale, 'common', 'cancel')}
          variant="secondary"
          onPress={onCancel}
          style={styles.actionButton}
        />
        <Button
          label={t(locale, 'common', 'save')}
          onPress={onSubmit}
          disabled={nameMissing}
          style={styles.actionButton}
        />
      </View>
    </View>
  );
}

function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
      {help !== undefined ? <Text style={styles.help}>{help}</Text> : null}
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
  content: { paddingBottom: spacing.lg },
  title: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.lg,
    color: '#14231C',
    lineHeight: fontSize.lg * 1.5,
    textAlign: 'left',
    marginBottom: spacing.sm,
  },
  field: { marginTop: spacing.md },
  label: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: '#5B6B62',
    lineHeight: fontSize.sm * 1.7,
    textAlign: 'left',
    marginBottom: spacing.xs,
  },
  input: {
    minHeight: minTouchTarget,
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
  help: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: '#5B6B62',
    lineHeight: fontSize.sm * 1.6,
    marginTop: spacing.xs,
    textAlign: 'left',
  },
  error: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.sm,
    color: '#8A3B2A',
    lineHeight: fontSize.sm * 1.6,
    marginTop: spacing.md,
    textAlign: 'left',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: '#E9EEEC',
  },
  chipSelected: { backgroundColor: '#1B6E4A' },
  chipLabel: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.md,
    color: '#14231C',
  },
  chipLabelSelected: {
    fontFamily: fontFamily.bold,
    color: '#FFFFFF',
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionButton: { flex: 1 },
});
