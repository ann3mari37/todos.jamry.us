import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { InboxBriefing } from '../../src/components/EmailBits';
import { Flower } from '../../src/components/Flower';
import { FlowerArt } from '../../src/components/FlowerArt';
import { EditTask } from '../../src/components/EditTask';
import { OrganizeSheet } from '../../src/components/OrganizeSheet';
import { TaskList, useOpenTasks } from '../../src/components/TaskList';
import { Ring } from '../../src/components/Ring';
import { Banner, Body, Button, Card, Chip, H1, Icon, IconButton, IconCircle, Label, Muted, Pill, ProgressBar, Screen, Segmented, Sheet, SheetOption } from '../../src/components/ui';
import { friendlyDate, greeting, startOfDay, startOfWeek, timeOfDay, toISODate } from '../../src/core/dates';
import { KIND_LABEL, readyActions, remainingSteps } from '../../src/core/recommend';
import { crunch, describeMinutes, minutesOf, staleTasks, type Crunch } from '../../src/core/workload';
import type { Action, RecommendationKind } from '../../src/core/types';
import { useStore } from '../../src/lib/store';
import { usePlan, type Pick } from '../../src/lib/usePlan';
import { colors, fonts, KIND_STYLE, radius } from '../../src/theme';

const FILTERS: { kind: RecommendationKind; label: string }[] = [
  { kind: 'time_sensitive', label: 'Time-sensitive' },
  { kind: 'meaningful_move', label: 'Meaningful' },
  { kind: 'easy_momentum', label: 'Quick wins' },
  { kind: 'quietly_waiting', label: 'Waiting' },
  { kind: 'next_up', label: 'Next up' },
];

