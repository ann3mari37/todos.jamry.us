import { router } from 'expo-router';
import React from 'react';
import { Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Flower } from '../src/components/Flower';
import { Button } from '../src/components/ui';
import { colors, fonts } from '../src/theme';

export default function Welcome() {
  const { width, height } = useWindowDimensions();
  const flower = Math.min(width * 1.35, 620);
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#F9E4E2', overflow: 'hidden' }}>
      <View style={{ position: 'absolute', top: -flower * 0.18, left: width / 2 - flower * 0.45, opacity: 0.95 }}>
        <Flower size={flower} seed={0.4} />
      </View>
      <View style={{ flex: 1, justifyContent: 'flex-end', paddingHorizontal: 28, paddingBottom: 28, width: '100%', maxWidth: 480, alignSelf: 'center' }}>
        <View style={{ backgroundColor: 'rgba(251,243,239,0.82)', borderRadius: 28, paddingVertical: 28, paddingHorizontal: 20, marginTop: height * 0.45 }}>
          <Text accessibilityRole="header" style={{ fontFamily: fonts.serif, fontSize: 40, letterSpacing: 4, color: colors.text, textAlign: 'center' }}>MOMENTUM</Text>
          <Text style={{ fontFamily: fonts.medium, fontSize: 12, letterSpacing: 8, color: colors.textMuted, textAlign: 'center', marginTop: 10 }}>SMALL STEPS</Text>
          <Text style={{ fontFamily: fonts.medium, fontSize: 12, letterSpacing: 8, color: colors.textMuted, textAlign: 'center', marginTop: 6 }}>BIG CHANGE</Text>
          <Button title="Get Started" onPress={() => router.push('/sign-in?mode=signup')} style={{ marginTop: 28 }} />
          <Button title="I already have an account" variant="ghost" onPress={() => router.push('/sign-in')} style={{ marginTop: 6 }} />
        </View>
      </View>
    </SafeAreaView>
  );
}
