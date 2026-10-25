import { Feather } from '@expo/vector-icons';
import { Redirect, Tabs } from 'expo-router';
import React from 'react';
import { useInboxBriefing } from '../../src/components/EmailBits';
import { useStore } from '../../src/lib/store';
import { colors, fonts } from '../../src/theme';

const TABS: { name: string; title: string; icon: React.ComponentProps<typeof Feather>['name'] }[] = [
  { name: 'today', title: 'Today', icon: 'home' },
  { name: 'capture', title: 'Capture', icon: 'plus-square' },
  { name: 'projects', title: 'To-dos', icon: 'check-square' },
  { name: 'inbox', title: 'Inbox', icon: 'mail' },
  { name: 'more', title: 'More', icon: 'more-horizontal' },
];

export default function TabsLayout() {
  const { session, authReady, emailAccounts } = useStore();
  // The Inbox tab's badge: how many emails need you first (the same list the Inbox shows).
  const needYou = useInboxBriefing().list.length;
  if (authReady && !session) return <Redirect href="/welcome" />;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.pink,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border, height: 84, paddingTop: 8 },
        tabBarLabelStyle: { fontFamily: fonts.medium, fontSize: 11 },
      }}
    >
      {TABS.map((t) => (
        <Tabs.Screen
          key={t.name}
          name={t.name}
          options={{
            title: t.title,
            tabBarIcon: ({ color, size }) => <Feather name={t.icon} color={color as string} size={size - 2} />,
            ...(t.name === 'inbox' && emailAccounts.length && needYou ? { tabBarBadge: needYou, tabBarBadgeStyle: { backgroundColor: colors.pink, fontFamily: fonts.medium, fontSize: 11 } } : {}),
          }}
        />
      ))}
    </Tabs>
  );
}