export default function Today() {
  const store = useStore();
  const plan = usePlan();
  const [tab, setTab] = useState<'today' | 'week' | 'areas'>('today');
  const [selected, setSelected] = useState<(typeof plan.picks)[number] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [filter, setFilter] = useState<RecommendationKind | null>(null);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  // Day types were replaced by the filter row; clear one left over from earlier today.
  useEffect(() => { if (plan.mode) plan.setMode(null); }, [plan.mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.kind, plan.byKind(f.kind).length])) as Record<RecommendationKind, number>,
    [plan.byKind]); // eslint-disable-line react-hooks/exhaustive-deps
  const shownPicks = filter ? plan.byKind(filter).filter((x) => !skipped.has(x.action?.id ?? x.goal?.id ?? '')) : plan.picks;
  const next = (x: (typeof shownPicks)[number], dir: 1 | -1 = 1) => {
    if (filter) setSkipped((s) => new Set(s).add(x.action?.id ?? x.goal?.id ?? ''));
    else if (!plan.browse(x.pick, dir)) setNote("That's the only one of its kind right now.");
  };
  const [organizing, setOrganizing] = useState(false);
  const [ringInfo, setRingInfo] = useState(false);
  const [editing, setEditing] = useState<Action | null>(null);

  // ── Start my day / End my day. Never automatic: the person opens them when their day starts and ends. The only
  // prompt is a small card on a new date that hasn't been started yet, which "Not now" hides for the rest of the day.
  const params = useLocalSearchParams<{ start?: string; room?: string; energy?: string; ended?: string }>();
  const todayIso = toISODate(new Date());
  const checkin = store.checkins.find((c) => c.day === todayIso);
  const [promptHidden, setPromptHidden] = useState(true);
  useEffect(() => {
    AsyncStorage.getItem('momentum.dayPromptHidden').then((v) => setPromptHidden(v === todayIso)).catch(() => setPromptHidden(false));
  }, [todayIso]);
  const hidePrompt = () => { setPromptHidden(true); AsyncStorage.setItem('momentum.dayPromptHidden', todayIso).catch(() => {}); };
  const showDayPrompt = !promptHidden && !checkin?.started_at && !store.loading && store.actions.some((a) => ['ready', 'in_progress'].includes(a.status));
  useEffect(() => {
    if (params.start !== '1' || !plan.ready || store.loading) return;
    const energy = params.energy === 'low' || params.energy === 'okay' || params.energy === 'high' ? params.energy : null;
    const picks = plan.startDay({ roomMinutes: params.room ? Number(params.room) : null, energy });
    const total = picks.reduce((sum, x) => { const a = store.actions.find((y) => y.id === x.action_id); return sum + (a ? minutesOf(a) : 0); }, 0);
    setNote(picks.length ? `Here’s your day: ${picks.length} thing${picks.length === 1 ? '' : 's'}, about ${describeMinutes(total)}.` : 'Nothing needs you today. Enjoy the space.');
    router.setParams({ start: undefined, room: undefined, energy: undefined });
    hidePrompt();
  }, [params.start, plan.ready, store.loading]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (params.ended !== '1') return;
    setNote(store.checkins.find((c) => c.day === todayIso)?.tomorrow_first_action_id ? 'Day wrapped. Tomorrow’s first thing will be waiting at the top. Rest well.' : 'Day wrapped. Rest well.');
    router.setParams({ ended: undefined });
  }, [params.ended]); // eslint-disable-line react-hooks/exhaustive-deps
  const [crunchOpen, setCrunchOpen] = useState(false);
  const load = useMemo(() => crunch(store.actions, store.goals), [store.actions, store.goals]);
  const stale = useMemo(() => staleTasks(store.actions, store.goals), [store.actions, store.goals]);
  const [organized, setOrganized] = useState<{ text: string; runId: string } | null>(null);

  const dayStart = startOfDay().getTime();
  const todayAcc = store.accomplishments.filter((a) => new Date(a.occurred_at).getTime() >= dayStart);
  const advancedToday = new Set(store.events.filter((e) => e.type === 'goal_advanced' && new Date(e.occurred_at).getTime() >= dayStart).map((e) => e.goal_id));
  todayAcc.forEach((a) => a.meaningful && a.goal_id && advancedToday.add(a.goal_id));
  const available = readyActions({ goals: store.goals, actions: store.actions, dependencies: store.dependencies }).length;

  // Unsorted = no project and no life area. A standalone task filed in an area is fine as it is.
  const loose = store.actions.filter((a) => !a.goal_id && !a.life_area_id && ['ready', 'in_progress', 'waiting', 'blocked'].includes(a.status));
  const auto = store.lastOrganized;
  const pickedIds = new Set(plan.picks.map((p) => p.pick.action_id));
  const otherTasks = useOpenTasks((a) => !pickedIds.has(a.id));
  const inboxAction = store.emailMessages.filter((m) => m.category === 'action_needed' && m.status === 'new').length;

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
    if (response === 'deferred' || response === 'not_suitable') plan.notToday(pick);
    else if (!plan.browse(pick, 1)) setNote("That's the only one of its kind right now.");
  };

  return (
    <Screen>
      <View style={{ position: 'absolute', right: -64, top: -48 }} pointerEvents="none">
        <FlowerArt slot="header" width={210} height={210} seed={0.7} />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: 8 }}>
        <View style={{ flex: 1, paddingRight: 90 }}>
          <H1 style={{ fontSize: 32 }}>{greeting()}</H1>
          <Muted style={{ fontSize: 15, marginTop: 4 }}>Make something meaningful happen today.</Muted>
          <Pressable
            onPress={() => router.push({ pathname: '/day', params: { mode: checkin?.started_at ? 'end' : 'start' } })}
            accessibilityRole="button"
            style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: 10, paddingVertical: 8, paddingHorizontal: 14,
              borderRadius: radius.pill, backgroundColor: checkin?.ended_at ? colors.tealSoft : colors.card, borderWidth: 1, borderColor: checkin?.ended_at ? colors.tealSoft : colors.border }, pressed && { opacity: 0.7 }]}>
            <Icon name={!checkin?.started_at ? 'sunrise' : checkin.ended_at ? 'check' : 'sunset'} size={15} color={checkin?.ended_at ? colors.teal : colors.pinkDeep} />
            <Text style={{ fontFamily: fonts.medium, fontSize: 13, color: checkin?.ended_at ? colors.teal : colors.pinkDeep }}>
              {!checkin?.started_at ? 'Start my day' : checkin.ended_at ? 'Day wrapped' : 'End my day'}
            </Text>
          </Pressable>
        </View>
        <IconButton name="settings" label="Settings" onPress={() => router.push('/more')} />
      </View>

      {!store.online && <Banner tone="soft" text={`You're offline. Changes are saved on this device${store.pending ? ` (${store.pending} waiting to sync)` : ''}.`} />}
      <FromChat />

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: 18 }}>
        <Ring value={todayAcc.length} label={todayAcc.length === 1 ? 'accomplishment today' : 'accomplishments today'} size={120} from={colors.pink} to={colors.teal} emphasis />
        <Pressable onPress={() => setRingInfo(true)} accessibilityRole="button" accessibilityLabel={`${advancedToday.size} projects moved today. What counts?`}>
          <Ring value={advancedToday.size} label={advancedToday.size === 1 ? 'project moved' : 'projects moved'} size={92} from={colors.amber} to={colors.teal} />
        </Pressable>
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
          {showDayPrompt && (
            <Card style={{ backgroundColor: colors.amberSoft, borderColor: colors.amberSoft, paddingVertical: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <IconCircle name="sunrise" color={colors.amber} soft={colors.white} size={40} />
                <View style={{ flex: 1 }}>
                  <Body style={{ fontFamily: fonts.medium }}>It’s a new day. Want to plan it?</Body>
                  <Muted>A couple of quick questions, and Today fits your time and energy.</Muted>
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                <Button title="Start my day" onPress={() => router.push({ pathname: '/day', params: { mode: 'start' } })} style={{ flex: 1, minHeight: 44 }} />
                <Button title="Not now" variant="ghost" onPress={hidePrompt} style={{ minHeight: 44 }} />
              </View>
            </Card>
          )}
          {(organized || (auto && !auto.undone_at)) && (
            <Card style={{ backgroundColor: colors.tealSoft, borderColor: colors.tealSoft, paddingVertical: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Icon name="folder" size={18} color={colors.teal} />
                <Body style={{ flex: 1, fontSize: 14 }}>
                  {organized?.text ?? `Filed ${auto!.changes.length} new item${auto!.changes.length === 1 ? '' : 's'} into projects and life areas.`}
                </Body>
                <Pressable accessibilityRole="button" hitSlop={8} onPress={async () => { const id = organized?.runId ?? auto!.id; setOrganized(null); store.setLastOrganized(null); await store.organizeUndo(id).catch(() => setNote("Couldn't undo right now.")); }}>
                  <Text style={{ fontFamily: fonts.semibold, color: colors.teal }}>Undo</Text>
                </Pressable>
                <IconButton name="x" size={16} color={colors.textMuted} label="Dismiss" onPress={() => { setOrganized(null); store.setLastOrganized(null); }} />
              </View>
            </Card>
          )}

          {store.emailAccounts.length > 0 && (
            <>
              <InboxBriefing compact onOpen={() => router.push('/inbox')} />
              <Pressable onPress={() => router.push('/inbox')} accessibilityRole="button" style={{ alignSelf: 'flex-end', paddingVertical: 8 }}>
                <Muted style={{ color: colors.pinkDeep, fontFamily: fonts.medium }}>{inboxAction > 0 ? `${inboxAction} email${inboxAction === 1 ? '' : 's'} need you · ` : ''}Open inbox ›</Muted>
              </Pressable>
            </>
          )}

          {loose.length >= 3 && (
            <Pressable onPress={() => setOrganizing(true)} accessibilityRole="button" style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 999, backgroundColor: colors.pinkWash, marginBottom: 12, alignSelf: 'flex-start' }, pressed && { opacity: 0.7 }]}>
              <Icon name="star" size={14} color={colors.pinkDeep} />
              <Text style={{ fontFamily: fonts.medium, color: colors.pinkDeep, fontSize: 13 }}>{loose.length} unsorted tasks · Organize them</Text>
            </Pressable>
          )}
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

          {load.level !== 'calm' && (
            <Card onPress={() => setCrunchOpen(true)} accessibilityLabel={`${load.headline}. Make a plan`}
              style={{ backgroundColor: load.level === 'crunch' ? colors.amberSoft : colors.card, borderColor: load.level === 'crunch' ? colors.amberSoft : colors.border, paddingVertical: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <IconCircle name="calendar" color={colors.amber} soft={load.level === 'crunch' ? colors.white : colors.amberSoft} size={40} />
                <View style={{ flex: 1 }}>
                  <Body style={{ fontFamily: fonts.medium }}>{load.level === 'crunch' ? 'A lot is due at once' : 'A busy couple of days'}</Body>
                  <Muted>{load.headline}</Muted>
                </View>
                <Text style={{ fontFamily: fonts.medium, color: colors.pinkDeep, fontSize: 13 }}>Make a plan ›</Text>
              </View>
            </Card>
          )}
          {stale.length >= 3 && (
            <Pressable onPress={() => router.push('/review')} accessibilityRole="button" style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 999, backgroundColor: colors.lavenderSoft, marginBottom: 12, alignSelf: 'flex-start' }, pressed && { opacity: 0.7 }]}>
              <Icon name="wind" size={14} color={colors.lavender} />
              <Text style={{ fontFamily: fonts.medium, color: '#7A5FB8', fontSize: 13 }}>{stale.length} things have been sitting a while · Tidy up</Text>
            </Pressable>
          )}

          <FilterRow value={filter} counts={counts} onChange={(f) => { setFilter(f); setSkipped(new Set()); setNote(null); }} />

          {!filter && plan.finished && (
            <Card style={{ backgroundColor: colors.pinkWash, alignItems: 'center', paddingVertical: 22 }}>
              <Flower size={64} seed={2} />
              <Text style={{ fontFamily: fonts.serif, fontSize: 22, color: colors.text, marginTop: 8 }} accessibilityRole="header">Finished for now</Text>
              <Muted style={{ textAlign: 'center', marginTop: 4, fontSize: 14 }}>
                That's a good place to stop. You made {todayAcc.length} thing{todayAcc.length === 1 ? '' : 's'} happen today.
              </Muted>
              <Button title="I'd like a little more" variant="soft" style={{ marginTop: 14, minHeight: 44 }} onPress={() => { if (!plan.addMore()) setNote("Nothing else is ready right now — enjoy the space."); }} />
            </Card>
          )}

          {shownPicks.map(({ pick, action, goal }, i) => {
            const style = KIND_STYLE[pick.kind];
            // Finished picks never show here: usePlan replaces them with the next of their kind as soon as they're done.
            const steps = goal ? remainingSteps(goal.id, store.actions) : 0;
            const sub = pick.kind === 'time_sensitive' && goal?.deadline
              ? `Due ${friendlyDate(goal.deadline)} · ${steps} step${steps === 1 ? '' : 's'} left`
              : pick.reason;
            return (
              // "Next" sits on top of the card rather than inside it: a button inside the card's button is invalid on the web.
              <View key={`${pick.action_id ?? pick.goal_id}-${i}`}>
              <Card
                onPress={() => (action ? setSelected({ pick, action, goal }) : goal && router.push({ pathname: '/project/[id]', params: { id: goal.id } }))}
                accessibilityLabel={`${KIND_LABEL[pick.kind]}: ${action?.title ?? goal?.title}`}
              >
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <IconCircle name={style.icon} color={style.color} soft={style.soft} size={44} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: fonts.medium, fontSize: 13, color: style.color === colors.amber ? '#D99A2B' : style.color }}>{pick.pinned ? 'Your first thing' : KIND_LABEL[pick.kind]}</Text>
                    <Body style={{ fontFamily: fonts.medium, fontSize: 17, marginTop: 2 }}>{action?.title ?? goal?.title}</Body>
                    {action && goal && pick.kind !== 'time_sensitive' && pick.kind !== 'quietly_waiting' && <Muted style={{ marginTop: 2 }} numberOfLines={1}>{goal.title}</Muted>}
                    <Muted style={{ marginTop: 4 }} numberOfLines={2}>{sub}</Muted>
                    {/* room for the Next button laid over the card */}
                    <View style={{ height: 36 }} />
                  </View>
                  <View style={{ alignItems: 'flex-end', justifyContent: 'space-between' }}>
                    <Icon name="chevron-right" size={18} color={colors.textFaint} />
                    {action?.estimated_minutes ? <Pill text={`${action.estimated_minutes} min`} /> : null}
                  </View>
                </View>
              </Card>
              {/* Card controls sit on top of the card (buttons inside the card's button are invalid on the web). */}
              {filter ? (
                <Pressable onPress={() => next({ pick, action, goal })} accessibilityRole="button" accessibilityLabel="Next suggestion" hitSlop={8}
                  style={{ position: 'absolute', left: 72, bottom: 28, flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 28 }}>
                  <Text style={{ fontFamily: fonts.medium, fontSize: 12, color: colors.textMuted }}>Next</Text>
                  <Icon name="chevron-right" size={13} color={colors.textMuted} />
                </Pressable>
              ) : (
                <CardControls
                  position={plan.position(pick)}
                  onBack={() => next({ pick, action, goal }, -1)}
                  onNext={() => next({ pick, action, goal }, 1)}
                  onSeeAll={() => { setFilter(pick.kind); setSkipped(new Set()); setNote(null); }}
                  onNotToday={() => respond(pick, 'deferred')}
                  kindLabel={KIND_LABEL[pick.kind]}
                />
              )}
              </View>
            );
          })}

          {filter && shownPicks.length === 0 && (
            <Card style={{ alignItems: 'center', paddingVertical: 20 }}>
              <Muted style={{ textAlign: 'center' }}>Nothing else in {FILTERS.find((f) => f.kind === filter)?.label.toLowerCase()} right now.</Muted>
            </Card>
          )}
          {!filter && plan.ready && plan.picks.length === 0 && !store.loading && (
            <Card style={{ alignItems: 'center', paddingVertical: 26 }}>
              <Body style={{ fontFamily: fonts.medium, textAlign: 'center' }}>{store.goals.length || store.actions.length ? 'Nothing needs you right now.' : "Let's start with what's on your mind."}</Body>
              <Muted style={{ textAlign: 'center', marginTop: 6 }}>Capture a goal, a task, or something you already did.</Muted>
              <Button title="Capture" icon="plus" style={{ marginTop: 14 }} onPress={() => router.push('/capture')} />
            </Card>
          )}
          {note && <Banner text={note} />}


          <Label>{plan.picks.length ? 'Everything else on your list' : 'Your list'}</Label>
          <TaskList tasks={otherTasks} limit={6} emptyText="Nothing else on your list." />

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

      <EditTask action={editing} onClose={() => setEditing(null)} />
      <CrunchSheet visible={crunchOpen} load={load} onClose={() => setCrunchOpen(false)} />
      <Sheet visible={ringInfo} onClose={() => setRingInfo(false)} title="Projects moved today">
        {advancedToday.size > 0
          ? [...advancedToday].map((id) => <Body key={id ?? 'x'} style={{ paddingVertical: 4 }}>• {store.goals.find((g) => g.id === id)?.title ?? 'A project'}</Body>)
          : <Body>None yet today.</Body>}
        <Muted style={{ marginTop: 10 }}>
          A project moves forward when you finish one of its steps. Standalone tasks still count as accomplishments (the big ring), they just aren’t part of a project.
        </Muted>
        {(() => {
          const empty = store.goals.filter((g) => g.status === 'active' && remainingSteps(g.id, store.actions) === 0);
          return empty.length > 0 ? (
            <>
              <Muted style={{ marginTop: 10, color: colors.text, fontFamily: fonts.medium }}>These projects have no next step, so they can’t move yet:</Muted>
              {empty.slice(0, 4).map((g) => <SheetOption key={g.id} icon="plus-circle" label={`Add a step to “${g.title}”`} onPress={() => { setRingInfo(false); router.push({ pathname: '/project/[id]', params: { id: g.id } }); }} />)}
            </>
          ) : null;
        })()}
        <Muted style={{ marginTop: 10 }}>Tip: if a few loose tasks belong together, Organize can group them into a project.</Muted>
      </Sheet>
      <OrganizeSheet visible={organizing} onClose={() => setOrganizing(false)} onApplied={(text, runId) => setOrganized({ text, runId })} />

      <Sheet visible={!!selected} onClose={() => setSelected(null)} title={selected?.action?.title}>
        {selected?.goal && <Muted style={{ marginBottom: 6 }}>{selected.goal.title}</Muted>}
        {selected?.action && <SheetOption icon="check-circle" label="Mark done" onPress={() => complete(selected.action!.id)} />}
        {selected?.action && <SheetOption icon="edit-2" label="Edit task" onPress={() => { const a = selected.action!; setSelected(null); setEditing(a); }} />}
        {selected?.action && <SheetOption icon="sunrise" label={checkin?.tomorrow_first_action_id === selected.action.id ? 'Unpin from tomorrow' : 'Put first thing tomorrow'} onPress={() => { store.pinForTomorrow(checkin?.tomorrow_first_action_id === selected.action!.id ? null : selected.action!.id); setSelected(null); setNote(checkin?.tomorrow_first_action_id === selected.action!.id ? 'Unpinned.' : 'Pinned. It’ll be first on Today tomorrow.'); }} />}
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
            <Muted>projects moved</Muted>
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
          <Card key={area.id} onPress={() => router.push({ pathname: '/area/[id]', params: { id: area.id } })}>
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

