import { router } from 'expo-router';
import React from 'react';
import { View } from 'react-native';
import { Card, Divider, H1, Muted, Row, Screen } from '../../src/components/ui';
import { useEmailAvailable } from '../../src/components/EmailBits';
import { SyncStatus } from '../../src/components/SyncStatus';
import { useStore } from '../../src/lib/store';
import { TEAMS_UI } from '../../src/components/TeamBits';
import { colors } from '../../src/theme';

const SECTIONS = [
  { key: 'ai', icon: 'star', title: 'AI Preferences', subtitle: 'Tone, suggestions, and personalization' },
  { key: 'notifications', icon: 'bell', title: 'Notifications', subtitle: 'Reminders and gentle check-ins' },
  { key: 'privacy', icon: 'lock', title: 'Privacy & Data', subtitle: 'Your data, export and deletion' },
  { key: 'appearance', icon: 'droplet', title: 'Appearance', subtitle: 'Motion and display' },
  { key: 'help', icon: 'help-circle', title: 'Help & Feedback', subtitle: 'How Momentum works' },
] as const;

export default function More() {
  const store = useStore();
  const email = useEmailAvailable();
  return (
    <Screen>
      <H1 style={{ marginTop: 8, marginBottom: 14 }}>Settings</H1>
      <Card style={{ paddingVertical: 4 }}>
        <Row icon="message-circle" iconColor={colors.pink} title="Your AI Chat" subtitle="Connect Claude, ChatGPT or another AI" onPress={() => router.push('/connect')} />
        <Divider />
        {email && (
          <>
            <Row icon="at-sign" iconColor={colors.pink} title="Email Accounts" subtitle={store.emailAccounts.length ? `${store.emailAccounts.length} connected` : 'Connect your inbox'} onPress={() => router.push('/email-accounts')} />
            <Divider />
          </>
        )}
        {(TEAMS_UI || store.teams.length > 0) && (
          <>
            <Row icon="users" iconColor={colors.pink} title="Team" subtitle={store.teams.length ? store.teams.map((t) => t.name).join(', ') : 'Share projects and assign steps by role'} onPress={() => router.push('/team')} />
            <Divider />
          </>
        )}
        <Row icon="bar-chart-2" iconColor={colors.pink} title="Progress" subtitle="Your week, wins and milestones" onPress={() => router.push('/progress')} />
        <Divider />
        <Row icon="grid" iconColor={colors.pink} title="Life Areas" subtitle="Home, Work, Health…" onPress={() => router.push('/life-areas')} />
        <Divider />
        <Row icon="clock" iconColor={colors.pink} title="History" subtitle="Everything you've done" onPress={() => router.push('/history')} />
        <Divider />
        <Row icon="compass" iconColor={colors.pink} title="Take the Tour" subtitle="See how Momentum works" onPress={() => router.push({ pathname: '/onboarding', params: { step: 'tour' } })} />
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
      <SyncStatus />
    </Screen>
  );
}
