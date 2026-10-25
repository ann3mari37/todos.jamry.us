import { router } from 'expo-router';
import React from 'react';
import { View } from 'react-native';
import { ConnectChat } from '../src/components/ConnectChat';
import { Button, H1, IconButton, Muted, Screen } from '../src/components/ui';
import { useStore } from '../src/lib/store';

/** Settings → Connect your AI chat. Also the documentation page the connector points AI apps to. */
export default function Connect() {
  const { session } = useStore();
  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
        <IconButton name="chevron-left" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.navigate('/more'))} />
        <H1 style={{ flex: 1 }}>Your AI chat</H1>
      </View>
      <Muted style={{ fontSize: 15, marginTop: 4, marginBottom: 14 }}>
        Connect Claude, ChatGPT or another AI app. Think out loud with it, and it hands the plan to Momentum for you to review.
      </Muted>
      {session ? <ConnectChat /> : <Button title="Sign in to connect" onPress={() => router.push({ pathname: '/sign-in', params: { next: '/connect' } })} />}
    </Screen>
  );
}
