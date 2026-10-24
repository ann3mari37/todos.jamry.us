import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { PlayfairDisplay_600SemiBold, PlayfairDisplay_700Bold } from '@expo-google-fonts/playfair-display';
import { useFonts } from 'expo-font';
import { Stack, type ErrorBoundaryProps } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
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
      <StoreProvider>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
          <Stack.Screen name="celebrate" options={{ presentation: 'modal', animation: 'fade' }} />
        </Stack>
      </StoreProvider>
    </SafeAreaProvider>
  );
}
