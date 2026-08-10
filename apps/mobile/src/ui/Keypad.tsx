// Keypad.tsx — docs/UI_SPEC.md screen 4: "Full-screen numeric keypad — NOT
// a text input with the system keyboard." Digits, backspace, and confirm
// built as one component, per this step's task.
//
// PLACEHOLDER SHELL: emits which key was pressed as a plain string
// ('0'-'9' | 'backspace' | 'confirm') and nothing else. It does not compose
// an amount, does not touch Poisha, does not know what "confirm" means for
// a real screen — that wiring is Step 8's job, not this one's.

import { Pressable, StyleSheet, Text, View } from 'react-native';
import { fontFamily, fontSize, minTouchTarget, spacing } from './typography';

export type KeypadKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'backspace' | 'confirm';

export interface KeypadProps {
  onKeyPress: (key: KeypadKey) => void;
}

const ROWS: readonly (readonly KeypadKey[])[] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['backspace', '0', 'confirm'],
];

const KEY_LABEL: Record<KeypadKey, string> = {
  '0': '0',
  '1': '1',
  '2': '2',
  '3': '3',
  '4': '4',
  '5': '5',
  '6': '6',
  '7': '7',
  '8': '8',
  '9': '9',
  backspace: '⌫',
  confirm: '✓',
};

export function Keypad({ onKeyPress }: KeypadProps) {
  return (
    <View style={styles.grid}>
      {ROWS.map((row) => (
        <View key={row.join('-')} style={styles.row}>
          {row.map((key) => (
            <Pressable
              key={key}
              accessibilityRole="button"
              onPress={() => onKeyPress(key)}
              style={({ pressed }) => [
                styles.key,
                key === 'confirm' && styles.confirmKey,
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.keyLabel, key === 'confirm' && styles.confirmLabel]}>
                {KEY_LABEL[key]}
              </Text>
            </Pressable>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  key: {
    flex: 1,
    minHeight: minTouchTarget + 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: '#F1F4F2',
  },
  confirmKey: {
    backgroundColor: '#1B6E4A',
  },
  pressed: {
    opacity: 0.7,
  },
  keyLabel: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.xl,
    color: '#14231C',
  },
  confirmLabel: {
    color: '#FFFFFF',
  },
});
