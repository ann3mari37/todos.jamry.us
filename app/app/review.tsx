import { router } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { Banner, Body, Button, Card, Chip, H1, IconButton, IconCircle, Muted, Screen, type IconName } from '../src/components/ui';
import { friendlyDate } from '../src/core/dates';
import { suggestSteps } from '../src/core/templates';
import { inDays, staleTasks, type StaleAdvice, type StaleTask } from '../src/core/workload';
import { useStore } from '../src/lib/store';
import { colors, fonts } from '../src/theme';

// Tidy-up: tasks that have sat a while, one at a time, each with a suggested way forward. Every choice restarts its
// clock (reviewed_at), so the same things don't come straight back. Nothing is deleted: "Let it go" dismisses.

type Outcome = 'today' | 'dated' | 'project' | 'waiting' | 'snoozed' | 'let_go' | 'kept' | 'followed_up';

const ADVICE: Record<StaleAdvice, { label: string; icon: IconName }> = {
  follow_up: { label: 'Follow up', icon: 'send' },
  make_project: { label: 'Make it a project', icon: 'folder-plus' },
  shrink: { label: 'Break it down', icon: 'scissors' },
  let_go: { label: 'Let it go', icon: 'wind' },
  schedule: { label: 'Give it a day', icon: 'calendar' },
};

const DONE_TEXT: Record<Outcome, string> = {
  today: 'on today’s list', dated: 'given a day', project: 'turned into a project', waiting: 'marked waiting', snoozed: 'snoozed',
  let_go: 'let go', kept: 'kept as they are', followed_up: 'followed up',
};

