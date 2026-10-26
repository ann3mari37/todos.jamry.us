import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { PlayfairDisplay_600SemiBold, PlayfairDisplay_700Bold } from '@expo-google-fonts/playfair-display';
import { useFonts } from 'expo-font';
import { Stack, type ErrorBoundaryProps } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { ActivityIndicator, Platform, Pressable, Text, View } from 'react-native';
import { SafeAreaInsetsContext, SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAutoUpdate } from '../src/components/SyncStatus';
import { StoreProvider } from '../src/lib/store';
import { colors } from '../src/theme';

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, padding: 24 }}>
      <Text style={{ fontSize: 20, color: colors.text, marginBottom: 8 }}>Something went wrong on this screen.</Text>
      <Text style={{ color: colors.textMuted, textAlign: 'center', marginBottom: 16 }}>Your data is safe. {error.message}</Text>
      <Pressable onPress={retry} accessibilityRole="button" style={{ backgroundColor: colors.pink, borderRadius: 999, paddingHorizontal: 22, paddingVertical: 12 }}>
        <Text style={{ color: colors.white }}>Try again</Text>
      </Pressable>
    </View>
  );
}

export default function RootLayout() {
  useAutoUpdate();
  const [loaded] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, PlayfairDisplay_600SemiBold, PlayfairDisplay_700Bold });
  if (!loaded) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.pink} />
      </View>
    );
  }
  return (
    <SafeAreaProvider>
      <SaneInsets>
        <StoreProvider>
          <StatusBar style="dark" />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
            <Stack.Screen name="celebrate" options={{ presentation: 'modal', animation: 'fade' }} />
          </Stack>
        </StoreProvider>
      </SaneInsets>
    </SafeAreaProvider>
  );
}

// Mobile browsers sometimes report a huge safe-area inset (seen on an iPhone: ~260px at the bottom, which swelled the
// tab bar to half the screen). No real device needs more than these, so on the web every screen gets capped insets.
const MAX_INSETS = { top: 59, bottom: 34, left: 48, right: 48 };

function SaneInsets({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const capped = React.useMemo(() => ({
    top: Math.min(insets.top, MAX_INSETS.top),
    bottom: Math.min(insets.bottom, MAX_INSETS.bottom),
    left: Math.min(insets.left, MAX_INSETS.left),
    right: Math.min(insets.right, MAX_INSETS.right),
  }), [insets.top, insets.bottom, insets.left, insets.right]);
  if (Platform.OS !== 'web') return <>{children}</>;
  return <SafeAreaInsetsContext.Provider value={capped}>{children}</SafeAreaInsetsContext.Provider>;
}
