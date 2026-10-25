import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Banner, Body, Button, Card, Chip, H1, Icon, IconButton, IconCircle, Muted, Screen, type IconName } from '../src/components/ui';
import { draftsToCommit } from '../src/core/handoff';
import { daysUntil, friendlyDate, startOfDay, toISODate } from '../src/core/dates';
import { fallbackInterpret } from '../src/core/fallback-capture';
import { recommend } from '../src/core/recommend';
import type { Action } from '../src/core/types';
import { inDays, minutesOf } from '../src/core/workload';
import { useStore, uuid } from '../src/lib/store';
import { colors, fonts, radius, shadow } from '../src/theme';

// "Start my day" and "End my day": short, skippable check-ins the person opens when their day actually starts or ends.
// Start: room and energy shape Today; anything new gets captured; today's dates get a yes / tomorrow / done.
// End: celebrate what got done, add unplanned wins, settle leftovers, pick tomorrow's first thing.

type Room = 30 | 90 | 180 | null;
type Energy = 'low' | 'okay' | 'high';

const ROOM: { value: Room; label: string; sub: string }[] = [
  { value: 30, label: 'A little', sub: 'under 30 min' },
  { value: 90, label: 'Some', sub: '1–2 hours' },
  { value: 180, label: 'A good chunk', sub: '3+ hours' },
  { value: null, label: 'Not sure', sub: 'pick a few for me' },
];
const ENERGY: { value: Energy; label: string; icon: IconName; sub: string }[] = [
  { value: 'low', label: 'Running low', icon: 'battery', sub: 'Quick, easy things first' },
  { value: 'okay', label: 'Okay', icon: 'sun', sub: 'A normal mix' },
  { value: 'high', label: 'Ready to go', icon: 'zap', sub: 'Room for something meaningful' },
];

const OPEN: Action['status'][] = ['ready', 'in_progress', 'waiting', 'blocked'];

export default function Day() {
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  return mode === 'end' ? <EndDay /> : <StartDay />;
}

function Steps({ n, of }: { n: number; of: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 6, marginVertical: 12 }}>
      {Array.from({ length: of }, (_, i) => <View key={i} style={{ flex: 1, height: 5, borderRadius: 3, backgroundColor: i <= n ? colors.pink : colors.pinkWash }} />)}
    </View>
  );
}

function Header({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
      <IconButton name="x" label="Close" onPress={onClose} />
      <H1 style={{ flex: 1, fontSize: 26 }}>{title}</H1>
    </View>
  );
}

function Option({ selected, onPress, icon, label, sub }: { selected: boolean; onPress: () => void; icon?: IconName; label: string; sub: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected }}
      style={[{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: radius.lg, borderWidth: 1.5, marginBottom: 10,
        borderColor: selected ? colors.pink : colors.border, backgroundColor: selected ? colors.pinkWash : colors.card }]}>
      {icon && <IconCircle name={icon} color={colors.pink} soft={selected ? colors.white : colors.pinkWash} size={36} />}
      <View style={{ flex: 1 }}>
        <Body style={{ fontFamily: fonts.medium }}>{label}</Body>
        <Muted>{sub}</Muted>
      </View>
      {selected && <Icon name="check" color={colors.pink} />}
    </Pressable>
  );
}

/** A quick text box that sorts what's typed the same way Capture does, and saves it. */
function QuickCapture({ asWins, placeholder, onSaved }: { asWins?: boolean; placeholder: string; onSaved: (n: number) => void }) {
  const store = useStore();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const goals = store.goals.filter((g) => ['active', 'waiting', 'blocked'].includes(g.status));
  const items = useMemo(() => (text.trim() ? fallbackInterpret(text, store.lifeAreas, goals).items : [])
    .map((i) => (asWins ? { ...i, kind: 'accomplishment' as const, deadline: null, deadline_type: 'none' as const } : i)), [text, store.lifeAreas, goals, asWins]);
  const save = async () => {
    setBusy(true);
    try {
      await store.commitCapture(text, asWins ? 'accomplishment' : 'text', null, draftsToCommit(items.map((i) => ({ ...i, meaning: '', client_id: uuid() }))));
      onSaved(items.length);
      setText('');
    } finally { setBusy(false); }
  };
  return (
    <>
      <View style={[{ backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 8 }, shadow]}>
        <TextInput value={text} onChangeText={setText} multiline placeholder={placeholder} placeholderTextColor={colors.textFaint} accessibilityLabel={placeholder}
          style={{ fontFamily: fonts.body, fontSize: 16, color: colors.text, minHeight: 60, textAlignVertical: 'top' }} />
      </View>
      {items.map((p, n) => (
        <View key={n} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 }}>
          <Icon name={p.kind === 'accomplishment' ? 'check-circle' : p.kind === 'goal' ? 'folder' : 'arrow-right-circle'} size={16} color={colors.teal} />
          <Body style={{ flex: 1 }}>{p.title}</Body>
          <Muted>{p.kind === 'accomplishment' ? 'done' : p.kind === 'goal' ? 'project' : p.deadline ? friendlyDate(p.deadline) : p.estimated_minutes ? `${p.estimated_minutes} min` : ''}</Muted>
        </View>
      ))}
      {items.length > 0 && <Button title={asWins ? `Add ${items.length === 1 ? 'it' : `these ${items.length}`} to today’s wins` : `Add ${items.length === 1 ? 'it' : `these ${items.length}`}`} variant="soft" onPress={save} loading={busy} style={{ marginTop: 6 }} />}
    </>
  );
}

