import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, Platform, Pressable, Switch, Text, View } from 'react-native';
import { Banner, Body, Button, Card, Chip, Divider, Field, H1, Icon, IconButton, Muted, Row, Screen, Sheet, type IconName } from '../src/components/ui';
import { friendlyAiError } from '../src/lib/api';
import { useStore, type EmailAccount } from '../src/lib/store';
import { colors, fonts, radius } from '../src/theme';

// IMAP presets for popular providers. All require an app-specific password (the account password won't work with 2FA on).
const IMAP_PRESETS: { key: string; label: string; host: string; archive: string; help: string }[] = [
  { key: 'icloud', label: 'iCloud', host: 'imap.mail.me.com', archive: 'Archive', help: 'Create one at appleid.apple.com → Sign-In and Security → App-Specific Passwords.' },
  { key: 'yahoo', label: 'Yahoo', host: 'imap.mail.yahoo.com', archive: 'Archive', help: 'Yahoo Account Security → Generate app password.' },
  { key: 'fastmail', label: 'Fastmail', host: 'imap.fastmail.com', archive: 'Archive', help: 'Settings → Privacy & Security → App passwords (IMAP access).' },
  { key: 'aol', label: 'AOL', host: 'imap.aol.com', archive: 'Archive', help: 'Account Security → Generate app password.' },
  { key: 'gmail-imap', label: 'Gmail (IMAP)', host: 'imap.gmail.com', archive: '[Gmail]/All Mail', help: 'Google Account → Security → App passwords (needs 2-Step Verification).' },
  { key: 'custom', label: 'Other', host: '', archive: 'Archive', help: 'Use the IMAP server and app password from your provider (port 993, SSL).' },
];

const PROVIDER_META: Record<EmailAccount['provider'], { label: string; icon: IconName }> = {
  gmail: { label: 'Gmail', icon: 'mail' },
  outlook: { label: 'Outlook', icon: 'inbox' },
  imap: { label: 'IMAP', icon: 'server' },
};

const ERRORS: Record<string, string> = {
  access_denied: 'Permission was not granted, so nothing was connected.',
  no_offline_access: 'The provider did not allow ongoing access. Please try again and accept all permissions.',
  invalid_state: 'That sign-in link expired. Please try again.',
  state_expired: 'That sign-in link expired. Please try again.',
};

function ago(iso: string | null) {
  if (!iso) return 'not synced yet';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  return m < 1 ? 'synced just now' : m < 60 ? `synced ${m} min ago` : m < 1440 ? `synced ${Math.round(m / 60)} h ago` : `synced ${Math.round(m / 1440)} d ago`;
}