export default function Review() {
  const store = useStore();
  // The list is fixed once the tasks have loaded, so acting on one doesn't reshuffle the rest.
  const [list, setList] = useState<StaleTask[] | null>(null);
  useEffect(() => { if (list === null && !store.loading) setList(staleTasks(store.actions, store.goals)); }, [list, store.loading, store.actions, store.goals]);
  const queue = list ?? [];
  const [i, setI] = useState(0);
  const [results, setResults] = useState<{ title: string; outcome: Outcome; id: string }[]>([]);
  const [picking, setPicking] = useState<'date' | 'snooze' | null>(null);
  const [busy, setBusy] = useState(false);
  const item = queue[i];
  const now = new Date().toISOString();

  const finish = async (outcome: Outcome, fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
    setResults((r) => [...r, { title: item.action.title, outcome, id: item.action.id }]);
    setPicking(null);
    setI((n) => n + 1);
  };
  const update = (p: Parameters<typeof store.updateAction>[1]) => store.updateAction(item.action.id, { reviewed_at: now, ...p });

  const doToday = () => finish('today', () => update({ due_date: inDays(0), deadline_type: 'target', status: 'ready', snoozed_until: null }));
  const giveDate = (days: number) => finish('dated', () => update({ due_date: inDays(days), deadline_type: 'target', snoozed_until: null }));
  const snooze = (days: number) => finish('snoozed', () => update({ snoozed_until: inDays(days) }));
  const waiting = () => finish('waiting', () => update({ status: 'waiting' }));
  const followedUp = () => finish('followed_up', () => update({ status: 'waiting' })); // still waiting; clock restarts
  const letGo = () => finish('let_go', () => update({ status: 'dismissed' }));
  const keep = () => finish('kept', () => update({}));
  const makeProject = () => finish('project', async () => {
    const a = item.action;
    const goal = await store.createGoal({ title: a.title, life_area_id: a.life_area_id ?? item.goal?.life_area_id ?? null });
    await store.createSteps(goal.id, suggestSteps(a.title).steps.slice(0, 3).map((s) => ({ title: s.title, estimated_minutes: s.minutes })), 'ready');
    await store.updateAction(a.id, { status: 'dismissed', reviewed_at: now });
  });
  const primary: Record<StaleAdvice, () => void> = {
    follow_up: followedUp, make_project: makeProject, shrink: makeProject, let_go: letGo, schedule: () => setPicking('date'),
  };

  const counts = useMemo(() => {
    const m = new Map<Outcome, number>();
    results.forEach((r) => m.set(r.outcome, (m.get(r.outcome) ?? 0) + 1));
    return [...m.entries()];
  }, [results]);
  const undoLetGo = async () => {
    for (const r of results.filter((x) => x.outcome === 'let_go')) await store.updateAction(r.id, { status: 'ready' });
    setResults((rs) => rs.map((r) => (r.outcome === 'let_go' ? { ...r, outcome: 'kept' } : r)));
  };

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
        <IconButton name="chevron-left" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.navigate('/today'))} />
        <H1 style={{ flex: 1 }}>Tidy up</H1>
        {item && <Muted>{i + 1} of {queue.length}</Muted>}
      </View>

      {list !== null && queue.length === 0 && (
        <Card style={{ alignItems: 'center', paddingVertical: 26 }}>
          <IconCircle name="check" color={colors.white} soft={colors.teal} size={44} />
          <Body style={{ fontFamily: fonts.medium, marginTop: 10 }}>Nothing has been sitting too long.</Body>
          <Button title="Back to Today" variant="ghost" onPress={() => router.navigate('/today')} />
        </Card>
      )}

      {item && (
        <>
          <Muted style={{ fontSize: 15, marginTop: 4, marginBottom: 14 }}>Decide what to do with things that have been sitting a while. No wrong answers, and nothing is deleted.</Muted>
          <Card style={{ paddingVertical: 18 }}>
            <Text style={{ fontFamily: fonts.serif, fontSize: 22, color: colors.text }}>{item.action.title}</Text>
            <Muted style={{ marginTop: 6 }}>
              {item.goal ? `${item.goal.title} · ` : ''}{item.days} days{item.action.times_skipped ? ` · skipped ${item.action.times_skipped}×` : ''}
              {item.action.due_date ? ` · was for ${friendlyDate(item.action.due_date)}` : ''}
            </Muted>
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginTop: 14, backgroundColor: colors.lavenderSoft, borderRadius: 14, padding: 12 }}>
              <IconCircle name={ADVICE[item.advice].icon} color={colors.lavender} soft={colors.white} size={32} />
              <Body style={{ flex: 1 }}>{item.why}</Body>
            </View>
          </Card>

          {picking === 'date' ? (
            <Card>
              <Body style={{ fontFamily: fonts.medium, marginBottom: 8 }}>Which day?</Body>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {[['Tomorrow', 1], ['In 3 days', 3], ['Next week', 7], ['In 2 weeks', 14]].map(([l, d]) => <Chip key={l} label={l as string} onPress={() => giveDate(d as number)} />)}
              </View>
              <Button title="Cancel" variant="ghost" onPress={() => setPicking(null)} />
            </Card>
          ) : picking === 'snooze' ? (
            <Card>
              <Body style={{ fontFamily: fonts.medium, marginBottom: 8 }}>Hide it until…</Body>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {[['1 week', 7], ['2 weeks', 14], ['1 month', 30], ['3 months', 90]].map(([l, d]) => <Chip key={l} label={l as string} onPress={() => snooze(d as number)} />)}
              </View>
              <Button title="Cancel" variant="ghost" onPress={() => setPicking(null)} />
            </Card>
          ) : (
            <>
              <Button title={ADVICE[item.advice].label} icon={ADVICE[item.advice].icon} onPress={primary[item.advice]} loading={busy} />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 }}>
                <Chip label="Do it today" onPress={doToday} />
                {item.advice !== 'schedule' && <Chip label="Give it a day" onPress={() => setPicking('date')} />}
                {item.advice !== 'make_project' && item.advice !== 'shrink' && <Chip label="Break it down" onPress={makeProject} />}
                {item.action.status !== 'waiting' && <Chip label="Waiting on someone" onPress={waiting} />}
                <Chip label="Snooze" onPress={() => setPicking('snooze')} />
                {item.advice !== 'let_go' && <Chip label="Let it go" onPress={letGo} />}
                <Chip label="Keep as is" onPress={keep} />
              </View>
              <Button title="Stop for now" variant="ghost" onPress={() => router.navigate('/today')} />
            </>
          )}
        </>
      )}

      {!item && queue.length > 0 && (
        <Card style={{ alignItems: 'center', paddingVertical: 24 }}>
          <IconCircle name="check" color={colors.white} soft={colors.teal} size={44} />
          <Text style={{ fontFamily: fonts.serif, fontSize: 22, color: colors.text, marginTop: 10 }}>All tidied up</Text>
          <Muted style={{ textAlign: 'center', marginTop: 6 }}>
            {counts.map(([o, n]) => `${n} ${o === 'project' && n > 1 ? 'turned into projects' : DONE_TEXT[o]}`).join(' · ')}
          </Muted>
          {results.some((r) => r.outcome === 'let_go') && <Button title="Undo “let go”" variant="ghost" onPress={undoLetGo} />}
          <Button title="Back to Today" onPress={() => router.navigate('/today')} style={{ marginTop: 8, alignSelf: 'stretch' }} />
        </Card>
      )}
      {busy && <Banner text="Saving…" />}
    </Screen>
  );
}
