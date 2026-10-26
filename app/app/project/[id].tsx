import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, Text, View } from 'react-native';
import { ProjectBanner } from '../../src/components/FlowerArt';
import { AssignChips, TEAMS_UI } from '../../src/components/TeamBits';
import { assigneeLabel } from '../../src/core/team';
import { Banner, Body, Button, Card, Chip, Divider, Field, H1, Icon, IconButton, Muted, ProgressBar, Row, Screen, Segmented, Sheet, SheetOption } from '../../src/components/ui';
import { friendlyDate, shortDate, timeOfDay } from '../../src/core/dates';
import { goalProgress } from '../../src/core/recommend';
import { suggestWhy } from '../../src/core/rules';
import { projectHealth } from '../../src/core/workload';
import { suggestSteps } from '../../src/core/templates';
import type { AccountabilityMode, Action, Goal, GoalStatus } from '../../src/core/types';
import { api, friendlyAiError } from '../../src/lib/api';
import { useStore } from '../../src/lib/store';
import { supabase } from '../../src/lib/supabase';
import { colors, fonts, radius } from '../../src/theme';

const STATUSES: { value: GoalStatus; label: string }[] = [
  { value: 'active', label: 'Active' }, { value: 'waiting', label: 'Waiting on something' }, { value: 'blocked', label: 'Blocked' },
  { value: 'paused', label: 'Paused' }, { value: 'completed', label: 'Completed' }, { value: 'archived', label: 'Archived' },
];
const ACCOUNTABILITY: { value: AccountabilityMode; label: string }[] = [
  { value: 'default', label: 'Default' }, { value: 'keep_visible', label: 'Keep this visible' }, { value: 'help_me', label: 'Help me make progress' },
  { value: 'i_avoid_this', label: 'I tend to avoid this' }, { value: 'do_not_remind', label: "Don't remind me right now" },
];

const withArticle = (w: string) => `${/^[aeiou]/i.test(w) ? 'an' : 'a'} ${w}`;

interface ContextRow { id: string; kind: string; body: string; resolved_at: string | null; created_at: string }

