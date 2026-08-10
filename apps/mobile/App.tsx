import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import { Gallery } from './src/gallery/Gallery';
import { useDesignSystemFonts } from './src/ui/fonts';

export default function App() {
  const [fontsLoaded] = useDesignSystemFonts();

  if (!fontsLoaded) {
    return null;
  }

  return (
    <View style={styles.container}>
      <Gallery />
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
});
