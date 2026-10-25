import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import React from 'react';
import { Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FlowerArt } from '../src/components/FlowerArt';
import { Button } from '../src/components/ui';
import { colors, fonts } from '../src/theme';

const WASH = '#F8DCDC';

export default function Welcome() {
  const { width, height } = useWindowDimensions();
  // The flower fills the top of the screen and bleeds past the sides, like the design.
  const art = Math.min(Math.max(width * 1.25, 420), 760, height * 0.78);
  return (
    <View style={{ flex: 1, backgroundColor: WASH, overflow: 'hidden' }}>
      <LinearGradient colors={['#FBE6E4', WASH, '#F3C9CC']} locations={[0, 0.55, 1]} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
      <View style={{ position: 'absolute', top: -art * 0.06, left: width / 2 - art / 2 }}>
        <FlowerArt slot="welcome" width={art} height={art} seed={0.4} />
      </View>
      {/* Soft fade so the stem dissolves behind the wordmark. */}
      <LinearGradient colors={['rgba(248,220,220,0)', 'rgba(248,220,220,0.9)', WASH]} locations={[0, 0.45, 1]} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: height * 0.5 }} />

      <SafeAreaView style={{ flex: 1, justifyContent: 'flex-end' }} edges={['bottom']}>
        <View style={{ paddingHorizontal: 28, paddingBottom: 24, width: '100%', maxWidth: 440, alignSelf: 'center' }}>
          <Text accessibilityRole="header" style={{ fontFamily: fonts.serif, fontSize: 44, letterSpacing: 5, color: colors.text, textAlign: 'center' }}>MOMENTUM</Text>
          <Text style={{ fontFamily: fonts.medium, fontSize: 12, letterSpacing: 9, color: colors.textMuted, textAlign: 'center', marginTop: 14 }}>SMALL STEPS</Text>
          <Text style={{ fontFamily: fonts.medium, fontSize: 12, letterSpacing: 9, color: colors.textMuted, textAlign: 'center', marginTop: 8 }}>BIG CHANGE</Text>
          <Button title="Get Started" onPress={() => router.push('/sign-in?mode=signup')} style={{ marginTop: 34 }} />
          <Button title="I already have an account" variant="ghost" onPress={() => router.push('/sign-in')} style={{ marginTop: 4 }} />
        </View>
      </SafeAreaView>
    </View>
  );
}