/** Filter row: the mixed list by default; tap a category to see every suggestion of that kind. */
function FilterRow({ value, counts, onChange }: { value: RecommendationKind | null; counts: Record<RecommendationKind, number>; onChange: (k: RecommendationKind | null) => void }) {
  const chip = (key: string, label: string, on: boolean, onPress: () => void, color: string) => (
    <Pressable key={key} onPress={onPress} accessibilityRole="tab" accessibilityState={{ selected: on }}
      style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, marginRight: 8, borderWidth: 1, borderColor: on ? color : colors.border, backgroundColor: on ? color : colors.card }}>
      <Text style={{ fontFamily: fonts.medium, fontSize: 12, color: on ? colors.white : colors.text }}>{label}</Text>
    </Pressable>
  );
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12, flexGrow: 0 }} accessibilityRole="tablist">
      {chip('all', 'All', value === null, () => onChange(null), colors.pink)}
      {FILTERS.filter((f) => counts[f.kind] > 0).map((f) =>
        chip(f.kind, `${f.label} · ${counts[f.kind]}`, value === f.kind, () => onChange(value === f.kind ? null : f.kind), KIND_STYLE[f.kind].color))}
    </ScrollView>
  );
}

/** Plans an AI chat handed off through the Momentum connector, waiting for review. */
function FromChat() {
  const store = useStore();
  if (!store.handoffs.length) return null;
  return (
    <>
      {store.handoffs.slice(0, 3).map((h) => {
        const n = h.interpretation.items.length;
        const who = h.interpretation.client ?? 'your AI chat';
        return (
          <Card key={h.id} onPress={() => router.push({ pathname: '/capture', params: { handoff: h.id } })} accessibilityLabel={`Review the plan from ${who}`}
            style={{ backgroundColor: colors.lavenderSoft, borderColor: colors.lavenderSoft, paddingVertical: 14, marginTop: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <IconCircle name="message-circle" color={colors.lavender} soft={colors.white} size={40} />
              <View style={{ flex: 1 }}>
                <Body style={{ fontFamily: fonts.medium }}>From {who}: {n} item{n === 1 ? '' : 's'} to review</Body>
                <Muted numberOfLines={2}>{h.interpretation.summary || h.raw_text}</Muted>
              </View>
              <Icon name="chevron-right" color={colors.textMuted} />
            </View>
          </Card>
        );
      })}
    </>
  );
}

/** "Make a plan" for a pile-up: real deadlines in the order to do them, flexible ones moved to calmer days. */
function CrunchSheet({ visible, load, onClose }: { visible: boolean; load: Crunch; onClose: () => void }) {
  const store = useStore();
  const [moved, setMoved] = useState<Set<string>>(new Set());
  useEffect(() => { if (visible) setMoved(new Set()); }, [visible]);
  const movingIds = new Set(load.movable.map((m) => m.item.action.id));
  const doNow = load.items.filter((i) => !movingIds.has(i.action.id));
  const move = async (m: Crunch['movable'][number]) => {
    setMoved((s) => new Set(s).add(m.item.action.id));
    // A task's own date moves the task; a date that comes from its project moves the project's target date.
    if (m.item.action.due_date === m.item.date) await store.updateAction(m.item.action.id, { due_date: m.to, deadline_type: 'target' });
    else if (m.item.goal) await store.updateGoal(m.item.goal.id, { deadline: m.to, deadline_type: 'target' });
  };
  const when = (d: number, date: string) => (d < 0 ? `was due ${friendlyDate(date)}` : d === 0 ? 'due today' : 'due tomorrow');
  return (
    <Sheet visible={visible} onClose={onClose} title="Let’s make it manageable">
      <Muted style={{ marginBottom: 12 }}>{load.advice}</Muted>
      <Label>Do these, in this order</Label>
      {doNow.map((i, n) => (
        <View key={i.action.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 }}>
          <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: i.hard ? colors.amberSoft : colors.tealSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontFamily: fonts.semibold, fontSize: 12, color: colors.text }}>{n + 1}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Body numberOfLines={2}>{i.action.title}</Body>
            <Muted>{i.goal ? `${i.goal.title} · ` : ''}{when(i.days, i.date)}{i.hard ? ' · real deadline' : ''} · {i.minutes} min</Muted>
          </View>
          <Pressable onPress={() => store.completeAction(i.action.id)} accessibilityRole="button" accessibilityLabel={`Mark ${i.action.title} done`} hitSlop={8}>
            <Icon name="circle" color={colors.textMuted} />
          </Pressable>
        </View>
      ))}
      {load.movable.length > 0 && (
        <>
          <Label>Move to a calmer day</Label>
          {load.movable.map((m) => (
            <View key={m.item.action.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 }}>
              <View style={{ flex: 1 }}>
                <Body numberOfLines={2}>{m.item.goal && m.item.action.due_date !== m.item.date ? m.item.goal.title : m.item.action.title}</Body>
                <Muted>Target date, {when(m.item.days, m.item.date)} · {m.item.minutes} min</Muted>
              </View>
              {moved.has(m.item.action.id)
                ? <Muted style={{ color: colors.teal }}>Moved to {m.label}</Muted>
                : <Chip label={`Move to ${m.label}`} onPress={() => move(m)} />}
            </View>
          ))}
          {load.movable.length > 1 && load.movable.some((m) => !moved.has(m.item.action.id)) && (
            <Button title={`Move all ${load.movable.length}`} variant="soft" onPress={() => load.movable.filter((m) => !moved.has(m.item.action.id)).forEach(move)} style={{ marginTop: 6 }} />
          )}
        </>
      )}
      <Button title="Done" onPress={onClose} style={{ marginTop: 10 }} />
    </Sheet>
  );
}

