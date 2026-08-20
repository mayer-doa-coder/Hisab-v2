// AddCustomerScreen.tsx — UI_SPEC.md screen 3. "One required field: what you
// call them. Phone optional." Not five fields — no credit limit, due terms,
// or address at creation (SECURITY.md §6, CLAUDE.md: "being helpful by
// adding extra fields" is this project's named failure mode).
//
// Same lifted-draft, controlled-component shape ProductFormScreen.tsx
// already established for the identical reason: UI_SPEC.md wants draft state
// to survive backgrounding. NOTE, flagged rather than silently matched: like
// ProductFormScreen's own draft, this one is NOT yet persisted to disk on
// every keystroke — only lifted to a parent that could add that later. See
// this step's plan notes on why that piece is deferred.

import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from '../ui/Button';
import { fontFamily, fontSize, minTouchTarget, spacing } from '../ui/typography';
import { colors } from '../ui/colors';
import { t, type Locale } from '../i18n';

export interface AddCustomerDraft {
  readonly name: string;
  readonly phone: string;
}

export const EMPTY_ADD_CUSTOMER_DRAFT: AddCustomerDraft = { name: '', phone: '' };

export interface AddCustomerScreenProps {
  draft: AddCustomerDraft;
  onChange: (draft: AddCustomerDraft) => void;
  onSubmit: () => void;
  onCancel: () => void;
  locale: Locale;
  errorMessage?: string | null;
}

export function AddCustomerScreen({
  draft,
  onChange,
  onSubmit,
  onCancel,
  locale,
  errorMessage = null,
}: AddCustomerScreenProps) {
  const nameMissing = draft.name.trim() === '';

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{t(locale, 'customers', 'addCustomer')}</Text>

        <View style={styles.field}>
          <TextInput
            style={styles.input}
            value={draft.name}
            onChangeText={(name) => onChange({ ...draft, name })}
            placeholder={t(locale, 'customers', 'namePlaceholder')}
            placeholderTextColor={colors.placeholder}
            autoFocus
            accessibilityLabel={t(locale, 'customers', 'namePlaceholder')}
          />
          {nameMissing ? <Text style={styles.help}>{t(locale, 'customers', 'nameRequired')}</Text> : null}
        </View>

        <View style={styles.field}>
          <TextInput
            style={styles.input}
            value={draft.phone}
            onChangeText={(phone) => onChange({ ...draft, phone })}
            placeholder={t(locale, 'customers', 'phoneOptionalPlaceholder')}
            placeholderTextColor={colors.placeholder}
            keyboardType="phone-pad"
            accessibilityLabel={t(locale, 'customers', 'phoneOptionalPlaceholder')}
          />
        </View>

        {errorMessage !== null ? <Text style={styles.error}>{errorMessage}</Text> : null}
      </ScrollView>

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

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.screenBackground,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  content: { paddingBottom: spacing.lg },
  title: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.lg,
    color: colors.textPrimary,
    lineHeight: fontSize.lg * 1.5,
    textAlign: 'left',
    marginBottom: spacing.md,
  },
  field: { marginTop: spacing.md },
  input: {
    minHeight: minTouchTarget,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    fontFamily: fontFamily.regular,
    fontSize: fontSize.md,
    color: colors.textPrimary,
    textAlign: 'left',
  },
  help: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.textMuted,
    lineHeight: fontSize.sm * 1.6,
    marginTop: spacing.xs,
    textAlign: 'left',
  },
  error: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.sm,
    color: colors.error,
    lineHeight: fontSize.sm * 1.6,
    marginTop: spacing.md,
    textAlign: 'left',
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionButton: { flex: 1 },
});
