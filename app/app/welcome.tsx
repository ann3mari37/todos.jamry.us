import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import React from 'react';
import { Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FlowerArt } from '../src/components/FlowerArt';
import { Button } from '../src/components/ui';
import { colors, fonts, isAviation } from '../src/theme';

/** Hex color → rgba with the given alpha (for the fade under the artwork). */
const alpha = (hex: string, a: number) => `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${a})`;

export default function Welcome() {
  const { width, height } = useWindowDimensions();
  // The artwork fills the top of the screen and bleeds past the sides, like the design.
  // Short windows (desktop browsers) keep ~330px clear for the wordmark and buttons.
  const art = Math.min(Math.max(width * 1.25, 420), 760, height * 0.78, Math.max(240, height - 330));
  const wash = colors.hero;
  return (
    <View style={{ flex: 1, backgroundColor: wash, overflow: 'hidden' }}>
      {/* Aviation keeps the top flat navy so the plane photo's backdrop blends in without an edge. */}
      <LinearGradient colors={isAviation ? [wash, wash, colors.heroBottom] : [colors.heroTop, wash, colors.heroBottom]} locations={isAviation ? [0, 0.62, 1] : [0, 0.55, 1]} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
      <View style={{ position: 'absolute', top: isAviation ? height * 0.04 : -art * 0.06, left: width / 2 - art / 2 }}>
        <FlowerArt slot="welcome" width={art} height={isAviation ? art * 0.75 : art} seed={0.4} bare />
      </View>
      {/* Soft fade so the artwork dissolves behind the wordmark. */}
      <LinearGradient colors={[alpha(wash, 0), alpha(wash, 0.9), wash]} locations={[0, 0.45, 1]} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: height * 0.5 }} />

      <SafeAreaView style={{ flex: 1, justifyContent: 'flex-end' }} edges={['bottom']}>
        <View style={{ paddingHorizontal: 28, paddingBottom: 24, width: '100%', maxWidth: 440, alignSelf: 'center' }}>
          <Text accessibilityRole="header" style={{ fontFamily: fonts.serif, fontSize: 44, letterSpacing: 5, color: colors.heroText, textAlign: 'center' }}>MOMENTUM</Text>
          <Text style={{ fontFamily: fonts.medium, fontSize: 12, letterSpacing: 9, color: colors.heroMuted, textAlign: 'center', marginTop: 14 }}>SMALL STEPS</Text>
          <Text style={{ fontFamily: fonts.medium, fontSize: 12, letterSpacing: 9, color: colors.heroMuted, textAlign: 'center', marginTop: 8 }}>BIG CHANGE</Text>
          <Button title="Get Started" onPress={() => router.push('/sign-in?mode=signup')} style={[{ marginTop: 34 }, isAviation && { backgroundColor: colors.heroText }]} textColor={isAviation ? colors.pinkDeep : undefined} />
          <Button title="I already have an account" variant="ghost" onPress={() => router.push('/sign-in')} style={{ marginTop: 4 }} textColor={isAviation ? colors.heroText : undefined} />
        </View>
      </SafeAreaView>
    </View>
  );
}