export default function Project() {
  const { id, assist } = useLocalSearchParams<{ id: string; assist?: string }>();
  const store = useStore();
  const goal = store.goals.find((g) => g.id === id);
  const [tab, setTab] = useState<'overview' | 'steps' | 'notes' | 'files'>('overview');
  const [sheet, setSheet] = useState<null | 'title' | 'meaning' | 'deadline' | 'area' | 'status' | 'accountability' | 'more' | 'add' | 'blockers' | 'team'>(null);
  const [editAction, setEditAction] = useState<Action | null>(null);
  const [genBusy, setGenBusy] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [context, setContext] = useState<ContextRow[]>([]);
  const [blockers, setBlockers] = useState<{ possible_blockers: string[]; smaller_step: { title: string; estimated_minutes: number | null } | null; question: string | null } | null>(null);

  const loadContext = () => {
    supabase.from('goal_context').select('*').eq('goal_id', id).order('created_at', { ascending: false }).then(({ data }) => setContext((data ?? []) as ContextRow[]));
  };
  useEffect(loadContext, [id]);

  // A project with no steps at all gets its first few from the matching template, once, as suggestions to keep or remove.
  const autoSuggested = useRef<string | null>(null);
  useEffect(() => {
    if (!goal || store.loading || autoSuggested.current === goal.id) return;
    autoSuggested.current = goal.id;
    const has = store.allActions.some((a) => a.goal_id === goal.id && a.status !== 'dismissed');
    if (has || !['active', 'waiting', 'blocked'].includes(goal.status)) return;
    const { template, steps } = suggestSteps(goal.title, [], 3);
    store.createSteps(goal.id, steps.map((st) => ({ title: st.title, estimated_minutes: st.minutes })))
      .then(() => setAiNote(`Here's a start from ${withArticle(template.label)} checklist. Keep what fits, remove what doesn't.`))
      .catch(() => {});
  }, [goal?.id, store.loading]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (assist === 'blocker' || assist === 'smaller') findBlockers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assist]);

  const actions = useMemo(() => store.allActions.filter((a) => a.goal_id === id), [store.allActions, id]);
  const deps = store.dependencies;
  const waitingOn = (a: Action) => deps.filter((d) => d.action_id === a.id).map((d) => actions.find((x) => x.id === d.depends_on_id)).filter((x) => x && x.status !== 'completed') as Action[];
  const open = actions.filter((a) => ['ready', 'in_progress', 'waiting', 'blocked'].includes(a.status));
  const suggested = actions.filter((a) => a.status === 'suggested');
  const completed = actions.filter((a) => a.status === 'completed').sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''));
  const next = open.slice(0, 3);
  const { done, total } = goalProgress(id, store.allActions);
  const recent = store.accomplishments.filter((a) => a.goal_id === id).slice(0, 5);
  const area = store.lifeAreas.find((a) => a.id === goal?.life_area_id);
  // Only the project's owner moves it into or out of a team.
  const canShare = !!goal && (!goal.user_id || goal.user_id === store.me);
  const suggestedWhy = goal ? suggestWhy(goal.title, { isProject: true, areaName: area?.name, due: goal.deadline ? { date: goal.deadline, type: goal.deadline_type } : null }) ?? '' : '';

  if (!goal) {
    return (
      <Screen>
        <IconButton name="chevron-left" label="Back" onPress={() => router.back()} />
        <Muted>{store.loading ? 'Loading…' : 'This project could not be found.'}</Muted>
      </Screen>
    );
  }

  const update = (p: Partial<Goal>) => store.updateGoal(goal.id, p);
  const health = projectHealth(goal, store.allActions, new Date(), store.accountability?.inactivity_days ?? 10);

  // Rule-based steps from the matching template (no AI needed), skipping ones the project already has.
  const fromTemplate = async () => {
    const { template, steps } = suggestSteps(goal.title, actions.filter((a) => a.status !== 'dismissed').map((a) => a.title), 3);
    if (!steps.length) { setAiNote(`All the usual steps for ${withArticle(template.label)} are already here. Add your own with +.`); return; }
    await store.createSteps(goal.id, steps.map((st) => ({ title: st.title, estimated_minutes: st.minutes })));
    setAiNote(`Suggested from ${withArticle(template.label)} checklist. Keep what fits, remove what doesn't.`);
  };

  const generate = async (regenerate = false) => {
    setGenBusy(true); setAiNote(null);
    if (store.profile?.ai_enabled === false) { await fromTemplate().finally(() => setGenBusy(false)); return; }
    try {
      const res = await api<{ uncertainty_note: string | null; questions: string[]; suggested_actions: unknown[] }>('/api/ai/decompose-goal', { goal_id: goal.id, regenerate });
      if (res.uncertainty_note) setAiNote(res.uncertainty_note);
      else if (!res.suggested_actions.length) setAiNote('No new steps to suggest right now — your current steps cover it.');
      await store.refresh(); loadContext();
    } catch {
      await fromTemplate(); // AI unavailable → the template still gives useful next steps
    } finally { setGenBusy(false); }
  };

  async function findBlockers() {
    setSheet('blockers'); setBlockers(null);
    try {
      setBlockers(await api('/api/ai/blockers', { goal_id: id }));
    } catch (e) {
      setBlockers({ possible_blockers: ['The next step may be too big', 'Some information may be missing', 'It may be waiting on someone else'], smaller_step: null, question: null });
      setAiNote(friendlyAiError(e).replace(/Organized without AI.*$/, ''));
    }
  }

  const complete = async (a: Action) => {
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    await store.completeAction(a.id);
    router.push({ pathname: '/celebrate', params: { action: a.id } });
  };

  const team = { members: store.teamMembers, roles: store.teamRoles, memberRoles: store.teamMemberRoles };
  const ActionRow = ({ a }: { a: Action }) => {
    const blockedBy = waitingOn(a);
    const isDone = a.status === 'completed';
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, minHeight: 48 }}>
        <Pressable
          onPress={() => (isDone ? store.uncompleteAction(a.id) : blockedBy.length ? null : complete(a))}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: isDone, disabled: blockedBy.length > 0 }}
          accessibilityLabel={isDone ? `Mark ${a.title} not done` : `Complete ${a.title}`}
          hitSlop={8}
          style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: isDone ? colors.teal : blockedBy.length ? colors.border : colors.textFaint, backgroundColor: isDone ? colors.teal : 'transparent', alignItems: 'center', justifyContent: 'center' }}
        >
          {isDone && <Icon name="check" size={14} color={colors.white} />}
        </Pressable>
        <Pressable style={{ flex: 1 }} onPress={() => setEditAction(a)} accessibilityRole="button" accessibilityLabel={`Edit ${a.title}`}>
          <Body style={{ textDecorationLine: isDone ? 'line-through' : 'none', color: isDone ? colors.textMuted : colors.text }}>{a.title}</Body>
          {blockedBy.length > 0 && <Muted>After: {blockedBy.map((b) => b.title).join(', ')}</Muted>}
          {goal?.team_id && <Muted>{isDone ? (a.completed_by ? `Done by ${a.completed_by === store.me ? 'you' : assigneeLabel({ assignee_id: a.completed_by }, team)}` : 'Done') : assigneeLabel(a, team, store.me) ?? 'Unassigned'}</Muted>}
          {a.status === 'waiting' && <Muted>Waiting</Muted>}
          {a.status === 'blocked' && <Muted>Blocked</Muted>}
          {a.requires_clarification && !isDone && <Muted style={{ color: '#C98A1B' }}>Check the official requirements first</Muted>}
        </Pressable>
        {a.estimated_minutes && !isDone ? <Muted>{a.estimated_minutes} min</Muted> : null}
        <Icon name="chevron-right" size={16} color={colors.textFaint} />
      </View>
    );
  };

  const SuggestionRow = ({ a }: { a: Action }) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 }}>
      <Icon name="star" size={14} color={colors.pink} />
      <View style={{ flex: 1 }}>
        <Body>{a.title}</Body>
        <Muted>Suggested{a.estimated_minutes ? ` · ${a.estimated_minutes} min` : ''}</Muted>
      </View>
      <Pressable onPress={() => store.updateAction(a.id, { status: 'ready' })} accessibilityRole="button" accessibilityLabel={`Accept ${a.title}`} style={{ backgroundColor: colors.tealSoft, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 }}>
        <Text style={{ color: colors.teal, fontFamily: fonts.medium, fontSize: 12 }}>Keep</Text>
      </Pressable>
      <IconButton name="x" size={18} color={colors.textMuted} label={`Reject ${a.title}`} onPress={() => store.updateAction(a.id, { status: 'dismissed' })} />
    </View>
  );

  return (
    <Screen>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
        <IconButton name="chevron-left" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.navigate('/projects'))} />
        <IconButton name="more-horizontal" label="More options" onPress={() => setSheet('more')} />
      </View>
      <Pressable onPress={() => setSheet('title')} accessibilityRole="button" accessibilityHint="Edit title">
        <H1>{goal.title}</H1>
      </Pressable>
      <Pressable onPress={() => setSheet('meaning')}>
        <Muted style={{ fontSize: 15, marginTop: 4 }}>{goal.meaning || `Suggested: ${suggestedWhy}`}</Muted>
      </Pressable>
      {!goal.meaning && (
        <Pressable onPress={() => update({ meaning: suggestedWhy, meaning_source: 'ai_suggested' })} accessibilityRole="button" style={{ alignSelf: 'flex-start', marginTop: 6, backgroundColor: colors.pinkWash, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 }}>
          <Text style={{ color: colors.pinkDeep, fontFamily: fonts.medium, fontSize: 12 }}>Keep this reason</Text>
        </Pressable>
      )}

      <View style={{ marginVertical: 14 }}>
        <ProjectBanner height={130} seed={goal.title.length} />
      </View>

      <Segmented value={tab} onChange={setTab} options={[{ value: 'overview', label: 'Overview' }, { value: 'steps', label: 'Steps' }, { value: 'notes', label: 'Notes' }, { value: 'files', label: 'Files' }]} style={{ marginBottom: 14 }} />

      {goal.status !== 'active' && <Banner tone="soft" text={`This project is ${STATUSES.find((s) => s.value === goal.status)?.label.toLowerCase()}. It won't appear in recommendations or reminders until it's active again.`} />}
      {goal.status === 'active' && health.state !== 'on_track' && (
        <Card style={{ backgroundColor: health.tone === 'warn' ? colors.amberSoft : health.tone === 'good' ? colors.tealSoft : colors.lavenderSoft, borderColor: 'transparent', paddingVertical: 14 }}>
          <Text style={{ fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 0.5, color: health.tone === 'warn' ? '#B7791F' : health.tone === 'good' ? colors.teal : '#7A5FB8' }}>{health.label.toUpperCase()}</Text>
          <Body style={{ marginTop: 4 }}>{health.message}</Body>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 }}>
            {health.state === 'steps_done' && <Chip label="Mark project complete" onPress={() => { update({ status: 'completed' }); router.push({ pathname: '/celebrate', params: { goal: goal.id } }); }} />}
            {(health.state === 'steps_done' || health.state === 'no_steps') && <Chip label="Add a step" onPress={() => setSheet('add')} />}
            {health.state === 'no_steps' && <Chip label="Suggest steps" onPress={() => generate(false)} />}
            {(health.state === 'overdue' || health.state === 'at_risk') && <Chip label="Change the date" onPress={() => setSheet('deadline')} />}
            {health.state === 'at_risk' && <Chip label="Review the steps" onPress={() => setTab('steps')} />}
            {(health.state === 'stalled' || health.state === 'all_waiting') && <Chip label="Find a smaller step" onPress={() => setSheet('add')} />}
            {health.state === 'stalled' && <Chip label="Pause it for now" onPress={() => update({ status: 'paused' })} />}
          </View>
        </Card>
      )}

      {tab === 'overview' && (
        <>
          <Card onPress={() => setTab('steps')}>
            <Body style={{ fontFamily: fonts.medium }}>Progress</Body>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10 }}>
              <ProgressBar done={done} total={total} height={10} />
              <Muted>{done} / {total}</Muted>
              <Icon name="chevron-right" size={16} color={colors.textFaint} />
            </View>
          </Card>

          <Body style={{ fontFamily: fonts.medium, marginTop: 6, marginBottom: 4 }}>Next Actions</Body>
          {next.map((a) => <ActionRow key={a.id} a={a} />)}
          {suggested.map((a) => <SuggestionRow key={a.id} a={a} />)}
          {next.length === 0 && suggested.length === 0 && <Muted style={{ marginVertical: 8 }}>No open steps. Generate a few, or add your own.</Muted>}
          {aiNote && <Banner text={aiNote} />}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
            <Button title={genBusy ? 'Thinking…' : 'Generate next steps'} icon="star" variant="soft" onPress={() => generate(false)} loading={genBusy} style={{ flex: 1, minHeight: 46 }} />
            <Pressable onPress={() => setSheet('add')} accessibilityRole="button" accessibilityLabel="Add a step" style={{ width: 52, borderRadius: radius.pill, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="plus" />
            </Pressable>
          </View>

          <Card style={{ marginTop: 16, paddingVertical: 4 }}>
            <Row icon="calendar" title={goal.deadline ? `${goal.deadline_type === 'hard' ? 'Hard deadline' : 'Target date'}: ${friendlyDate(goal.deadline)}` : 'No deadline'} value={goal.deadline ? shortDate(goal.deadline) : 'Add date'} onPress={() => setSheet('deadline')} />
            <Divider />
            <Row icon="heart" iconColor={colors.pink} title="Why it matters" subtitle={goal.meaning || 'Optional'} onPress={() => setSheet('meaning')} />
            <Divider />
            <Row icon="tag" title="Life area" value={area?.name ?? 'None'} right={area ? <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: area.color }} /> : null} onPress={() => setSheet('area')} />
            <Divider />
            {(goal.team_id || (TEAMS_UI && store.teams.length > 0)) && (
              <>
                <Row icon="users" title="Team" value={store.teams.find((t) => t.id === goal.team_id)?.name ?? 'Just me'} onPress={canShare ? () => setSheet('team') : undefined} />
                <Divider />
              </>
            )}
            <Row icon="pause-circle" title="Status" value={STATUSES.find((s) => s.value === goal.status)?.label} onPress={() => setSheet('status')} />
            <Divider />
            <Row icon="eye" title="Accountability" value={ACCOUNTABILITY.find((s) => s.value === goal.accountability)?.label} onPress={() => setSheet('accountability')} />
          </Card>

          <Body style={{ fontFamily: fonts.medium, marginTop: 10, marginBottom: 4 }}>Recent progress</Body>
          {recent.map((r) => (
            <View key={r.id} style={{ flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 6 }}>
              <Icon name="check-circle" size={18} color={colors.teal} />
              <Body style={{ flex: 1 }} numberOfLines={1}>{r.title}</Body>
              <Muted>{friendlyDate(r.occurred_at.slice(0, 10))}</Muted>
            </View>
          ))}
          {recent.length === 0 && <Muted>Nothing yet — any step counts.</Muted>}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
            <Button title="I did something" icon="check" variant="soft" style={{ flex: 1, minHeight: 46 }} onPress={() => router.push({ pathname: '/capture', params: { mode: 'did', goal: goal.id } })} />
            <Button title="I'm stuck" icon="help-circle" variant="ghost" style={{ flex: 1, minHeight: 46 }} onPress={findBlockers} />
          </View>
        </>
      )}

      {tab === 'steps' && (
        <>
          <Muted style={{ marginBottom: 8 }}>The full map. Only the next few steps show up on Today.</Muted>
          {open.map((a) => <ActionRow key={a.id} a={a} />)}
          {suggested.map((a) => <SuggestionRow key={a.id} a={a} />)}
          <Button title="Add a step" icon="plus" variant="ghost" onPress={() => setSheet('add')} />
          {completed.length > 0 && <Body style={{ fontFamily: fonts.medium, marginTop: 12 }}>Completed</Body>}
          {completed.map((a) => <ActionRow key={a.id} a={a} />)}
        </>
      )}

      {tab === 'notes' && <Notes goalId={goal.id} rows={context} reload={loadContext} />}

      {tab === 'files' && (
        <Card style={{ alignItems: 'center', paddingVertical: 24 }}>
          <Icon name="paperclip" color={colors.textMuted} />
          <Muted style={{ textAlign: 'center', marginTop: 8 }}>Attaching documents (and having AI read requirements from them) is planned for a later phase.</Muted>
        </Card>
      )}

      {/* ── Sheets */}
      <TextSheet visible={sheet === 'title'} title="Project name" initial={goal.title} onClose={() => setSheet(null)} onSave={(v) => v && update({ title: v })} />
      <TextSheet visible={sheet === 'meaning'} title="Why does this matter to you?" initial={goal.meaning ?? ''} multiline placeholder="e.g. It will remove a lingering obligation." onClose={() => setSheet(null)} onSave={(v) => update({ meaning: v || null, meaning_source: v ? 'user' : 'none' })} />
      <DeadlineSheet visible={sheet === 'deadline'} goal={goal} onClose={() => setSheet(null)} onSave={update} />
      <Sheet visible={sheet === 'area'} onClose={() => setSheet(null)} title="Life area">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          <Chip label="None" selected={!goal.life_area_id} onPress={() => { update({ life_area_id: null }); setSheet(null); }} />
          {store.lifeAreas.filter((a) => !a.archived_at).map((a) => <Chip key={a.id} label={a.name} selected={goal.life_area_id === a.id} onPress={() => { update({ life_area_id: a.id }); setSheet(null); }} />)}
        </View>
      </Sheet>
      <Sheet visible={sheet === 'team'} onClose={() => setSheet(null)} title="Who works on this project?">
        <Muted style={{ marginBottom: 10 }}>On a team, everyone on it sees this project and its steps, and each step can go to a person or a role. Your life areas and history stay private.</Muted>
        <SheetOption icon={!goal.team_id ? 'check-circle' : 'circle'} label="Just me" onPress={() => { update({ team_id: null }); setSheet(null); }} />
        {store.teams.map((t) => <SheetOption key={t.id} icon={goal.team_id === t.id ? 'check-circle' : 'circle'} label={t.name} onPress={() => { update({ team_id: t.id }); setSheet(null); }} />)}
      </Sheet>
      <Sheet visible={sheet === 'status'} onClose={() => setSheet(null)} title="Status">
        {STATUSES.map((s) => <SheetOption key={s.value} icon={goal.status === s.value ? 'check-circle' : 'circle'} label={s.label} onPress={() => { update({ status: s.value }); setSheet(null); if (s.value === 'completed') router.push({ pathname: '/celebrate', params: { goal: goal.id } }); }} />)}
      </Sheet>
      <Sheet visible={sheet === 'accountability'} onClose={() => setSheet(null)} title="How should Momentum help with this?">
        {ACCOUNTABILITY.map((s) => <SheetOption key={s.value} icon={goal.accountability === s.value ? 'check-circle' : 'circle'} label={s.label} onPress={() => { update({ accountability: s.value }); setSheet(null); }} />)}
      </Sheet>
      <Sheet visible={sheet === 'more'} onClose={() => setSheet(null)}>
        <SheetOption icon="refresh-cw" label="Regenerate suggested steps" onPress={() => { setSheet(null); generate(true); }} />
        <SheetOption icon="help-circle" label="Help me find the blocker" onPress={findBlockers} />
        <SheetOption icon="pause" label={goal.status === 'paused' ? 'Resume' : 'Pause'} onPress={() => { update({ status: goal.status === 'paused' ? 'active' : 'paused' }); setSheet(null); }} />
        <SheetOption icon="check-circle" label="Mark project complete" onPress={() => { update({ status: 'completed' }); setSheet(null); router.push({ pathname: '/celebrate', params: { goal: goal.id } }); }} />
        <SheetOption icon="archive" label="Archive (history is kept)" onPress={() => { update({ status: 'archived' }); setSheet(null); }} />
      </Sheet>
      <TextSheet visible={sheet === 'add'} title="Add a step" initial="" placeholder="e.g. Locate the latest version" onClose={() => setSheet(null)} onSave={(v) => v && store.createAction({ title: v, goal_id: goal.id })} />
      <Sheet visible={sheet === 'blockers'} onClose={() => setSheet(null)} title="Let's find a way in">
        {!blockers ? <ActivityIndicator color={colors.pink} /> : (
          <>
            <Muted style={{ marginBottom: 8 }}>Things that sometimes get in the way (just possibilities):</Muted>
            {blockers.possible_blockers.map((b) => <Body key={b} style={{ marginBottom: 6 }}>• {b}</Body>)}
            {blockers.question && <Banner text={blockers.question} />}
            {blockers.smaller_step && (
              <Card style={{ marginTop: 10 }}>
                <Muted>A smaller step</Muted>
                <Body style={{ fontFamily: fonts.medium, marginVertical: 4 }}>{blockers.smaller_step.title}</Body>
                <Button title="Add this step" variant="soft" onPress={async () => { await store.createAction({ title: blockers.smaller_step!.title, goal_id: goal.id, estimated_minutes: blockers.smaller_step!.estimated_minutes, origin: 'ai', sort_order: -1 }); setSheet(null); }} />
              </Card>
            )}
            <SheetOption icon="clock" label="I'm waiting on something" onPress={() => { update({ status: 'waiting' }); setSheet(null); }} />
            <SheetOption icon="pause" label="Pause this goal" onPress={() => { update({ status: 'paused' }); setSheet(null); }} />
            <SheetOption icon="edit-3" label="Write down what's in the way" onPress={() => { setSheet(null); setTab('notes'); }} />
          </>
        )}
      </Sheet>
      <EditActionSheet action={editAction} onClose={() => setEditAction(null)} siblings={actions} />
    </Screen>
  );
}

