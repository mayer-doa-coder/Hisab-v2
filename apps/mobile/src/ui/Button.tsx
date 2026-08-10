// Button.tsx — docs/UI_SPEC.md physical constraints: "Minimum 48dp touch
// targets, generously spaced." Data-free: plain primitive props only.

import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { fontFamily, fontSize, minTouchTarget, spacing } from './typography';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Button({ label, onPress, variant = 'primary', disabled = false, style }: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [
        styles.base,
        variant === 'primary' ? styles.primary : styles.secondary,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
        style,
      ]}
    >
      <Text
        style={[
          styles.label,
          variant === 'primary' ? styles.labelPrimary : styles.labelSecondary,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: minTouchTarget,
    minWidth: minTouchTarget,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: {
    backgroundColor: '#1B6E4A',
  },
  secondary: {
    backgroundColor: '#E9EEEC',
  },
  disabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.8,
  },
  label: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.md,
  },
  labelPrimary: {
    color: '#FFFFFF',
  },
  labelSecondary: {
    color: '#14231C',
  },
});
