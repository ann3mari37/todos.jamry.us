import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Banner, Body, Button, Card, Field, H1, IconCircle, Muted, Screen } from '../src/components/ui';
import { useStore, type InviteInfo } from '../src/lib/store';
import { colors, fonts } from '../src/theme';

// Where an invite link lands: sign in (or create an account) first, see which team and role it's for, pick the name
// teammates will see, and join.

export default function Join() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  const store = useStore();
  const [info, setInfo] = useState<InviteInfo | null | undefined>(undefined);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!store.authReady) return;
    if (!code) { setInfo(null); return; }
    if (!store.session) {
      router.replace({ pathname: '/sign-in', params: { mode: 'signup', next: `/join?code=${encodeURIComponent(code)}` } });
      return;
    }
    store.inviteInfo(code).then((i) => { setInfo(i); setName((n) => n || i?.name || store.profile?.display_name || ''); }).catch(() => setInfo(null));
  }, [store.authReady, store.session, code]); // eslint-disable-line react-hooks/exhaustive-deps

  const join = async () => {
    if (!code) return;
    setBusy(true); setError(null);
    try {
      await store.acceptInvite(code, name.trim());
      router.replace('/team');
    } catch (e) {
      setError(/expired/i.test((e as Error).message) ? 'This invite has expired or was already used. Ask for a new link.' : 'Couldn’t join. Try again.');
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={{ alignItems: 'center', marginTop: 24, marginBottom: 12 }}>
        <IconCircle name="users" color={colors.pink} soft={colors.pinkWash} size={64} />
      </View>
      {info === undefined ? (
        <ActivityIndicator color={colors.pink} style={{ marginTop: 24 }} />
      ) : !info || (!info.valid && !info.already_member) ? (
        <>
          <H1 style={{ textAlign: 'center' }}>This invite doesn’t work</H1>
          <Banner tone="soft" text="It may have expired, been used already, or been cancelled. Ask whoever sent it for a new link." />
          <Button title="Go to Momentum" variant="ghost" onPress={() => router.replace('/today')} />
        </>
      ) : info.already_member ? (
        <>
          <H1 style={{ textAlign: 'center' }}>You’re on {info.team}</H1>
          <Button title="Open the team" onPress={() => router.replace('/team')} style={{ marginTop: 16 }} />
        </>
      ) : (
        <>
          <H1 style={{ textAlign: 'center' }}>Join {info.team}?</H1>
          <Muted style={{ textAlign: 'center', fontSize: 15, marginTop: 6, marginBottom: 16 }}>
            {info.invited_by ? `${info.invited_by} invited you` : 'You’re invited'}{info.role ? ` as ${info.role}` : ''}.
          </Muted>
          <Card>
            <Body style={{ fontFamily: fonts.medium, marginBottom: 6 }}>On the team you’ll</Body>
            <Muted>• See the team’s projects and every step on them</Muted>
            <Muted>• Get the steps assigned to you{info.role ? ` or to ${info.role}` : ''} on your Today</Muted>
            <Muted style={{ marginBottom: 10 }}>• Keep your own projects, life areas, history and email private</Muted>
            <Field label="Your name on the team" value={name} onChangeText={setName} placeholder="e.g. AnneMarie" />
          </Card>
          {error && <Banner tone="soft" text={error} />}
          <Button title={`Join ${info.team}`} loading={busy} disabled={busy || !name.trim()} onPress={join} style={{ marginTop: 10 }} />
          <Button title="Not now" variant="ghost" onPress={() => router.replace('/today')} />
        </>
      )}
    </Screen>
  );
}
