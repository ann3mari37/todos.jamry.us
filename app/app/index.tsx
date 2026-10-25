import { Redirect } from 'expo-router';
import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useStore } from '../src/lib/store';
import { colors } from '../src/theme';

export default function Index() {
  const { session, authReady, profile, loading } = useStore();
  // New accounts start with the welcome walkthrough (onboarded_at is null until it's finished or skipped).
  if (!authReady || (session && loading && !profile)) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.pink} />
      </View>
    );
  }
  if (!session) return <Redirect href="/welcome" />;
  return <Redirect href={profile?.onboarded_at === null ? '/onboarding' : '/today'} />;
}