function TextSheet({ visible, title, initial, onClose, onSave, multiline, placeholder }: { visible: boolean; title: string; initial: string; onClose: () => void; onSave: (v: string) => void; multiline?: boolean; placeholder?: string }) {
  const [v, setV] = useState(initial);
  useEffect(() => { if (visible) setV(initial); }, [visible, initial]);
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <Field value={v} onChangeText={setV} multiline={multiline} placeholder={placeholder} autoFocus />
      <Button title="Save" onPress={() => { onSave(v.trim()); onClose(); }} />
    </Sheet>
  );
}

function DeadlineSheet({ visible, goal, onClose, onSave }: { visible: boolean; goal: Goal; onClose: () => void; onSave: (p: Partial<Goal>) => void }) {
  const [date, setDate] = useState(goal.deadline ?? '');
  const [type, setType] = useState<Goal['deadline_type']>(goal.deadline_type === 'none' ? 'target' : goal.deadline_type);
  useEffect(() => { if (visible) { setDate(goal.deadline ?? ''); setType(goal.deadline_type === 'none' ? 'target' : goal.deadline_type); } }, [visible, goal]);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date);
  return (
    <Sheet visible={visible} onClose={onClose} title="Date">
      <Muted style={{ marginBottom: 10 }}>Dates are optional. A hard deadline has a real outside consequence; a target date is just a hope and can move freely.</Muted>
      <Field label="Date (YYYY-MM-DD)" value={date} onChangeText={setDate} placeholder="2026-11-01" />
      <View style={{ flexDirection: 'row' }}>
        <Chip label="Target date" selected={type === 'target'} onPress={() => setType('target')} />
        <Chip label="Hard deadline" selected={type === 'hard'} onPress={() => setType('hard')} />
      </View>
      <Button title="Save" disabled={!valid} onPress={() => { onSave({ deadline: date, deadline_type: type }); onClose(); }} />
      {goal.deadline && <Button title="Remove date" variant="ghost" onPress={() => { onSave({ deadline: null, deadline_type: 'none' }); onClose(); }} />}
    </Sheet>
  );
}

