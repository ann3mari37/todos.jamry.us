import { router } from 'expo-router';
import React from 'react';
import { View } from 'react-native';
import { Card, Divider, H1, Muted, Row, Screen } from '../../src/components/ui';
import { useEmailAvailable } from '../../src/components/EmailBits';
import { useStore } from '../../src/lib/store';
import { colors } from '../../src/theme';

const SECTIONS = [
  { key: 'ai', icon: 'star', title: 'AI Preferences', subtitle: 'Tone, suggestions, and personalization' },
  { key: 'notifications', icon: 'bell', title: 'Notifications', subtitle: 'Reminders and gentle check-ins' },
  { key: 'privacy', icon: 'lock', title: 'Privacy & Data', subtitle: 'Your data, export and deletion' },
  { key: 'appearance', icon: 'droplet', title: 'Appearance', subtitle: 'Motion and display' },
  { key: 'voice', icon: 'mic', title: 'Voice & Input', subtitle: 'Speech-to-text settings' },
  { key: 'help', icon: 'help-circle', title: 'Help & Feedback', subtitle: 'How Momentum works' },
] as const;

export default function More() {
  const store = useStore();
  const email = useEmailAvailable();
  return (
    <Screen>
      <H1 style={{ marginTop: 8, marginBottom: 14 }}>Settings</H1>
      <Card style={{ paddingVertical: 4 }}>
        {email && (
          <>
            <Row icon="mail" iconColor={colors.pink} title="Inbox" subtitle="Digest, summaries and email tasks" onPress={() => router.push('/inbox')} />
            <Divider />
            <Row icon="at-sign" iconColor={colors.pink} title="Email Accounts" subtitle={store.emailAccounts.length ? `${store.emailAccounts.length} connected` : 'Connect your inbox'} onPress={() => router.push('/email-accounts')} />
            <Divider />
          </>
        )}
        <Row icon="grid" iconColor={colors.pink} title="Life Areas" subtitle="Home, Work, Health…" onPress={() => router.push('/life-areas')} />
        <Divider />
        <Row icon="clock" iconColor={colors.pink} title="History" subtitle="Everything you've done" onPress={() => router.push('/history')} />
      </Card>
      <Card style={{ paddingVertical: 4 }}>
        {SECTIONS.map((s, i) => (
          <View key={s.key}>
            {i > 0 && <Divider />}
            <Row icon={s.icon} iconColor={colors.pink} title={s.title} subtitle={s.subtitle} onPress={() => router.push({ pathname: '/settings/[section]', params: { section: s.key } })} />
          </View>
        ))}
      </Card>
      <Card style={{ paddingVertical: 4 }}>
        <Row icon="log-out" title="Sign out" onPress={async () => { await store.signOut(); router.replace('/welcome'); }} />
      </Card>
      <Muted style={{ textAlign: 'center', marginTop: 8 }}>{store.session?.user.email}</Muted>
    </Screen>
  );
}
