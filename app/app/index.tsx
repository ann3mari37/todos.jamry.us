import { Redirect } from 'expo-router';
import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useStore } from '../src/lib/store';
import { colors } from '../src/theme';

export default function Index() {
  const { session, authReady } = useStore();
  if (!authReady) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.pink} />
      </View>
    );
  }
  return <Redirect href={session ? '/today' : '/welcome'} />;
}