export default function EmailAccounts() {
  const store = useStore();
  const params = useLocalSearchParams<{ connected?: string; email_error?: string; add?: string }>();
  const [adding, setAdding] = useState(params.add === '1');
  const [imap, setImap] = useState<(typeof IMAP_PRESETS)[number] | null>(null);
  const [areaFor, setAreaFor] = useState<EmailAccount | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [available, setAvailable] = useState<{ gmail: boolean; outlook: boolean; imap: boolean } | null>(null);
  // null while loading; false when this server can't connect any inbox yet.
  const canConnect = available ? available.gmail || available.outlook || available.imap : null;

  useEffect(() => {
    if (params.connected) { setNotice(`${params.connected === 'gmail' ? 'Gmail' : 'Outlook'} connected. Syncing your recent mail…`); store.refresh().then(() => store.emailSync(true)).catch(() => {}); }
    else if (params.email_error) setNotice(ERRORS[params.email_error] ?? "Couldn't connect that account. Please try again.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.connected, params.email_error]);
  useEffect(() => { store.emailProviders().then(setAvailable).catch(() => setAvailable(null)); }, [store.emailProviders]);

  const connect = async (provider: 'gmail' | 'outlook') => {
    try { await store.emailConnect(provider); } catch (e) { setNotice(friendlyAiError(e)); setAdding(false); }
  };

  const confirmDisconnect = (a: EmailAccount) => {
    const go = () => store.emailDisconnect(a.id).catch((e) => setNotice(friendlyAiError(e)));
    const msg = 'Momentum stops reading this inbox and forgets its summaries. Tasks you created stay. Nothing in your mailbox is deleted.';
    if (Platform.OS === 'web') { if (window.confirm(`Disconnect ${a.email_address}? ${msg}`)) go(); }
    else Alert.alert(`Disconnect ${a.email_address}?`, msg, [{ text: 'Cancel', style: 'cancel' }, { text: 'Disconnect', style: 'destructive', onPress: go }]);
  };

  const digestOn = store.profile?.email_digest_enabled !== false;

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
        <IconButton name="chevron-left" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.navigate('/inbox'))} />
        <H1 style={{ flex: 1 }}>Email Accounts</H1>
        <IconButton name="plus" label="Add email account" onPress={() => setAdding(true)} />
      </View>
      <Muted style={{ marginBottom: 12 }}>Connect as many inboxes as you like. Momentum reads recent mail to summarize it and suggest tasks. It never sends or deletes email.</Muted>
      {notice && <Banner text={notice} />}

      {store.emailAccounts.map((a) => {
        const area = store.lifeAreas.find((x) => x.id === a.life_area_id);
        const meta = PROVIDER_META[a.provider];
        return (
          <Card key={a.id} style={{ paddingVertical: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 }}>
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: `${a.color}22`, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={meta.icon} size={19} color={a.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Body style={{ fontFamily: fonts.medium }} numberOfLines={1}>{a.display_name || a.email_address}</Body>
                <Muted numberOfLines={1}>{a.display_name ? `${a.email_address} · ` : ''}{meta.label} · {a.status === 'active' ? ago(a.last_synced_at) : a.status === 'needs_reauth' ? 'needs reconnecting' : 'sync problem'}</Muted>
              </View>
              {a.status !== 'active' && <Icon name="alert-triangle" size={18} color={colors.pinkDeep} />}
            </View>
            {a.status === 'needs_reauth' && a.provider !== 'imap' && (
              <Button title="Reconnect" variant="soft" style={{ minHeight: 42, marginBottom: 8 }} onPress={() => connect(a.provider as 'gmail' | 'outlook')} />
            )}
            <Divider />
            <Row title="Default life area" subtitle="Tasks from this inbox go here unless AI finds a better fit" value={area?.name ?? 'Let AI decide'} onPress={() => setAreaFor(a)} />
            <Divider />
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, minHeight: 52 }}>
              <Body style={{ flex: 1, fontFamily: fonts.medium }}>Include in daily digest</Body>
              <Switch value={a.digest_enabled} onValueChange={(v) => store.updateEmailAccount(a.id, { digest_enabled: v })} trackColor={{ true: colors.teal }} accessibilityLabel={`Include ${a.email_address} in daily digest`} />
            </View>
            <Divider />
            <Pressable onPress={() => confirmDisconnect(a)} accessibilityRole="button" style={{ paddingVertical: 12, minHeight: 44 }}>
              <Text style={{ fontFamily: fonts.medium, color: colors.pinkDeep }}>Disconnect</Text>
            </Pressable>
          </Card>
        );
      })}

      {canConnect === false ? (
        // Nothing can be connected on this server yet: say so instead of offering buttons that can't work.
        <Card style={{ alignItems: 'center', paddingVertical: 24 }}>
          <Icon name="mail" size={26} color={colors.textFaint} />
          <Body style={{ fontFamily: fonts.medium, marginTop: 8 }}>Email isn't available yet</Body>
          <Muted style={{ textAlign: 'center', marginTop: 4, maxWidth: 320 }}>Connecting inboxes hasn't been switched on for this app. Everything else works without it.</Muted>
        </Card>
      ) : (
        <>
          {store.emailAccounts.length === 0 && (
            <Card style={{ alignItems: 'center', paddingVertical: 24 }}>
              <Icon name="mail" size={26} color={colors.pink} />
              <Body style={{ fontFamily: fonts.medium, marginTop: 8 }}>No inboxes connected yet</Body>
            </Card>
          )}
          <Button title="Add an email account" icon="plus" variant={store.emailAccounts.length ? 'soft' : 'primary'} onPress={() => setAdding(true)} style={{ marginTop: 4 }} />
        </>
      )}

      <Card style={{ marginTop: 16, paddingVertical: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, minHeight: 52, gap: 12 }}>
          <Icon name="sun" size={20} color={colors.pink} />
          <View style={{ flex: 1 }}>
            <Body style={{ fontFamily: fonts.medium }}>Morning inbox digest</Body>
            <Muted>A short summary of new mail on Today, every morning</Muted>
          </View>
          <Switch value={digestOn} onValueChange={(v) => store.updateProfile({ email_digest_enabled: v })} trackColor={{ true: colors.teal }} accessibilityLabel="Morning inbox digest" />
        </View>
      </Card>
      <Muted style={{ marginTop: 8, fontSize: 12 }}>
        Privacy: subjects, senders and short previews are sent to the AI to summarize and sort mail. Whole threads are only read when you tap “Summarize the whole thread”. Email bodies are never stored, and passwords and tokens are encrypted.
      </Muted>

      <Sheet visible={adding && !imap} onClose={() => setAdding(false)} title="Add an email account">
        {/* Only connections this server can actually make are shown. */}
        {available?.gmail && <ProviderButton icon="mail" title="Gmail or Google Workspace" subtitle="Sign in with Google" onPress={() => connect('gmail')} />}
        {available?.outlook && <ProviderButton icon="inbox" title="Outlook, Hotmail or Microsoft 365" subtitle="Sign in with Microsoft" onPress={() => connect('outlook')} />}
        {available?.imap && (
          <>
            <Text style={{ fontFamily: fonts.semibold, fontSize: 13, color: colors.textMuted, marginTop: available.gmail || available.outlook ? 14 : 0, marginBottom: 6 }}>
              {available.gmail || available.outlook ? 'OTHER PROVIDERS' : 'CHOOSE YOUR EMAIL PROVIDER'}
            </Text>
            <Muted style={{ marginBottom: 8 }}>Connect with an app password from your provider.</Muted>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {IMAP_PRESETS.filter((p) => !(p.key === 'gmail-imap' && available.gmail)).map((p) => <Chip key={p.key} label={p.label} onPress={() => setImap(p)} />)}
            </View>
          </>
        )}
      </Sheet>

      <ImapSheet preset={imap} onClose={() => setImap(null)} onDone={() => { setImap(null); setAdding(false); setNotice('Connected. Syncing your recent mail…'); store.emailSync(true).catch(() => {}); }} />

      <Sheet visible={!!areaFor} onClose={() => setAreaFor(null)} title="Default life area">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          <Chip label="Let AI decide" selected={!areaFor?.life_area_id} onPress={() => { store.updateEmailAccount(areaFor!.id, { life_area_id: null }); setAreaFor(null); }} />
          {store.lifeAreas.filter((a) => !a.archived_at).map((a) => (
            <Chip key={a.id} label={a.name} selected={areaFor?.life_area_id === a.id} onPress={() => { store.updateEmailAccount(areaFor!.id, { life_area_id: a.id }); setAreaFor(null); }} />
          ))}
        </View>
      </Sheet>
    </Screen>
  );
}