function EditActionSheet({ action, onClose, siblings }: { action: Action | null; onClose: () => void; siblings: Action[] }) {
  const store = useStore();
  const [title, setTitle] = useState('');
  const [mins, setMins] = useState('');
  useEffect(() => { if (action) { setTitle(action.title); setMins(action.estimated_minutes ? String(action.estimated_minutes) : ''); } }, [action]);
  if (!action) return null;
  const teamId = store.goals.find((g) => g.id === action.goal_id)?.team_id ?? null;
  const deps = store.dependencies.filter((d) => d.action_id === action.id).map((d) => d.depends_on_id);
  const toggleDep = async (other: Action) => {
    if (deps.includes(other.id)) await supabase.from('action_dependencies').delete().eq('action_id', action.id).eq('depends_on_id', other.id);
    else await supabase.from('action_dependencies').insert({ action_id: action.id, depends_on_id: other.id });
    store.refresh();
  };
  return (
    <Sheet visible onClose={onClose} title="Edit step">
      <Field label="Step" value={title} onChangeText={setTitle} />
      <Field label="Minutes (optional)" value={mins} onChangeText={setMins} keyboardType="number-pad" />
      <Button title="Save" disabled={!title.trim()} onPress={() => { store.updateAction(action.id, { title: title.trim(), estimated_minutes: mins ? Math.max(1, Math.min(600, parseInt(mins, 10) || 1)) : null }); onClose(); }} />
      {teamId && (
        <>
          <Muted style={{ marginTop: 14, marginBottom: 6, fontFamily: fonts.medium, color: colors.text }}>Who’s doing it?</Muted>
          <AssignChips teamId={teamId} value={{ assignee_id: action.assignee_id ?? null, assigned_role_id: action.assigned_role_id ?? null }} onChange={(v) => { store.updateAction(action.id, v); onClose(); }} />
        </>
      )}
      <Muted style={{ marginTop: 14, marginBottom: 6, fontFamily: fonts.medium, color: colors.text }}>State</Muted>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {(['ready', 'in_progress', 'waiting', 'blocked'] as const).map((s) => (
          <Chip key={s} label={{ ready: 'Ready', in_progress: 'In progress', waiting: 'Waiting', blocked: 'Blocked' }[s]} selected={action.status === s} onPress={() => { store.updateAction(action.id, { status: s }); onClose(); }} />
        ))}
      </View>
      {siblings.filter((s) => s.id !== action.id && s.status !== 'dismissed' && s.status !== 'completed').length > 0 && (
        <>
          <Muted style={{ marginTop: 8, marginBottom: 6, fontFamily: fonts.medium, color: colors.text }}>Can only start after…</Muted>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {siblings.filter((s) => s.id !== action.id && s.status !== 'dismissed' && s.status !== 'completed').map((s) => <Chip key={s.id} label={s.title} selected={deps.includes(s.id)} onPress={() => toggleDep(s)} />)}
          </View>
        </>
      )}
      <SheetOption icon="trash-2" label="Remove this step" destructive onPress={() => { store.updateAction(action.id, { status: 'dismissed' }); onClose(); }} />
    </Sheet>
  );
}

