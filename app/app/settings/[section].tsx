import { File, Paths } from 'expo-file-system';
import { router, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import React, { useEffect, useState } from 'react';
import { Alert, Platform, Switch, View } from 'react-native';
import { Banner, Body, Button, Card, Chip, Divider, Field, H1, IconButton, Label, Muted, Screen } from '../../src/components/ui';
import { useStore } from '../../src/lib/store';
import { supabase } from '../../src/lib/supabase';
import { colors, fonts } from '../../src/theme';

const TITLES: Record<string, string> = {
  ai: 'AI Preferences', notifications: 'Notifications', privacy: 'Privacy & Data', appearance: 'Appearance', voice: 'Voice & Input', help: 'Help & Feedback',
};

function Toggle({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, minHeight: 52 }}>
      <View style={{ flex: 1 }}>
        <Body style={{ fontFamily: fonts.medium }}>{label}</Body>
        {hint && <Muted>{hint}</Muted>}
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.teal }} accessibilityLabel={label} />
    </View>
  );
}

function confirm(title: string, msg: string, onYes: () => void) {
  if (Platform.OS === 'web') { if (window.confirm(`${title}\n\n${msg}`)) onYes(); return; }
  Alert.alert(title, msg, [{ text: 'Cancel', style: 'cancel' }, { text: 'Continue', style: 'destructive', onPress: onYes }]);
}