// ───────────────────────── Start my day

function StartDay() {
  const store = useStore();
  const today = toISODate(new Date());
  const [step, setStep] = useState(0);
  const [room, setRoom] = useState<Room | undefined>(undefined);
  const [energy, setEnergy] = useState<Energy | null>(null);
  const [added, setAdded] = useState(0);
  const [decided, setDecided] = useState<Record<string, string>>({});
  const close = () => router.navigate('/today');

  // Anything dated today or earlier that's still open: still happening today?
  const dueNow = useMemo(() => store.actions
    .filter((a) => OPEN.includes(a.status) && a.due_date && a.deadline_type !== 'none' && daysUntil(a.due_date) <= 0)
    .sort((x, y) => (x.due_date ?? '').localeCompare(y.due_date ?? '')), [store.actions]); // eslint-disable-line react-hooks/exhaustive-deps
  const steps = dueNow.length ? 4 : 3;

  const finish = async () => {
    await store.saveCheckin(today, { started_at: new Date().toISOString(), room_minutes: room ?? null, energy }).catch(() => {});
    router.navigate({ pathname: '/today', params: { start: '1', room: room ? String(room) : '', energy: energy ?? '' } });
  };
  const decide = async (a: Action, choice: 'today' | 'tomorrow' | 'done') => {
    setDecided((d) => ({ ...d, [a.id]: choice }));
    if (choice === 'tomorrow') await store.updateAction(a.id, { due_date: inDays(1), deadline_type: a.deadline_type === 'hard' ? 'hard' : 'target' });
    if (choice === 'done') await store.completeAction(a.id);
  };

  return (
    <Screen>
      <Header title="Start my day" onClose={close} />
      <Steps n={step} of={steps} />
      {step === 0 && (
        <>
          <Body style={{ fontFamily: fonts.medium, fontSize: 18, marginBottom: 12 }}>How much room do you have today?</Body>
          {ROOM.map((r) => <Option key={String(r.value)} selected={room === r.value} label={r.label} sub={r.sub} onPress={() => { setRoom(r.value); setStep(1); }} />)}
        </>
      )}
      {step === 1 && (
        <>
          <Body style={{ fontFamily: fonts.medium, fontSize: 18, marginBottom: 12 }}>How’s your energy?</Body>
          {ENERGY.map((e) => <Option key={e.value} selected={energy === e.value} icon={e.icon} label={e.label} sub={e.sub} onPress={() => { setEnergy(e.value); setStep(2); }} />)}
          <Button title="Back" variant="ghost" onPress={() => setStep(0)} />
        </>
      )}
      {step === 2 && (
        <>
          <Body style={{ fontFamily: fonts.medium, fontSize: 18, marginBottom: 4 }}>Anything new on your mind?</Body>
          <Muted style={{ marginBottom: 12 }}>Get it out of your head. It’s sorted and dated the same way as Capture.</Muted>
          <QuickCapture placeholder="Call the vet, pick up dry cleaning by Friday…" onSaved={(n) => setAdded((x) => x + n)} />
          {added > 0 && <Banner text={`Added ${added} to your list.`} />}
          <Button title={dueNow.length ? 'Next' : 'Plan my day'} onPress={() => (dueNow.length ? setStep(3) : finish())} style={{ marginTop: 8 }} />
          <Button title="Back" variant="ghost" onPress={() => setStep(1)} />
        </>
      )}
      {step === 3 && (
        <>
          <Body style={{ fontFamily: fonts.medium, fontSize: 18, marginBottom: 4 }}>Still happening today?</Body>
          <Muted style={{ marginBottom: 12 }}>These are due today or already past their date.</Muted>
          {dueNow.map((a) => (
            <Card key={a.id} style={{ paddingVertical: 12 }}>
              <Body style={{ fontFamily: fonts.medium }}>{a.title}</Body>
              <Muted>{daysUntil(a.due_date!) < 0 ? `Was due ${friendlyDate(a.due_date!)}` : 'Due today'}{a.deadline_type === 'hard' ? ' · real deadline' : ''} · {minutesOf(a)} min</Muted>
              {decided[a.id] ? (
                <Muted style={{ marginTop: 8, color: colors.teal }}>{{ today: 'On today’s plan', tomorrow: 'Moved to tomorrow', done: 'Done, nice' }[decided[a.id]]}</Muted>
              ) : (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 }}>
                  <Chip label="Yes, today" onPress={() => decide(a, 'today')} />
                  <Chip label="Tomorrow" onPress={() => decide(a, 'tomorrow')} />
                  <Chip label="Already done" onPress={() => decide(a, 'done')} />
                </View>
              )}
            </Card>
          ))}
          <Button title="Plan my day" onPress={finish} style={{ marginTop: 8 }} />
          <Button title="Back" variant="ghost" onPress={() => setStep(2)} />
        </>
      )}
    </Screen>
  );
}