function ProviderButton({ icon, title, subtitle, onPress }: { icon: IconName; title: string; subtitle: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button"
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, marginBottom: 10 }, pressed && { opacity: 0.7 }]}>
      <Icon name={icon} size={22} color={colors.pink} />
      <View style={{ flex: 1 }}>
        <Body style={{ fontFamily: fonts.medium }}>{title}</Body>
        <Muted>{subtitle}</Muted>
      </View>
      <Icon name="chevron-right" size={18} color={colors.textFaint} />
    </Pressable>
  );
}

function ImapSheet({ preset, onClose, onDone }: { preset: (typeof IMAP_PRESETS)[number] | null; onClose: () => void; onDone: () => void }) {
  const store = useStore();
  const [email, setEmail] = useState('');
  const [host, setHost] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [archive, setArchive] = useState('Archive');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (preset) { setHost(preset.host); setArchive(preset.archive); setError(null); setPassword(''); } }, [preset]);
  if (!preset) return <Sheet visible={false} onClose={onClose}>{null}</Sheet>;

  const save = async () => {
    setBusy(true); setError(null);
    try {
      await store.emailConnectImap({ email: email.trim(), host: host.trim(), port: 993, username: (username || email).trim(), password, archive_folder: archive.trim() || 'Archive' });
      setPassword('');
      onDone();
    } catch (e) {
      setError(friendlyAiError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible onClose={onClose} title={`Connect ${preset.label}`}>
      <Muted style={{ marginBottom: 12 }}>{preset.help}</Muted>
      <Field label="Email address" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
      <Field label="App password" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoComplete="off" />
      {preset.key === 'custom' && <Field label="IMAP server" value={host} onChangeText={setHost} autoCapitalize="none" placeholder="imap.example.com" />}
      {preset.key === 'custom' && <Field label="Username (if different from email)" value={username} onChangeText={setUsername} autoCapitalize="none" />}
      <Field label="Archive folder" value={archive} onChangeText={setArchive} autoCapitalize="none" />
      {error && <Banner tone="soft" text={error} />}
      <Button title="Connect" loading={busy} disabled={!email.includes('@') || !password || !host} onPress={save} />
      <Button title="Back" variant="ghost" onPress={onClose} />
    </Sheet>
  );
}
