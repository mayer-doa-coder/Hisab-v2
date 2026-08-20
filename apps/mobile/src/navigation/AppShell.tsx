// AppShell.tsx — screen switching, with NO navigation library.
//
// react-navigation + react-native-screens + react-native-safe-area-context is
// the reflex here and it is the wrong reflex on this project. AGENTS.md §3.4
// puts the APK at 25 MB and DECISIONS.md 2026-08-15 records only 2.73 MB of
// headroom left. A stack navigator buys deep linking, gesture-driven back, and
// header animation — none of which these five screens use. CLAUDE.md names
// "reaching for a library" as this project's specific failure mode, and says to
// ask first. This is ~50 lines of useState instead, and it costs nothing.
//
// When the six core screens land and genuinely need a back stack, hardware
// back handling and deep links, that is the moment to price a navigator
// against the remaining headroom — with a measured APK delta, not an estimate.

import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { fontFamily, fontSize, minTouchTarget, spacing } from '../ui/typography';

export interface TabDefinition {
  readonly key: string;
  readonly label: string;
  readonly render: () => ReactNode;
}

export interface AppShellProps {
  tabs: readonly TabDefinition[];
  initialKey?: string;
}

/**
 * A flat tab switcher. Flat, not a stack, because all five Phase 4 screens are
 * peers — you do not drill from the aging view into the alerts screen. Screens
 * that DO push (product list -> product form) manage that themselves with their
 * own state, which keeps the pushing local to the one place that needs it.
 *
 * The bar sits at the BOTTOM: UI_SPEC.md's physical constraints say all primary
 * actions belong in the lower half, reachable by the thumb of the one hand that
 * is not holding goods or cash.
 */
export function AppShell({ tabs, initialKey }: AppShellProps) {
  const firstKey = tabs[0]?.key ?? '';
  const [activeKey, setActiveKey] = useState(initialKey ?? firstKey);
  const active = tabs.find((tab) => tab.key === activeKey) ?? tabs[0];

  return (
    <View style={styles.shell}>
      <View style={styles.body}>{active?.render()}</View>
      <View style={styles.tabBar}>
        {tabs.map((tab) => {
          const selected = tab.key === active?.key;
          return (
            <Pressable
              key={tab.key}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => setActiveKey(tab.key)}
              style={styles.tab}
            >
              {/* Weight and colour-on-text carry selection, not a coloured
                  pill — UI_SPEC.md: "Never rely on subtle colour differences
                  alone", and two font weights only. */}
              <Text style={[styles.tabLabel, selected && styles.tabLabelSelected]} numberOfLines={1}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: '#F6F8F7' },
  body: { flex: 1 },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#DFE7E3',
    backgroundColor: '#FFFFFF',
  },
  tab: {
    flex: 1,
    minHeight: minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  tabLabel: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: '#5B6B62',
    lineHeight: fontSize.sm * 1.6,
  },
  tabLabelSelected: {
    fontFamily: fontFamily.bold,
    color: '#1B6E4A',
  },
});