function Notes({ goalId, rows, reload }: { goalId: string; rows: ContextRow[]; reload: () => void }) {
  const [text, setText] = useState('');
  const add = async (kind: 'note' | 'blocker' | 'instruction') => {
    if (!text.trim()) return;
    await supabase.from('goal_context').insert({ goal_id: goalId, kind, body: text.trim() });
    setText(''); reload();
  };
  return (
    <>
      <Field value={text} onChangeText={setText} placeholder="Notes, instructions, or what's in the way…" multiline />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        <Chip label="Save note" onPress={() => add('note')} />
        <Chip label="Save as instructions" onPress={() => add('instruction')} />
        <Chip label="Save as blocker" onPress={() => add('blocker')} />
      </View>
      {rows.map((r) => (
        <Card key={r.id} style={{ opacity: r.resolved_at ? 0.6 : 1 }}>
          <Muted style={{ textTransform: 'capitalize' }}>{r.kind === 'question' ? 'Question from AI' : r.kind} · {friendlyDate(r.created_at.slice(0, 10))} {timeOfDay(r.created_at)}</Muted>
          <Body style={{ marginTop: 4 }}>{r.body}</Body>
          {(r.kind === 'blocker' || r.kind === 'question') && !r.resolved_at && (
            <Pressable onPress={async () => { await supabase.from('goal_context').update({ resolved_at: new Date().toISOString() }).eq('id', r.id); reload(); }} style={{ marginTop: 8 }} accessibilityRole="button">
              <Text style={{ color: colors.teal, fontFamily: fonts.medium }}>{r.kind === 'blocker' ? 'Mark resolved' : 'Mark answered'}</Text>
            </Pressable>
          )}
        </Card>
      ))}
    </>
  );
}
