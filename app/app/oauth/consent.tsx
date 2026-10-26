import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';
import { FlowerArt } from '../../src/components/FlowerArt';
import { Banner, Body, Button, Card, H1, Icon, IconCircle, Muted, Screen } from '../../src/components/ui';
import { useStore } from '../../src/lib/store';
import { api, ApiError } from '../../src/lib/api';
import { colors, fonts } from '../../src/theme';

// Supabase Auth's OAuth server sends people here when an AI chat (Claude, ChatGPT…) asks to connect to Momentum.
// They sign in if needed, see who is asking, and allow or deny. Supabase then hands the chat its tokens.

type Details = { client: { name: string; uri: string }; redirect_uri: string; user: { email: string }; scope: string };

const CAN = [
  { icon: 'eye', text: 'See your projects, tasks, life areas and today’s suggestions' },
  { icon: 'send', text: 'Send plans you work out together, which wait for your review' },
  { icon: 'plus-circle', text: 'Add, update or check off tasks when you ask it to' },
] as const;

function go(url: string) {
  if (Platform.OS === 'web') window.location.assign(url);
}

export default function Consent() {
  const { authorization_id: id } = useLocalSearchParams<{ authorization_id?: string }>();
  const { session, authReady } = useStore();
  const [details, setDetails] = useState<Details | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'allow' | 'deny' | null>(null);

  useEffect(() => {
    if (!authReady) return;
    if (!id) { setError('This link is missing its connection request. Start again from your AI app.'); return; }
    if (!session) {
      router.replace({ pathname: '/sign-in', params: { next: `/oauth/consent?authorization_id=${encodeURIComponent(id)}` } });
      return;
    }
    // Through our API rather than supabase-js: Supabase only answers these from its Site URL, and this page also runs
    // on the dashboard's domain.
    api<Details & { authorization_id?: string; redirect_url?: string }>('/api/oauth/consent', { id }).then((data) => {
      if (!data.authorization_id && data.redirect_url) return go(data.redirect_url); // already allowed before
      setDetails(data);
    }).catch((e: unknown) => {
      const why = e instanceof ApiError && e.code !== 'request_failed' ? ` (${e.code})` : '';
      setError(`This connection request couldn’t be loaded${why}. Start again from your AI app.`);
    });
  }, [authReady, session, id]);

  const decide = async (allow: boolean) => {
    if (!id) return;
    setBusy(allow ? 'allow' : 'deny');
    try {
      const res = await api<{ redirect_url: string }>('/api/oauth/consent', { id, action: allow ? 'approve' : 'deny' });
      go(res.redirect_url);
    } catch {
      setBusy(null);
      setError('Something went wrong. Start again from your AI app.');
    }
  };

  const app = details?.client.name || 'An AI app';
  let host = '';
  try { host = details ? new URL(details.redirect_uri).host : ''; } catch { /* shown without a host */ }

  return (
    <Screen>
      <View style={{ alignItems: 'center', marginTop: 8 }}>
        <FlowerArt slot="celebrate" width={130} height={130} seed={2.1} />
      </View>
      {error ? (
        <>
          <H1 style={{ textAlign: 'center' }}>Couldn’t connect</H1>
          <Banner tone="soft" text={error} />
          <Button title="Go to Momentum" variant="ghost" onPress={() => router.replace('/today')} />
        </>
      ) : !details ? (
        <ActivityIndicator color={colors.pink} style={{ marginTop: 40 }} />
      ) : (
        <>
          <H1 style={{ textAlign: 'center' }}>Connect {app}?</H1>
          <Muted style={{ textAlign: 'center', fontSize: 15, marginTop: 6, marginBottom: 18 }}>
            {app}{host ? ` (${host})` : ''} wants to work with your Momentum account, {details.user.email}.
          </Muted>
          <Card>
            <Body style={{ fontFamily: fonts.medium, marginBottom: 10 }}>It will be able to:</Body>
            {CAN.map((c) => (
              <View key={c.text} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                <IconCircle name={c.icon} color={colors.teal} soft={colors.tealSoft} size={34} />
                <Body style={{ flex: 1 }}>{c.text}</Body>
              </View>
            ))}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <Icon name="shield" size={16} color={colors.textMuted} />
              <Muted style={{ flex: 1 }}>It can’t see your email, delete anything, or reach other people’s data. You can disconnect it any time in Settings.</Muted>
            </View>
          </Card>
          <Button title={`Allow ${app}`} onPress={() => decide(true)} loading={busy === 'allow'} disabled={!!busy} style={{ marginTop: 8 }} />
          <Button title="Don’t allow" variant="ghost" onPress={() => decide(false)} loading={busy === 'deny'} disabled={!!busy} />
        </>
      )}
    </Screen>
  );
}