/** Back / Next through a card's category ("2 of 5", wraps around), See all of it, or set this one aside for today. */
function CardControls({ position, onBack, onNext, onSeeAll, onNotToday, kindLabel }: {
  position: { index: number; total: number }; onBack: () => void; onNext: () => void; onSeeAll: () => void; onNotToday: () => void; kindLabel: string;
}) {
  const link = { fontFamily: fonts.medium, fontSize: 12, color: colors.textMuted } as const;
  const many = position.total > 1;
  return (
    <View style={{ position: 'absolute', left: 72, right: 16, bottom: 26, flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 28 }}>
      {many && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel={`Previous ${kindLabel}`} hitSlop={8}><Icon name="chevron-left" size={16} color={colors.textMuted} /></Pressable>
          <Text style={link}>{position.index + 1} of {position.total}</Text>
          <Pressable onPress={onNext} accessibilityRole="button" accessibilityLabel={`Next ${kindLabel}`} hitSlop={8}><Icon name="chevron-right" size={16} color={colors.textMuted} /></Pressable>
        </View>
      )}
      {many && <Pressable onPress={onSeeAll} accessibilityRole="button" accessibilityLabel={`See all ${kindLabel}`} hitSlop={6}><Text style={link}>See all</Text></Pressable>}
      <Pressable onPress={onNotToday} accessibilityRole="button" accessibilityLabel="Not today" hitSlop={6}><Text style={link}>Not today</Text></Pressable>
    </View>
  );
}
