// fonts.ts — loads exactly two Anek Bangla weights. Deep-imports each weight
// from its own submodule (`@expo-google-fonts/anek-bangla/400Regular`, not
// the package root) deliberately: the package root's index.js unconditionally
// requires all eight weight files to re-export them, which would bundle
// Thin/ExtraLight/Light/Medium/SemiBold/ExtraBold into the APK even though
// nothing references them. Deep-importing is the pattern the package's own
// README documents for exactly this reason.

import { useFonts } from '@expo-google-fonts/anek-bangla/useFonts';
import { AnekBangla_400Regular } from '@expo-google-fonts/anek-bangla/400Regular';
import { AnekBangla_700Bold } from '@expo-google-fonts/anek-bangla/700Bold';

/** Regular and Bold only (AGENTS.md §6) — returns [fontsLoaded, error]. */
export function useDesignSystemFonts() {
  return useFonts({ AnekBangla_400Regular, AnekBangla_700Bold });
}
