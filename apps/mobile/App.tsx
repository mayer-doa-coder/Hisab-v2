import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gallery } from './src/gallery/Gallery';
import { Phase4Preview } from './src/gallery/Phase4Preview';
import { useDesignSystemFonts } from './src/ui/fonts';
import { bootstrap, type AppData } from './src/data/bootstrap';
import { CoreFlow } from './src/navigation/CoreFlow';

// Step 14: the six core screens (UI_SPEC.md) are wired to the real on-device
// SQLite event store via bootstrap.ts and are now the default pane. The
// 'gallery'/'phase4' panes stay for comparison against the design system and
// the Phase 4 synthetic-log preview.
type Pane = 'app' | 'phase4' | 'gallery';

export default function App() {
  const [fontsLoaded] = useDesignSystemFonts();
  const [pane, setPane] = useState<Pane>('app');
  const [appData, setAppData] = useState<AppData | null>(null);

  useEffect(() => {
    void bootstrap().then(setAppData);
  }, []);

  // One-time cold-start setup, not a post-action load — UI_SPEC.md's "no
  // spinner" rule is about a local write that already happened, not about
  // opening the database before the app is interactive at all. Blank, not a
  // spinner: budgeted against the <3s cold-start acceptance criterion.
  if (!fontsLoaded || appData === null) {
    return <View style={styles.container} />;
  }

  return (
    <View style={styles.container}>
      <View style={styles.paneBar}>
        <PaneTab label="Hisab" active={pane === 'app'} onPress={() => setPane('app')} />
        <PaneTab label="Phase 4" active={pane === 'phase4'} onPress={() => setPane('phase4')} />
        <PaneTab label="Gallery" active={pane === 'gallery'} onPress={() => setPane('gallery')} />
      </View>
      {pane === 'app' ? (
        <CoreFlow appData={appData} />
      ) : pane === 'phase4' ? (
        <Phase4Preview />
      ) : (
        <Gallery />
      )}
      <StatusBar style="auto" />
    </View>
  );
}

function PaneTab({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.paneTab}>
      <Text style={[styles.paneLabel, active && styles.paneLabelActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  paneBar: {
    flexDirection: 'row',
    paddingTop: 36,
    backgroundColor: '#14231C',
  },
  paneTab: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  paneLabel: {
    color: '#9AA8A1',
    fontSize: 13,
  },
  paneLabelActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
});
