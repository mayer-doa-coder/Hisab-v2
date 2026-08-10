// Amount.tsx — docs/UI_SPEC.md physical constraints: "The amount is the most
// important thing on screen... Largest element. Never truncated, never
// wrapped, never in a light weight."
//
// Data-free: takes plain primitives only. No import from viewmodels/, no
// domain coupling. `numeralScript` is an explicit prop that defaults to
// 'arabic' (AGENTS.md §6's current default, pending the timing experiment) —
// this component never decides the script by hardcoding one internally;
// every digit still flows through formatDigits.ts's explicit script
// argument. The default lives here, not one layer up in every caller, so a
// call site that forgets the prop gets the documented default instead of a
// type error — see docs/DECISIONS.md if that default ever changes.

import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';
import { formatAmountDigits, type NumeralScript } from './formatDigits';
import { fontFamily, fontSize } from './typography';

export interface AmountProps {
  /** Plain taka amount (not Poisha — this file has zero domain coupling). */
  valueTaka: number;
  /**
   * Defaults to 'arabic' (AGENTS.md §6). Still explicit and overridable —
   * this is a default, not a hardcoded script; formatDigits.ts never special-
   * cases either value internally.
   */
  numeralScript?: NumeralScript;
  size?: keyof typeof fontSize;
  style?: StyleProp<TextStyle>;
}

export function Amount({ valueTaka, numeralScript = 'arabic', size = 'amount', style }: AmountProps) {
  const display = formatAmountDigits(valueTaka, numeralScript);
  return (
    <Text
      style={[styles.base, { fontSize: fontSize[size] }, style]}
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={0.6}
    >
      {display}
    </Text>
  );
}

const styles = StyleSheet.create({
  base: {
    fontFamily: fontFamily.bold, // "never in a light weight"
    includeFontPadding: false,
  },
});
