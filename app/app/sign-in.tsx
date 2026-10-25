import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';
import { FlowerArt } from '../src/components/FlowerArt';
import { Banner, Button, Field, H1, IconButton, Muted, Screen } from '../src/components/ui';
import { isConfigured, supabase } from '../src/lib/supabase';

export default function SignIn() {
  const params = useLocalSearchParams<{ mode?: string }>();
  const [mode, setMode] = useState<'signin' | 'signup'>(params.mode === 'signup' ? 'signup' : 'signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setMsg(null);
    const fn = mode === 'signup' ? supabase.auth.signUp({ email: email.trim(), password }) : supabase.auth.signInWithPassword({ email: email.trim(), password });
    const { data, error } = await fn;
    setBusy(false);
    if (error) return setMsg(error.message);
    if (mode === 'signup' && !data.session) return setMsg('Check your email to confirm your account, then sign in.');
    router.replace('/today');
  };

  const reset = async () => {
    if (!email.trim()) return setMsg('Enter your email first.');
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
    setMsg(error ? error.message : 'A reset link is on its way.');
  };

  return (
    <Screen>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <IconButton name="chevron-left" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/welcome'))} />
        <FlowerArt slot="celebrate" width={120} height={120} seed={1.2} />
      </View>
      <H1>{mode === 'signup' ? 'Welcome to Momentum' : 'Welcome back'}</H1>
      <Muted style={{ marginBottom: 22, fontSize: 15 }}>Small steps. Big change.</Muted>
      {!isConfigured && <Banner tone="soft" text="Supabase isn't configured yet. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY." />}
      <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" textContentType="emailAddress" />
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} textContentType={mode === 'signup' ? 'newPassword' : 'password'} onSubmitEditing={submit} />
      {msg && <Banner text={msg} />}
      <Button title={mode === 'signup' ? 'Create account' : 'Sign in'} onPress={submit} loading={busy} disabled={!email || password.length < 6} style={{ marginTop: 8 }} />
      <Button variant="ghost" title={mode === 'signup' ? 'I already have an account' : 'Create an account'} onPress={() => setMode(mode === 'signup' ? 'signin' : 'signup')} />
      {mode === 'signin' && <Button variant="ghost" title="Forgot password?" onPress={reset} />}
    </Screen>
  );
}
