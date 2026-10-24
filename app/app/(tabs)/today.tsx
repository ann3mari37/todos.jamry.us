import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { Flower } from '../../src/components/Flower';
import { Ring } from '../../src/components/Ring';
import { Banner, Body, Button, Card, Chip, H1, Icon, IconButton, IconCircle, Label, Muted, Pill, ProgressBar, Screen, Segmented, Sheet, SheetOption } from '../../src/components/ui';
import { friendlyDate, greeting, startOfDay, startOfWeek, timeOfDay } from '../../src/core/dates';
import { KIND_LABEL, readyActions, remainingSteps } from '../../src/core/recommend';
import type { DailyMode } from '../../src/core/types';
import { useStore } from '../../src/lib/store';
import { usePlan, type Pick } from '../../src/lib/usePlan';
import { colors, fonts, KIND_STYLE } from '../../src/theme';

const MODES: { value: DailyMode; label: string }[] = [
  { value: 'meaningful', label: 'Move something meaningful' },
  { value: 'small_tasks', label: 'A few small tasks' },
  { value: 'off_my_mind', label: 'Get something off my mind' },
  { value: 'show_all', label: "Show me what's available" },
];

export default function Today() {
  const store = useStore();
  const plan = usePlan();
  const [tab, setTab] = useState<'today' | 'week' | 'areas'>('today');
  const [selected, setSelected] = useState<(typeof plan.picks)[number] | null>(null);
  const [showModes, setShowModes] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const dayStart = startOfDay().getTime();
  const todayAcc = store.accomplishments.filter((a) => new Date(a.occurred_at).getTime() >= dayStart);
  const advancedToday = new Set(store.events.filter((e) => e.type === 'goal_advanced' && new Date(e.occurred_at).getTime() >= dayStart).map((e) => e.goal_id));
  todayAcc.forEach((a) => a.meaningful && a.goal_id && advancedToday.add(a.goal_id));
  const available = readyActions({ goals: store.goals, actions: store.actions, dependencies: store.dependencies }).length;

  const nudge = store.nudges.find((n) => !n.response && Date.now() - new Date(n.created_at).getTime() < 7 * 86_400_000);
  const nudgeGoal = nudge ? store.goals.find((g) => g.id === nudge.goal_id) : null;

  const complete = async (actionId: string) => {
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setSelected(null);
    await store.completeAction(actionId);
    router.push({ pathname: '/celebrate', params: { action: actionId } });
  };

  const respond = async (pick: Pick, response: 'deferred' | 'not_suitable' | 'show_other') => {
    setSelected(null);
    await store.giveFeedback({ action_id: pick.action_id, goal_id: pick.goal_id, response });
    if (response === 'deferred') plan.remove(pick);
    else if (!plan.swap(pick)) setNote("That's everything that's ready right now.");
  };

  return (
    <Screen>
      <View style={{ position: 'absolute', right: -40, top: -30, opacity: 0.9 }} pointerEvents="none">
        <Flower size={190} seed={0.7} />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: 8 }}>
        <View style={{ flex: 1, paddingRight: 90 }}>
          <H1 style={{ fontSize: 32 }}>{greeting()}</H1>
          <Muted style={{ fontSize: 15, marginTop: 4 }}>Make something meaningful happen today.</Muted>
        </View>
        <IconButton name="settings" label="Settings" onPress={() => router.push('/more')} />
      </View>

      {!store.online && <Banner tone="soft" text={`You're offline. Changes are saved on this device${store.pending ? ` (${store.pending} waiting to sync)` : ''}.`} />}

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: 18 }}>
        <Ring value={todayAcc.length} label={todayAcc.length === 1 ? 'accomplishment today' : 'accomplishments today'} size={120} from={colors.pink} to={colors.teal} emphasis />
        <Ring value={advancedToday.size} label="goals advanced" size={92} from={colors.amber} to={colors.teal} />
        <Ring value={available} label="actions available" size={92} from={colors.teal} to={colors.green} />
      </View>

      <Segmented
        value={tab}
        onChange={setTab}
        options={[{ value: 'today', label: 'Today' }, { value: 'week', label: 'This Week' }, { value: 'areas', label: 'Life Areas' }]}
        style={{ marginBottom: 14 }}
      />

      {tab === 'today' && (
        <>
          {nudge && (
            <Card style={{ backgroundColor: colors.lavenderSoft }}>
              <Body>{nudge.message}</Body>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 }}>
                {nudgeGoal && <Chip label="Find a smaller step" onPress={() => { store.respondNudge(nudge.id, 'smaller_step'); router.push({ pathname: '/project/[id]', params: { id: nudgeGoal.id, assist: 'smaller' } }); }} />}
                {nudgeGoal && <Chip label="Help me find the blocker" onPress={() => { store.respondNudge(nudge.id, 'identify_blocker'); router.push({ pathname: '/project/[id]', params: { id: nudgeGoal.id, assist: 'blocker' } }); }} />}
                {nudgeGoal && <Chip label="I'm waiting on something" onPress={() => { store.respondNudge(nudge.id, 'waiting'); store.updateGoal(nudgeGoal.id, { status: 'waiting' }); }} />}
                {nudgeGoal && <Chip label="Pause this goal" onPress={() => { store.respondNudge(nudge.id, 'pause'); store.updateGoal(nudgeGoal.id, { status: 'paused' }); }} />}
                {nudgeGoal && <Chip label="Not important anymore" onPress={() => { store.respondNudge(nudge.id, 'not_important'); store.updateGoal(nudgeGoal.id, { status: 'archived' }); }} />}
                <Chip label="Remind me later" onPress={() => store.respondNudge(nudge.id, 'remind_later')} />
                <Chip label="Dismiss" onPress={() => store.respondNudge(nudge.id, 'dismiss')} />
              </View>
            </Card>
          )}

          {plan.finished && (
            <Card style={{ backgroundColor: colors.pinkWash, alignItems: 'center', paddingVertical: 22 }}>
              <Flower size={64} seed={2} />
              <Text style={{ fontFamily: fonts.serif, fontSize: 22, color: colors.text, marginTop: 8 }} accessibilityRole="header">Finished for now</Text>
              <Muted style={{ textAlign: 'center', marginTop: 4, fontSize: 14 }}>
                That's a good place to stop. You made {todayAcc.length} thing{todayAcc.length === 1 ? '' : 's'} happen today.
              </Muted>
              <Button title="I'd like a little more" variant="soft" style={{ marginTop: 14, minHeight: 44 }} onPress={() => { if (!plan.addMore()) setNote("Nothing else is ready right now — enjoy the space."); }} />
            </Card>
          )}

          {plan.picks.map(({ pick, action, goal }, i) => {
            const style = KIND_STYLE[pick.kind];
            const done = action?.status === 'completed';
            const steps = goal ? remainingSteps(goal.id, store.actions) : 0;
            const sub = pick.kind === 'time_sensitive' && goal?.deadline
              ? `Due ${friendlyDate(goal.deadline)} · ${steps} step${steps === 1 ? '' : 's'} left`
              : pick.reason;
            return (
              <Card
                key={`${pick.action_id ?? pick.goal_id}-${i}`}
                onPress={() => (action ? setSelected({ pick, action, goal }) : goal && router.push({ pathname: '/project/[id]', params: { id: goal.id } }))}
                accessibilityLabel={`${KIND_LABEL[pick.kind]}: ${action?.title ?? goal?.title}${done ? ', done' : ''}`}
                style={done ? { opacity: 0.6 } : undefined}
              >
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  {done ? <IconCircle name="check" color={colors.white} soft={colors.teal} size={44} /> : <IconCircle name={style.icon} color={style.color} soft={style.soft} size={44} />}
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: fonts.medium, fontSize: 13, color: style.color === colors.amber ? '#D99A2B' : style.color }}>{KIND_LABEL[pick.kind]}</Text>
                    <Body style={{ fontFamily: fonts.medium, fontSize: 17, marginTop: 2, textDecorationLine: done ? 'line-through' : 'none' }}>{action?.title ?? goal?.title}</Body>
                    {action && goal && pick.kind !== 'time_sensitive' && pick.kind !== 'quietly_waiting' && <Muted style={{ marginTop: 2 }} numberOfLines={1}>{goal.title}</Muted>}
                    <Muted style={{ marginTop: 4 }} numberOfLines={2}>{sub}</Muted>
                  </View>
                  <View style={{ alignItems: 'flex-end', justifyContent: 'space-between' }}>
                    <Icon name="chevron-right" size={18} color={colors.textFaint} />
                    {action?.estimated_minutes ? <Pill text={`${action.estimated_minutes} min`} /> : null}
                  </View>
                </View>
              </Card>
            );
          })}

          {plan.ready && plan.picks.length === 0 && !store.loading && (
            <Card style={{ alignItems: 'center', paddingVertical: 26 }}>
              <Body style={{ fontFamily: fonts.medium, textAlign: 'center' }}>{store.goals.length || store.actions.length ? 'Nothing needs you right now.' : "Let's start with what's on your mind."}</Body>
              <Muted style={{ textAlign: 'center', marginTop: 6 }}>Capture a goal, a task, or something you already did.</Muted>
              <Button title="Capture" icon="plus" style={{ marginTop: 14 }} onPress={() => router.push('/capture')} />
            </Card>
          )}
          {note && <Banner text={note} />}

          <Pressable onPress={() => setShowModes((v) => !v)} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, minHeight: 44 }}>
            <Icon name="sliders" size={16} color={colors.textMuted} />
            <Muted>{plan.mode ? MODES.find((m) => m.value === plan.mode)?.label : 'What kind of day is it? (optional)'}</Muted>
          </Pressable>
          {showModes && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {MODES.map((m) => <Chip key={m.value} label={m.label} selected={plan.mode === m.value} onPress={() => { plan.setMode(plan.mode === m.value ? null : m.value); setShowModes(false); }} />)}
            </View>
          )}

          <Label>Recent accomplishments</Label>
          {store.accomplishments.slice(0, 3).map((a) => (
            <View key={a.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 }}>
              <IconCircle name="check" color={colors.white} soft={a.meaningful ? colors.teal : colors.green} size={26} />
              <Body style={{ flex: 1 }} numberOfLines={1}>{a.title}</Body>
              <Muted>{new Date(a.occurred_at).getTime() >= dayStart ? timeOfDay(a.occurred_at) : friendlyDate(a.occurred_at.slice(0, 10))}</Muted>
            </View>
          ))}
          {store.accomplishments.length === 0 && <Muted>Everything you do counts — planned or not.</Muted>}
          <Button title="Look What I Did" icon="star" variant="soft" style={{ marginTop: 14 }} onPress={() => router.push({ pathname: '/capture', params: { mode: 'did' } })} />
        </>
      )}

      {tab === 'week' && <WeekTab />}
      {tab === 'areas' && <AreasTab />}

      <Sheet visible={!!selected} onClose={() => setSelected(null)} title={selected?.action?.title}>
        {selected?.goal && <Muted style={{ marginBottom: 6 }}>{selected.goal.title}</Muted>}
        {selected?.action && <SheetOption icon="check-circle" label="Mark done" onPress={() => complete(selected.action!.id)} />}
        {selected?.goal && <SheetOption icon="folder" label="Open project" onPress={() => { const id = selected.goal!.id; setSelected(null); router.push({ pathname: '/project/[id]', params: { id } }); }} />}
        {selected && <SheetOption icon="refresh-cw" label="Show me something else" onPress={() => respond(selected.pick, 'show_other')} />}
        {selected && <SheetOption icon="clock" label="Not today" onPress={() => respond(selected.pick, 'deferred')} />}
        {selected && <SheetOption icon="x-circle" label="Not a good fit" onPress={() => respond(selected.pick, 'not_suitable')} />}
      </Sheet>
    </Screen>
  );
}