// ───────────────────────── End my day

function EndDay() {
  const store = useStore();
  const today = toISODate(new Date());
  const [step, setStep] = useState(0);
  const [extra, setExtra] = useState(0);
  const [leftIds, setLeftIds] = useState<string[] | null>(null);
  const [decided, setDecided] = useState<Record<string, string>>({});
  // Starts with anything already pinned today ("Put first thing tomorrow"), so wrapping up never drops it.
  const [first, setFirst] = useState<string | null>(() => store.checkins.find((c) => c.day === toISODate(new Date()))?.tomorrow_first_action_id ?? null);
  const [newFirst, setNewFirst] = useState('');
  const [adding, setAdding] = useState(false);
  const close = () => router.navigate('/today');

  const dayStart = startOfDay().getTime();
  const wins = store.accomplishments.filter((a) => new Date(a.occurred_at).getTime() >= dayStart);

  // Leftovers: what was on Today's plan and anything due today, still open.
  useEffect(() => {
    AsyncStorage.getItem(`momentum.plan.${today}`).then((raw) => {
      const planned: string[] = raw ? (JSON.parse(raw).picks ?? []).map((p: { action_id: string | null }) => p.action_id).filter(Boolean) : [];
      const dueToday = store.actions.filter((a) => a.due_date && daysUntil(a.due_date) <= 0).map((a) => a.id);
      setLeftIds([...new Set([...planned, ...dueToday])]);
    }).catch(() => setLeftIds([]));
  }, [today]); // eslint-disable-line react-hooks/exhaustive-deps
  const leftovers = (leftIds ?? []).map((id) => store.actions.find((a) => a.id === id)).filter((a): a is Action => !!a && ['ready', 'in_progress'].includes(a.status));

  // Tomorrow's first thing: leftovers moved to tomorrow first, then the best suggestions.
  const options = useMemo(() => {
    const moved = leftovers.filter((a) => decided[a.id] === 'tomorrow');
    const recs = recommend({ goals: store.goals, actions: store.actions, dependencies: store.dependencies, lifeAreas: store.lifeAreas })
      .map((r) => r.action).filter((a): a is Action => !!a && !moved.some((m) => m.id === a.id));
    return [...moved, ...recs].slice(0, 5);
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const decide = async (a: Action, choice: 'tomorrow' | 'later' | 'let_go') => {
    setDecided((d) => ({ ...d, [a.id]: choice }));
    if (choice === 'tomorrow') await store.updateAction(a.id, { due_date: inDays(1), deadline_type: a.deadline_type === 'hard' ? 'hard' : 'target' });
    if (choice === 'later' && a.due_date && daysUntil(a.due_date) <= 0 && a.deadline_type !== 'hard') await store.updateAction(a.id, { due_date: null, deadline_type: 'none' });
    if (choice === 'let_go') await store.updateAction(a.id, { status: 'dismissed' });
  };
  /** Types a brand-new task to start tomorrow with; the rules fill in its time, area and date like Capture does. */
  const addFirst = async () => {
    const text = newFirst.trim();
    if (!text) return;
    setAdding(true);
    try {
      const [item] = fallbackInterpret(text, store.lifeAreas, store.goals.filter((g) => g.status === 'active')).items;
      const id = await store.createAction({
        title: item?.title || text, estimated_minutes: item?.estimated_minutes ?? null, goal_id: item?.suggested_goal_id ?? null,
        life_area_id: item?.suggested_goal_id ? null : item?.suggested_life_area_id ?? null,
        due_date: item?.deadline ?? null, deadline_type: item?.deadline ? (item.deadline_type === 'hard' ? 'hard' : 'target') : 'none',
      });
      setFirst(id);
      setNewFirst('');
    } finally { setAdding(false); }
  };
  const finish = async () => {
    await store.saveCheckin(today, { ended_at: new Date().toISOString(), tomorrow_first_action_id: first }).catch(() => {});
    router.navigate({ pathname: '/today', params: { ended: '1' } });
  };

  return (
    <Screen>
      <Header title="End my day" onClose={close} />
      <Steps n={step} of={3} />
      {step === 0 && (
        <>
          <Card style={{ alignItems: 'center', paddingVertical: 20, backgroundColor: colors.tealSoft, borderColor: colors.tealSoft }}>
            <Text style={{ fontFamily: fonts.serif, fontSize: 40, color: colors.text }}>{wins.length + extra}</Text>
            <Muted>{wins.length + extra === 1 ? 'thing got done today' : 'things got done today'}</Muted>
          </Card>
          {wins.slice(0, 8).map((a) => (
            <View key={a.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 }}>
              <IconCircle name="check" color={colors.white} soft={colors.teal} size={24} />
              <Body style={{ flex: 1 }} numberOfLines={1}>{a.title}</Body>
            </View>
          ))}
          <Body style={{ fontFamily: fonts.medium, marginTop: 16, marginBottom: 8 }}>Anything else you did? It all counts.</Body>
          <QuickCapture asWins placeholder="Answered emails, walked the dog, helped Mom…" onSaved={(n) => setExtra((x) => x + n)} />
          <Button title="Next" onPress={() => setStep(1)} style={{ marginTop: 8 }} />
        </>
      )}
      {step === 1 && (
        <>
          <Body style={{ fontFamily: fonts.medium, fontSize: 18, marginBottom: 4 }}>{leftovers.length ? 'What about these?' : 'Nothing left over'}</Body>
          <Muted style={{ marginBottom: 12 }}>{leftovers.length ? 'Still open from today. No guilt, just a decision.' : 'Everything on today’s plan is done or settled.'}</Muted>
          {leftovers.map((a) => (
            <Card key={a.id} style={{ paddingVertical: 12 }}>
              <Body style={{ fontFamily: fonts.medium }}>{a.title}</Body>
              {a.due_date && <Muted>{a.deadline_type === 'hard' ? 'Real deadline' : 'Target'}: {friendlyDate(a.due_date)}</Muted>}
              {decided[a.id] ? (
                <Muted style={{ marginTop: 8, color: colors.teal }}>{{ tomorrow: 'Moved to tomorrow', later: 'Kept for later', let_go: 'Let go' }[decided[a.id]]}</Muted>
              ) : (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 }}>
                  <Chip label="Tomorrow" onPress={() => decide(a, 'tomorrow')} />
                  <Chip label="Later" onPress={() => decide(a, 'later')} />
                  <Chip label="Let it go" onPress={() => decide(a, 'let_go')} />
                </View>
              )}
            </Card>
          ))}
          <Button title="Next" onPress={() => setStep(2)} style={{ marginTop: 8 }} />
          <Button title="Back" variant="ghost" onPress={() => setStep(0)} />
        </>
      )}
      {step === 2 && (
        <>
          <Body style={{ fontFamily: fonts.medium, fontSize: 18, marginBottom: 4 }}>What’s the first thing tomorrow?</Body>
          <Muted style={{ marginBottom: 12 }}>It’ll be waiting at the top of Today, so the morning starts easy.</Muted>
          {options.map((a) => (
            <Option key={a.id} selected={first === a.id} label={a.title} sub={`${a.due_date ? `Due ${friendlyDate(a.due_date)} · ` : ''}${minutesOf(a)} min`} onPress={() => setFirst(first === a.id ? null : a.id)} />
          ))}
          {options.length === 0 && <Muted>Nothing open right now. Enjoy the quiet.</Muted>}
          {first && !options.some((o) => o.id === first) && <Option selected label={store.actions.find((a) => a.id === first)?.title ?? 'Your new task'} sub="Added just now" onPress={() => setFirst(null)} />}
          <Body style={{ fontFamily: fonts.medium, marginTop: 10, marginBottom: 6 }}>Or something new</Body>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <View style={[{ flex: 1, backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 10 }]}>
              <TextInput value={newFirst} onChangeText={setNewFirst} placeholder="Call the bank first thing…" placeholderTextColor={colors.textFaint} accessibilityLabel="A new first thing for tomorrow"
                style={{ fontFamily: fonts.body, fontSize: 15, color: colors.text }} onSubmitEditing={() => addFirst()} returnKeyType="done" />
            </View>
            <Button title="Add" variant="soft" onPress={() => addFirst()} loading={adding} disabled={!newFirst.trim()} style={{ minHeight: 44, paddingHorizontal: 18 }} />
          </View>
          <Button title="Wrap up the day" onPress={finish} style={{ marginTop: 8 }} />
          <Button title="Back" variant="ghost" onPress={() => setStep(1)} />
        </>
      )}
    </Screen>
  );
}
