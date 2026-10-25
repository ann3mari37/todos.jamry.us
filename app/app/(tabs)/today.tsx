import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { DigestCard } from '../../src/components/EmailBits';
import { Flower } from '../../src/components/Flower';
import { FlowerArt } from '../../src/components/FlowerArt';
import { OrganizeSheet } from '../../src/components/OrganizeSheet';
import { TaskList, useOpenTasks } from '../../src/components/TaskList';
import { Ring } from '../../src/components/Ring';
import { Banner, Body, Button, Card, Chip, H1, Icon, IconButton, IconCircle, Label, Muted, Pill, ProgressBar, Screen, Segmented, Sheet, SheetOption, type IconName } from '../../src/components/ui';
import { friendlyDate, greeting, startOfDay, startOfWeek, timeOfDay } from '../../src/core/dates';
import { KIND_LABEL, readyActions, remainingSteps } from '../../src/core/recommend';
import type { DailyMode } from '../../src/core/types';
import { useStore } from '../../src/lib/store';
import { usePlan, type Pick } from '../../src/lib/usePlan';
import { colors, fonts, KIND_STYLE, radius } from '../../src/theme';

const MODES: { value: DailyMode; label: string; hint: string; icon: IconName }[] = [
  { value: 'meaningful', label: 'Move something meaningful', hint: 'Projects that matter, bigger tasks', icon: 'heart' },
  { value: 'small_tasks', label: 'A few small tasks', hint: 'Your quickest wins, 15 min or less', icon: 'feather' },
  { value: 'off_my_mind', label: 'Get something off my mind', hint: 'Overdue, waiting, and oldest items', icon: 'wind' },
  { value: 'show_all', label: "Show me what's available", hint: 'Everything ready right now', icon: 'list' },
];

export default function Today() {
  const store = useStore();
  const plan = usePlan();
  const [tab, setTab] = useState<'today' | 'week' | 'areas'>('today');
  const [selected, setSelected] = useState<(typeof plan.picks)[number] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [organizing, setOrganizing] = useState(false);
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
    if (response === 'deferred') plan.remove(pick);
    else if (!plan.swap(pick)) setNote("That's everything that's ready right now.");
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

          {store.emailDigest && (
            <Pressable onPress={() => router.push('/inbox')} accessibilityRole="button" accessibilityLabel="Open inbox">
              <DigestCard digest={store.emailDigest} compact />
              {inboxAction > 0 && <Muted style={{ textAlign: 'right', marginTop: 6, marginBottom: 6, color: colors.pinkDeep, fontFamily: fonts.medium }}>{inboxAction} email{inboxAction === 1 ? '' : 's'} need you · Open inbox ›</Muted>}
            </Pressable>
          )}
          {!store.emailDigest && store.emailAccounts.length > 0 && (
            <Card onPress={() => router.push('/inbox')} style={{ paddingVertical: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Icon name="mail" size={18} color={colors.pink} />
                <Body style={{ flex: 1 }}>Inbox{inboxAction ? ` · ${inboxAction} need${inboxAction === 1 ? 's' : ''} you` : ''}</Body>
                <Icon name="chevron-right" size={16} color={colors.textFaint} />
              </View>
            </Card>
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

          <DayType mode={plan.mode} onChange={(m) => { plan.setMode(m); setNote(null); }} />

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

      <OrganizeSheet visible={organizing} onClose={() => setOrganizing(false)} onApplied={(text, runId) => setOrganized({ text, runId })} />

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

/** "What kind of day is it?" — each choice swaps in its own set of 3–5 suggestions. */
function DayType({ mode, onChange }: { mode: DailyMode | null; onChange: (m: DailyMode | null) => void }) {
  const current = MODES.find((m) => m.value === mode);
  if (current) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.pinkWash, borderRadius: radius.lg, paddingVertical: 10, paddingHorizontal: 14, marginBottom: 12 }}>
        <Icon name={current.icon} size={18} color={colors.pinkDeep} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: fonts.semibold, color: colors.pinkDeep, fontSize: 14 }}>{current.label}</Text>
          <Muted style={{ fontSize: 12 }}>{current.hint}</Muted>
        </View>
        <Pressable onPress={() => onChange(null)} accessibilityRole="button" hitSlop={8} style={{ minHeight: 36, justifyContent: 'center' }}>
          <Text style={{ fontFamily: fonts.medium, color: colors.pinkDeep, fontSize: 13 }}>Usual picks</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <Card style={{ paddingBottom: 8 }}>
      <Text style={{ fontFamily: fonts.semibold, fontSize: 15, color: colors.text }}>What kind of day is it?</Text>
      <Muted style={{ marginTop: 2, marginBottom: 10 }}>Pick one and your suggestions change to fit.</Muted>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {MODES.map((m) => (
          <Pressable
            key={m.value}
            onPress={() => onChange(m.value)}
            accessibilityRole="button"
            accessibilityLabel={`${m.label}. ${m.hint}`}
            style={({ pressed }) => [{ flexBasis: '48%', flexGrow: 1, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.cardSoft, padding: 12, minHeight: 72 }, pressed && { opacity: 0.7 }]}
          >
            <Icon name={m.icon} size={18} color={colors.pink} />
            <Text style={{ fontFamily: fonts.medium, fontSize: 13, color: colors.text, marginTop: 6 }}>{m.label}</Text>
            <Muted style={{ fontSize: 11, marginTop: 2 }}>{m.hint}</Muted>
          </Pressable>
        ))}
      </View>
    </Card>
  );
}
