import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Platform, Pressable, Share, Text, View } from 'react-native';
import { useStore, type ChatConnection } from '../lib/store';
import { colors, fonts, radius } from '../theme';
import { Banner, Body, Button, Card, Divider, Icon, IconCircle, Muted, Segmented } from './ui';

// "Connect your AI chat": step-by-step setup for Claude, ChatGPT or any MCP app, with a live check that turns green
// as soon as the person allows the connection. Used in the welcome walkthrough and on the Connect screen.

// The connector lives on whichever address the app is open at (todos.jamry.us, the MaLinda Perry dashboard…).
export const CONNECTOR_URL = `${process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '')
  || (typeof window !== 'undefined' && window.location?.origin?.startsWith('https://') ? window.location.origin : 'https://todos.jamry.us')}/api/mcp`;

type App = 'claude' | 'chatgpt' | 'other';

const STEPS: Record<App, { open?: { label: string; url: string }; steps: string[]; note?: string }> = {
  claude: {
    open: { label: 'Open Claude connectors', url: 'https://claude.ai/settings/connectors' },
    steps: [
      'In Claude, open Settings → Connectors and choose “Add custom connector”.',
      'Name it Momentum and paste the address above. Leave the advanced settings empty.',
      'Choose Connect, sign in to Momentum, and tap Allow.',
      'In any chat, make sure Momentum is switched on in the tools menu (the + or sliders button).',
    ],
    note: 'Works on claude.ai, the desktop app and the phone app once it’s added. Free plans can add one custom connector; on a work plan, an owner may need to add it first.',
  },
  chatgpt: {
    open: { label: 'Open ChatGPT settings', url: 'https://chatgpt.com/#settings/Connectors' },
    steps: [
      'In ChatGPT, open Settings → Apps & Connectors. On some plans custom connectors sit under Advanced (developer mode).',
      'Create a connector named Momentum with the address above, using OAuth sign-in.',
      'Sign in to Momentum when asked and tap Allow.',
      'Pick Momentum from the tools menu in a chat.',
    ],
    note: 'ChatGPT’s menus change between plans, so the names may differ slightly.',
  },
  other: {
    steps: [
      'Look for “connectors”, “MCP servers” or “integrations” in your AI app’s settings.',
      'Add a remote (HTTP) connector with the address above. Sign-in is OAuth, so no key is needed.',
      'Sign in to Momentum when asked and tap Allow.',
    ],
  },
};

export const TRY_PROMPTS = [
  'Help me figure out what I actually need to get done this week, then send the plan to Momentum.',
  'I have a lot on my mind. Ask me a few questions, sort it into projects and tasks, and hand it off to Momentum.',
  'What should I work on today? Check Momentum.',
];

async function copy(text: string): Promise<boolean> {
  if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through to share */ }
  }
  await Share.share({ message: text }).catch(() => {});
  return false;
}

export function CopyBox({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <Pressable
      onPress={async () => { if (await copy(text)) { setDone(true); setTimeout(() => setDone(false), 1800); } }}
      accessibilityRole="button" accessibilityLabel={label}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.bg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 10, marginVertical: 6 }}
    >
      <Text selectable style={{ flex: 1, fontFamily: fonts.medium, color: colors.text, fontSize: 14 }}>{text}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Icon name={done ? 'check' : 'copy'} size={16} color={done ? colors.teal : colors.pinkDeep} />
        <Text style={{ fontFamily: fonts.medium, fontSize: 12, color: done ? colors.teal : colors.pinkDeep }}>{done ? 'Copied' : Platform.OS === 'web' ? 'Copy' : 'Share'}</Text>
      </View>
    </Pressable>
  );
}

