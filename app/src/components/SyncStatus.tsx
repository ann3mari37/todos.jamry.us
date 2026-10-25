import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { useStore } from '../lib/store';
import { colors, fonts, radius } from '../theme';
import { Icon } from './ui';

// Shows whether this device has the latest data ("Synced just now · Refresh"), and says so plainly when it doesn't:
// signed out on this device, or the last load failed. Also keeps the web app itself up to date (useAutoUpdate).

function ago(iso: string | null): string {
  if (!iso) return 'not yet';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
}

/** A small line: "Synced 2 min ago · Refresh". */
export function SyncStatus() {
  const store = useStore();
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 30_000); return () => clearInterval(t); }, []);
  const refresh = async () => { setBusy(true); try { await store.refresh(); } finally { setBusy(false); } };
  const problem = store.syncError === 'signed_out' ? 'Signed out on this device' : store.syncError === 'failed' ? 'Couldn’t update' : !store.online ? 'Offline' : null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12 }}>
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: problem ? colors.pinkDeep : colors.teal }} />
      <Text style={{ fontFamily: fonts.body, fontSize: 12, color: colors.textMuted }}>{problem ? `${problem} · last synced ${ago(store.lastSynced)}` : `Synced ${ago(store.lastSynced)}`}</Text>
      <Pressable onPress={store.syncError === 'signed_out' ? () => router.push('/sign-in') : refresh} accessibilityRole="button" hitSlop={8} disabled={busy}>
        <Text style={{ fontFamily: fonts.medium, fontSize: 12, color: colors.pinkDeep }}>{busy ? 'Refreshing…' : store.syncError === 'signed_out' ? 'Sign in' : 'Refresh'}</Text>
      </Pressable>
    </View>
  );
}

/** A banner at the top of Today when this device can't get fresh data, so old data is never shown as if current. */
export function SyncProblemBanner() {
  const store = useStore();
  if (!store.syncError) return null;
  const signedOut = store.syncError === 'signed_out';
  return (
    <Pressable onPress={() => (signedOut ? router.push('/sign-in') : store.refresh())} accessibilityRole="button"
      style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.pinkWash, borderRadius: radius.md, padding: 12, marginTop: 10 }}>
      <Icon name={signedOut ? 'log-in' : 'refresh-cw'} size={16} color={colors.pinkDeep} />
      <Text style={{ flex: 1, fontFamily: fonts.medium, fontSize: 13, color: colors.pinkDeep }}>
        {signedOut ? 'You’ve been signed out on this device, so this may be old. Tap to sign in again.' : `Couldn’t load your latest data (last synced ${ago(store.lastSynced)}). Tap to try again.`}
      </Text>
    </Pressable>
  );
}

/**
 * Web only: when a newer version of the app has been deployed, reload into it, checked when the tab comes back into
 * view and every 5 minutes. Never while the person is typing.
 */
export function useAutoUpdate() {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const loaded = [...document.scripts].map((s) => s.src).find((s) => /__common-[a-f0-9]+\.js/.test(s));
    if (!loaded) return; // development build
    const check = async () => {
      try {
        const html = await (await fetch('/', { cache: 'no-store' })).text();
        const latest = html.match(/__common-[a-f0-9]+\.js/)?.[0];
        const typing = document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName);
        if (latest && !loaded.includes(latest) && !typing) window.location.reload();
      } catch { /* offline: try again later */ }
    };
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    const t = setInterval(check, 5 * 60_000);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', check);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('focus', check); };
  }, []);
}
