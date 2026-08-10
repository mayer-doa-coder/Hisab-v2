// Gallery.tsx — shows every design-system component in isolation with
// hardcoded example props. Not one of docs/UI_SPEC.md's six core screens —
// deliberately NOT placed under apps/mobile/src/screens/ (that's Step 8's
// job) and not gated by AGENTS.md §10's "ask before a new screen" rule,
// since it renders no product data and reaches no domain code.
//
// numeralScript and locale are plain React state (CONSTRAINTS: no
// AsyncStorage, no persistence yet) — this is a dev-only demo toggle, not
// the real user-setting mechanism a later step will build.

import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Amount } from '../ui/Amount';
import { Button } from '../ui/Button';
import { Keypad, type KeypadKey } from '../ui/Keypad';
import { Row } from '../ui/Row';
import { Sheet } from '../ui/Sheet';
import { fontFamily, fontSize, spacing } from '../ui/typography';
import { t, type Locale } from '../i18n';
import type { NumeralScript } from '../ui/formatDigits';

export function Gallery() {
  const [numeralScript, setNumeralScript] = useState<NumeralScript>('arabic');
  const [locale, setLocale] = useState<Locale>('bn');
  const [sheetVisible, setSheetVisible] = useState(false);
  const [lastKey, setLastKey] = useState<KeypadKey | null>(null);

  const handleKeyPress = (key: KeypadKey) => {
    setLastKey(key);
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.heading}>{t(locale, 'common', 'galleryTitle')}</Text>

      <Section title="Amount">
        <Amount valueTaka={1234567} numeralScript={numeralScript} />
        <Amount valueTaka={50} numeralScript={numeralScript} style={styles.gap} />
        <Amount valueTaka={-1500.5} numeralScript={numeralScript} style={styles.gap} />
      </Section>

      <Section title={t(locale, 'common', 'numeralScriptLabel')}>
        <View style={styles.row}>
          <Button
            label={t(locale, 'common', 'numeralScriptArabic')}
            variant={numeralScript === 'arabic' ? 'primary' : 'secondary'}
            onPress={() => setNumeralScript('arabic')}
          />
          <Button
            label={t(locale, 'common', 'numeralScriptBengali')}
            variant={numeralScript === 'bengali' ? 'primary' : 'secondary'}
            onPress={() => setNumeralScript('bengali')}
          />
        </View>
      </Section>

      <Section title={t(locale, 'common', 'languageLabel')}>
        <View style={styles.row}>
          <Button label="বাংলা" variant={locale === 'bn' ? 'primary' : 'secondary'} onPress={() => setLocale('bn')} />
          <Button label="English" variant={locale === 'en' ? 'primary' : 'secondary'} onPress={() => setLocale('en')} />
        </View>
      </Section>

      <Section title="Button">
        <View style={styles.row}>
          <Button label={t(locale, 'customers', 'recordCredit')} onPress={() => {}} />
          <Button label={t(locale, 'common', 'cancel')} variant="secondary" onPress={() => {}} />
        </View>
        <Button label="Disabled" onPress={() => {}} disabled style={styles.gap} />
      </Section>

      <Section title="Row">
        <Row
          title="রহিম ভাই"
          subtitle="৪৫ দিন ধরে কিছু দেননি"
          trailing={<Amount valueTaka={2500} numeralScript={numeralScript} size="md" />}
          onPress={() => {}}
        />
        <Row title="Chairman Shaheb" subtitle="017XXXXXXXX" />
      </Section>

      <Section title="Sheet">
        <Button label="Open sheet" onPress={() => setSheetVisible(true)} />
        <Sheet visible={sheetVisible} onClose={() => setSheetVisible(false)}>
          <Text style={styles.sheetText}>{t(locale, 'common', 'save')} / {t(locale, 'common', 'cancel')}</Text>
        </Sheet>
      </Section>

      <Section title="Keypad">
        <Text style={styles.sheetText}>Last key: {lastKey ?? '—'}</Text>
        <Keypad onKeyPress={handleKeyPress} />
      </Section>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  heading: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.xl,
    color: '#14231C',
    textAlign: 'left',
  },
  section: {
    gap: spacing.sm,
  },
  sectionTitle: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.sm,
    color: '#5B6B62',
    textAlign: 'left',
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  gap: {
    marginTop: spacing.xs,
  },
  sheetText: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.md,
    color: '#14231C',
  },
});
