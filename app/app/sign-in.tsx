import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';
import { FlowerArt } from '../src/components/FlowerArt';
import { Banner, Button, Field, H1, IconButton, Muted, Screen } from '../src/components/ui';
import { isConfigured, supabase } from '../src/lib/supabase';

// Sign in only: new accounts aren't created from the app. Reset emails link back to the site the person signed up on (todos.jamry.us or the dashboard).
// Supabase only honours addresses listed under Auth → URL Configuration → Redirect URLs; others fall back to the Site URL.
const here = typeof window !== 'undefined' && window.location?.origin?.startsWith('https://') ? window.location.origin : undefined;

export default function SignIn() {
  const params = useLocalSearchParams<{ next?: string }>();
  // Where to go after signing in (e.g. an AI app's connection request). Same-site paths only.
  const next = params.next && params.next.startsWith('/') && !params.next.startsWith('//') ? params.next : null;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setMsg(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) return setMsg(error.message);
    router.replace((next ?? '/') as never);
  };

  const reset = async () => {
    if (!email.trim()) return setMsg('Enter your email first.');
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), here ? { redirectTo: here } : undefined);
    setMsg(error ? error.message : 'A reset link is on its way.');
  };

  return (
    <Screen>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <IconButton name="chevron-left" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/welcome'))} />
        <FlowerArt slot="celebrate" width={120} height={120} seed={1.2} />
      </View>
      <H1>Welcome back</H1>
      <Muted style={{ marginBottom: 22, fontSize: 15 }}>Small steps. Big change.</Muted>
      {!isConfigured && <Banner tone="soft" text="Supabase isn't configured yet. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY." />}
      <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" textContentType="emailAddress" />
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" textContentType="password" onSubmitEditing={submit} />
      {msg && <Banner text={msg} />}
      <Button title="Sign in" onPress={submit} loading={busy} disabled={!email || password.length < 6} style={{ marginTop: 8 }} />
      <Button variant="ghost" title="Forgot password?" onPress={reset} />
    </Screen>
  );
}