function WeekTab() {
  const store = useStore();
  const ws = startOfWeek().getTime();
  const acc = store.accomplishments.filter((a) => new Date(a.occurred_at).getTime() >= ws);
  const advanced = new Set(acc.filter((a) => a.meaningful && a.goal_id).map((a) => a.goal_id));
  return (
    <>
      <Card>
        <View style={{ flexDirection: 'row' }}>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={{ fontFamily: fonts.serif, fontSize: 30, color: colors.text }}>{acc.length}</Text>
            <Muted>accomplishments</Muted>
          </View>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={{ fontFamily: fonts.serif, fontSize: 30, color: colors.text }}>{advanced.size}</Text>
            <Muted>goals advanced</Muted>
          </View>
        </View>
      </Card>
      {acc.slice(0, 12).map((a) => (
        <View key={a.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 }}>
          <IconCircle name="check" color={colors.white} soft={a.meaningful ? colors.teal : colors.green} size={24} />
          <Body style={{ flex: 1 }} numberOfLines={1}>{a.title}</Body>
        </View>
      ))}
      <Button title="See full progress" variant="ghost" onPress={() => router.push('/progress')} />
    </>
  );
}

function AreasTab() {
  const store = useStore();
  const ws = startOfWeek().getTime();
  const areas = useMemo(() => store.lifeAreas.filter((a) => !a.archived_at), [store.lifeAreas]);
  return (
    <>
      {areas.map((area) => {
        const goals = store.goals.filter((g) => g.life_area_id === area.id && g.status === 'active');
        const acts = store.actions.filter((a) => (a.life_area_id ?? store.goals.find((g) => g.id === a.goal_id)?.life_area_id) === area.id && a.status !== 'dismissed' && a.status !== 'suggested');
        const week = store.accomplishments.filter((a) => a.life_area_id === area.id && new Date(a.occurred_at).getTime() >= ws).length;
        return (
          <Card key={area.id} onPress={() => router.push('/life-areas')}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: area.color }} />
              <Body style={{ flex: 1, fontFamily: fonts.medium }}>{area.name}</Body>
              <Muted>{goals.length} active · {week} this week</Muted>
            </View>
            {acts.length > 0 && <View style={{ flexDirection: 'row', marginTop: 10 }}><ProgressBar done={acts.filter((a) => a.status === 'completed').length} total={acts.length} color={area.color} /></View>}
          </Card>
        );
      })}
    </>
  );
}