/** Polls the person's allowed AI apps while visible, so the screen reacts the moment they tap Allow. */
export function useChatConnections(poll = true) {
  const store = useStore();
  const [list, setList] = useState<ChatConnection[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const load = useCallback(async () => {
    try { setList(await store.chatConnections()); setUnavailable(false); } catch { setUnavailable(true); setList((l) => l ?? []); }
  }, [store.chatConnections]);
  useEffect(() => {
    load();
    if (!poll) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load, poll]);
  return { list, unavailable, reload: load };
}

export function ConnectChat({ compact }: { compact?: boolean }) {
  const store = useStore();
  const [app, setApp] = useState<App>('claude');
  const { list, unavailable, reload } = useChatConnections();
  const first = useRef<number | null>(null);
  if (list && first.current === null) first.current = list.length;
  const justConnected = !!list && first.current !== null && list.length > first.current;
  const guide = STEPS[app];

  return (
    <View>
      {list && list.length > 0 && (
        <Card style={{ backgroundColor: colors.tealSoft, borderColor: colors.tealSoft }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <IconCircle name="check" color={colors.white} soft={colors.teal} size={30} />
            <Body style={{ fontFamily: fonts.medium, flex: 1 }}>{justConnected ? `${list[list.length - 1].name} is connected!` : 'Connected'}</Body>
          </View>
          {list.map((c, i) => (
            <View key={c.client_id}>
              {i > 0 && <Divider />}
              <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8 }}>
                <View style={{ flex: 1 }}>
                  <Body>{c.name}</Body>
                  <Muted>Allowed {new Date(c.granted_at).toLocaleDateString()}</Muted>
                </View>
                <Pressable onPress={async () => { await store.revokeChat(c.client_id).catch(() => {}); reload(); }} accessibilityRole="button" accessibilityLabel={`Disconnect ${c.name}`} hitSlop={8}>
                  <Text style={{ fontFamily: fonts.medium, color: colors.pinkDeep }}>Disconnect</Text>
                </Pressable>
              </View>
            </View>
          ))}
          <Muted style={{ marginTop: 6 }}>Try saying this in a new chat:</Muted>
          {TRY_PROMPTS.slice(0, compact ? 1 : 3).map((p) => <CopyBox key={p} text={p} label="Copy this prompt" />)}
        </Card>
      )}

      <Card>
        <Muted style={{ fontFamily: fonts.medium, color: colors.text, marginBottom: 8 }}>Which AI do you use?</Muted>
        <Segmented value={app} onChange={setApp} options={[{ value: 'claude', label: 'Claude' }, { value: 'chatgpt', label: 'ChatGPT' }, { value: 'other', label: 'Other' }]} />
        <Muted style={{ fontFamily: fonts.medium, color: colors.text, marginTop: 14 }}>Momentum’s connector address</Muted>
        <CopyBox text={CONNECTOR_URL} label="Copy the connector address" />
        {guide.steps.map((s, i) => (
          <View key={s} style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
            <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: colors.pinkWash, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontFamily: fonts.semibold, fontSize: 12, color: colors.pinkDeep }}>{i + 1}</Text>
            </View>
            <Body style={{ flex: 1 }}>{s}</Body>
          </View>
        ))}
        {guide.open && <Button title={guide.open.label} icon="external-link" variant="soft" onPress={() => Linking.openURL(guide.open!.url)} style={{ marginTop: 14 }} />}
        {guide.note && <Muted style={{ marginTop: 10 }}>{guide.note}</Muted>}
      </Card>

      {list && list.length === 0 && !unavailable && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4, marginBottom: 8 }}>
          <Icon name="loader" size={14} color={colors.textMuted} />
          <Muted style={{ flex: 1 }}>Waiting for you to tap Allow… this updates by itself.</Muted>
        </View>
      )}
      {unavailable && <Banner tone="soft" text="Chat connections aren’t switched on for Momentum yet. You can still set this up later from Settings." />}

      {!compact && (
        <Card>
          <Body style={{ fontFamily: fonts.medium, marginBottom: 6 }}>How the handoff works</Body>
          <Muted>Talk things through with your AI as usual. When you say “send it to Momentum”, the plan lands on your Today screen as “From chat”. Nothing is added until you review it. Your AI can also read your lists to answer “what should I do next?”, and it never sees your email.</Muted>
        </Card>
      )}
    </View>
  );
}