export default function Settings() {
  const { section = 'ai' } = useLocalSearchParams<{ section: string }>();
  const store = useStore();
  const p = store.profile;
  const acc = store.accountability;
  const n = store.notifications;
  const [usage, setUsage] = useState<{ count: number; cost: number } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (section !== 'ai') return;
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    supabase.from('ai_operations').select('cost_usd').gte('created_at', since).then(({ data }) =>
      setUsage({ count: data?.length ?? 0, cost: (data ?? []).reduce((s, r) => s + Number(r.cost_usd ?? 0), 0) }));
  }, [section]);

  const exportData = async () => {
    const { data, error } = await supabase.rpc('export_my_data');
    if (error) return setMsg(error.message);
    const json = JSON.stringify(data, null, 2);
    const name = `momentum-export-${new Date().toISOString().slice(0, 10)}.json`;
    if (Platform.OS === 'web') {
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url; a.download = name; a.click();
      URL.revokeObjectURL(url);
    } else {
      const f = new File(Paths.cache, name);
      f.write(json);
      await Sharing.shareAsync(f.uri, { mimeType: 'application/json' });
    }
  };

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, marginBottom: 6 }}>
        <IconButton name="chevron-left" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.navigate('/more'))} />
        <H1 style={{ flex: 1 }}>{TITLES[section] ?? 'Settings'}</H1>
      </View>
      {msg && <Banner text={msg} />}

      {section === 'ai' && p && (
        <>
          <Card>
            <Toggle label="Use AI" hint="Organizes captures, suggests next steps, writes reflections." value={p.ai_enabled} onChange={(v) => store.updateProfile({ ai_enabled: v })} />
            <Muted>When on, the text of what you capture and relevant project details are sent to the OpenAI API for processing. Keys and data access stay on the server. With AI off, everything still works — you organize things yourself.</Muted>
          </Card>
          <Label>Preferred step size</Label>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {[5, 10, 15, 30, 60].map((m) => <Chip key={m} label={`${m} min`} selected={p.preferred_action_minutes === m} onPress={() => store.updateProfile({ preferred_action_minutes: m })} />)}
          </View>
          <Label>Tone</Label>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {(['warm', 'neutral', 'brief'] as const).map((t) => <Chip key={t} label={t[0].toUpperCase() + t.slice(1)} selected={p.tone === t} onPress={() => store.updateProfile({ tone: t })} />)}
          </View>
          <Card style={{ marginTop: 12 }}>
            <Toggle label="Auto-organize new tasks" hint="AI files what you capture into the right project and life area. You can undo any change." value={p.auto_organize !== false} onChange={(v) => store.updateProfile({ auto_organize: v })} />
          </Card>
          {store.organizeRuns.length > 0 && (
            <>
              <Label>Recent organizing</Label>
              <Card style={{ paddingVertical: 4 }}>
                {store.organizeRuns.slice(0, 5).map((r, i) => (
                  <View key={r.id}>
                    {i > 0 && <Divider />}
                    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 10 }}>
                      <View style={{ flex: 1 }}>
                        <Body style={{ fontFamily: fonts.medium }}>{r.changes.length} item{r.changes.length === 1 ? '' : 's'} organized{r.created_goal_ids.length ? `, ${r.created_goal_ids.length} new project${r.created_goal_ids.length === 1 ? '' : 's'}` : ''}</Body>
                        <Muted>{new Date(r.created_at).toLocaleString()} · {r.trigger === 'manual' ? 'you asked' : r.trigger === 'email' ? 'from email' : 'automatic'}{r.undone_at ? ' · undone' : ''}</Muted>
                      </View>
                      {!r.undone_at && <Button variant="ghost" title="Undo" style={{ minHeight: 40, paddingHorizontal: 12 }} onPress={() => store.organizeUndo(r.id).then(() => setMsg('Undone.')).catch(() => setMsg("Couldn't undo right now."))} />}
                    </View>
                  </View>
                ))}
              </Card>
            </>
          )}
          <Card style={{ marginTop: 12 }}>
            <Toggle label="Weekly reflection" hint="An optional look back each Monday." value={p.weekly_reflection_enabled} onChange={(v) => store.updateProfile({ weekly_reflection_enabled: v })} />
          </Card>
          <Button variant="ghost" title="Reset what Momentum has learned" onPress={() => confirm('Reset personalization?', 'Learned preferences and suggestion feedback will be cleared. Your goals and history are not affected.', async () => {
            await store.updateProfile({ learned_preferences: {} });
            await supabase.from('recommendation_feedback').delete().eq('user_id', store.session!.user.id);
            setMsg('Personalization reset.');
          })} />
          {usage && <Muted style={{ textAlign: 'center' }}>Last 30 days: {usage.count} AI requests · about ${usage.cost.toFixed(2)}</Muted>}
        </>
      )}

      {section === 'notifications' && acc && n && (
        <>
          <Label>Gentle check-ins</Label>
          <Card>
            <Toggle label="Notice quiet goals" hint="Occasionally offers help with a meaningful goal that hasn't moved. Never for paused or waiting goals." value={acc.enabled} onChange={(v) => store.updateAccountability({ enabled: v })} />
            <Divider />
            <Muted style={{ marginTop: 10, marginBottom: 6 }}>Consider a goal quiet after</Muted>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {[5, 7, 10, 14, 21, 30].map((d) => <Chip key={d} label={`${d} days`} selected={acc.inactivity_days === d} onPress={() => store.updateAccountability({ inactivity_days: d })} />)}
            </View>
            <Muted style={{ marginBottom: 6 }}>At most, per week</Muted>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {[0, 1, 2, 3].map((d) => <Chip key={d} label={d === 0 ? 'None' : `${d}`} selected={acc.max_nudges_per_week === d} onPress={() => store.updateAccountability({ max_nudges_per_week: d })} />)}
            </View>
          </Card>
          <Label>Notifications</Label>
          <Card>
            <Toggle label="Real deadlines" value={n.deadlines} onChange={(v) => store.updateNotifications({ deadlines: v })} />
            <Divider />
            <Toggle label="Meaningful goal reminders" value={n.meaningful_reminders} onChange={(v) => store.updateNotifications({ meaningful_reminders: v })} />
            <Divider />
            <Toggle label="Follow up on waiting items" value={n.waiting_followups} onChange={(v) => store.updateNotifications({ waiting_followups: v })} />
            <Divider />
            <Toggle label="Weekly reflection ready" value={n.weekly_reflection} onChange={(v) => store.updateNotifications({ weekly_reflection: v })} />
          </Card>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}><Field label="Quiet from" value={n.quiet_start.slice(0, 5)} onChangeText={(v) => /^\d{2}:\d{2}$/.test(v) && store.updateNotifications({ quiet_start: v })} /></View>
            <View style={{ flex: 1 }}><Field label="Until" value={n.quiet_end.slice(0, 5)} onChangeText={(v) => /^\d{2}:\d{2}$/.test(v) && store.updateNotifications({ quiet_end: v })} /></View>
          </View>
          <Muted>No streaks, no guilt, no daily pressure. Check-ins appear on Today; push delivery arrives with the iOS app build.</Muted>
        </>
      )}

      {section === 'privacy' && (
        <>
          <Card>
            <Body>Your data lives in your own Supabase database, protected so only your account can read it. AI requests go through your own Cloudflare Worker; the OpenAI key never reaches this device.</Body>
            <Muted style={{ marginTop: 8 }}>With AI on, captured text and relevant project details are sent to the OpenAI API. Operational logs record only counts, timing and cost — never your content.</Muted>
          </Card>
          <Button title="Export all my data" icon="download" variant="soft" onPress={exportData} />
          <Button title="Delete all my data" variant="ghost" style={{ marginTop: 8 }} onPress={() => confirm('Delete everything?', 'All goals, actions, accomplishments and history will be permanently deleted. Consider exporting first.', async () => {
            await store.deleteAllData();
            setMsg('All data deleted.');
          })} />
        </>
      )}

      {section === 'appearance' && (
        <Card>
          <Body>Momentum follows your device's text size and “Reduce Motion” settings. When Reduce Motion is on, celebrations are shown without animation.</Body>
          <Muted style={{ marginTop: 8 }}>Custom themes are planned for later.</Muted>
        </Card>
      )}

      {section === 'voice' && (
        <Card>
          <Body>Tap Speak on the Capture screen and talk naturally — several things at once is fine.</Body>
          <Muted style={{ marginTop: 8 }}>In the browser, your browser's speech recognition is used when available. On iPhone, a short recording is transcribed by OpenAI through your server, then deleted. You can always use the keyboard's microphone instead.</Muted>
        </Card>
      )}

      {section === 'help' && (
        <Card>
          <Body style={{ fontFamily: fonts.semibold }}>How Momentum works</Body>
          <Muted style={{ marginTop: 6 }}>• Capture anything — goals, tasks, or things you already did.{'\n'}• Projects reveal just the next two or three steps.{'\n'}• Today suggests a few things. Finish them and you're done — nothing refills unless you ask.{'\n'}• Everything you do counts. Meaningful progress is tracked separately so important goals don't get lost.{'\n'}• Dates are optional. Only hard deadlines create urgency.</Muted>
        </Card>
      )}
    </Screen>
  );
}
