import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { daysUntil, friendlyDate, toISODate } from '../core/dates';
import { looksLikeProject, suggestWhy } from '../core/rules';
import type { Action, DeadlineType } from '../core/types';
import { useStore } from '../lib/store';
import { colors, fonts } from '../theme';
import { Body, Chip, Muted, Sheet, SheetOption } from './ui';

const OPEN: Action['status'][] = ['ready', 'in_progress', 'waiting', 'blocked'];

/** Open tasks, optionally filtered. Every task the user has is reachable from here. Dated tasks come first, soonest on top. */
export function useOpenTasks(filter?: (a: Action) => boolean) {
  const store = useStore();
  return store.actions
    .filter((a) => OPEN.includes(a.status) && (!filter || filter(a)))
    .sort((x, y) =>
      (x.due_date ? 0 : 1) - (y.due_date ? 0 : 1) || (x.due_date ?? '').localeCompare(y.due_date ?? '')
      || (x.goal_id ? 1 : 0) - (y.goal_id ? 1 : 0) || x.created_at.localeCompare(y.created_at));
}

function dueLabel(a: Action): { text: string; urgent: boolean } | null {
  if (!a.due_date || a.deadline_type === 'none') return null;
  const d = daysUntil(a.due_date);
  const when = friendlyDate(a.due_date);
  return { text: d < 0 ? `Was due ${when}` : `Due ${when}`, urgent: d <= 1 && a.deadline_type === 'hard' };
}

const DATE_CHOICES = (): { label: string; date: string }[] => {
  const t = new Date();
  const at = (n: number) => toISODate(new Date(t.getFullYear(), t.getMonth(), t.getDate() + n));
  const toSat = (6 - t.getDay() + 7) % 7 || 7;
  const toMon = (8 - t.getDay()) % 7 || 7;
  return [
    { label: 'Today', date: at(0) },
    { label: 'Tomorrow', date: at(1) },
    { label: 'This weekend', date: at(toSat) },
    { label: 'Next week', date: at(toMon) },
    { label: 'In 2 weeks', date: at(14) },
  ];
};

/** A checklist of tasks: tap the circle to finish, tap the row for options. */
export function TaskList({ tasks, limit, emptyText }: { tasks: Action[]; limit?: number; emptyText?: string }) {
  const store = useStore();
  const [open, setOpen] = useState<Action | null>(null);
  const [panel, setPanel] = useState<'menu' | 'area' | 'due'>('menu');
  const [all, setAll] = useState(false);
  const shown = limit && !all ? tasks.slice(0, limit) : tasks;
  const close = () => { setOpen(null); setPanel('menu'); };

  const complete = async (a: Action) => {
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    close();
    await store.completeAction(a.id);
    router.push({ pathname: '/celebrate', params: { action: a.id } });
  };
  const setDue = (date: string | null, type: DeadlineType = 'target') => {
    if (!open) return;
    store.updateAction(open.id, date ? { due_date: date, deadline_type: type } : { due_date: null, deadline_type: 'none' });
    close();
  };

  if (!tasks.length) return emptyText ? <Muted style={{ marginVertical: 6 }}>{emptyText}</Muted> : null;

  const live = open ? store.actions.find((a) => a.id === open.id) ?? open : null;
  const openGoal = live?.goal_id ? store.goals.find((g) => g.id === live.goal_id) : null;
  const openArea = live ? store.lifeAreas.find((x) => x.id === (live.life_area_id ?? openGoal?.life_area_id)) : null;
  const why = live ? suggestWhy(live.title, { areaName: openArea?.name, minutes: live.estimated_minutes, due: live.due_date ? { date: live.due_date, type: live.deadline_type ?? 'target' } : null }) : null;
  const projectLike = !!live && !live.goal_id && looksLikeProject(live.title);

  const makeProject = async (a: Action) => {
    close();
    const g = await store.createGoal({
      title: a.title, life_area_id: a.life_area_id, deadline: a.due_date ?? null, deadline_type: a.due_date ? a.deadline_type ?? 'target' : 'none',
      meaning: suggestWhy(a.title, { isProject: true, areaName: openArea?.name }), meaning_source: 'ai_suggested',
    });
    await store.updateAction(a.id, { status: 'dismissed' }); // the project replaces the task
    if (g) router.push({ pathname: '/project/[id]', params: { id: g.id } });
  };

  return (
    <View>
      {shown.map((a) => {
        const goal = a.goal_id ? store.goals.find((g) => g.id === a.goal_id) : null;
        const area = store.lifeAreas.find((x) => x.id === (a.life_area_id ?? goal?.life_area_id));
        const due = dueLabel(a);
        const meta = [goal?.title, !goal && area?.name, a.estimated_minutes ? `${a.estimated_minutes} min` : null, a.status === 'waiting' ? 'Waiting' : a.status === 'blocked' ? 'Blocked' : null]
          .filter(Boolean).join(' · ');
        return (
          <View key={a.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, minHeight: 48 }}>
            <Pressable onPress={() => complete(a)} accessibilityRole="checkbox" accessibilityState={{ checked: false }} accessibilityLabel={`Complete ${a.title}`} hitSlop={8}
              style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: colors.textFaint, alignItems: 'center', justifyContent: 'center' }} />
            <Pressable style={{ flex: 1 }} onPress={() => setOpen(a)} accessibilityRole="button" accessibilityLabel={`Options for ${a.title}`}>
              <Body>{a.title}</Body>
              {(meta || due) ? (
                <Muted numberOfLines={1}>
                  {due ? <Muted style={{ color: due.urgent ? colors.pinkDeep : colors.textMuted, fontFamily: fonts.medium }}>{due.text}{meta ? ' · ' : ''}</Muted> : null}
                  {meta}
                </Muted>
              ) : null}
            </Pressable>
            {area && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: area.color }} />}
          </View>
        );
      })}
      {limit && tasks.length > limit && (
        <Pressable onPress={() => setAll(!all)} accessibilityRole="button" style={{ paddingVertical: 10, minHeight: 44 }}>
          <Muted style={{ color: colors.pinkDeep, fontFamily: fonts.medium }}>{all ? 'Show fewer' : `Show all ${tasks.length} tasks`}</Muted>
        </Pressable>
      )}

      <Sheet visible={!!live} onClose={close} title={live?.title}>
        {live && panel === 'menu' && (
          <>
            {why && <Muted style={{ marginBottom: 6 }}>Why it matters: {why}</Muted>}
            <SheetOption icon="check-circle" label="Mark done" onPress={() => complete(live)} />
            {!live.goal_id && <SheetOption icon="folder-plus" label={projectLike ? 'Turn into a project (it has several steps)' : 'Make this a project'} onPress={() => makeProject(live)} />}
            <SheetOption icon="calendar" label={live.due_date ? `Due date: ${friendlyDate(live.due_date)}` : 'Set a due date'} onPress={() => setPanel('due')} />
            {!live.goal_id && <SheetOption icon="grid" label={`Life area: ${store.lifeAreas.find((x) => x.id === live.life_area_id)?.name ?? 'none'}`} onPress={() => setPanel('area')} />}
            {openGoal && <SheetOption icon="folder" label={`Open project: ${openGoal.title}`} onPress={() => { close(); router.push({ pathname: '/project/[id]', params: { id: openGoal.id } }); }} />}
            {live.status !== 'waiting'
              ? <SheetOption icon="clock" label="I'm waiting on something" onPress={() => { store.updateAction(live.id, { status: 'waiting' }); close(); }} />
              : <SheetOption icon="play" label="Ready again" onPress={() => { store.updateAction(live.id, { status: 'ready' }); close(); }} />}
            <SheetOption icon="x-circle" label="Remove from my list" destructive onPress={() => { store.updateAction(live.id, { status: 'dismissed' }); close(); }} />
          </>
        )}
        {live && panel === 'area' && (
          <>
            <Muted style={{ marginBottom: 8 }}>Which part of life is this for?</Muted>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {store.lifeAreas.filter((x) => !x.archived_at).map((x) => (
                <Chip key={x.id} label={x.name} selected={live.life_area_id === x.id} onPress={() => { store.updateAction(live.id, { life_area_id: x.id }); close(); }} />
              ))}
              <Chip label="None" selected={!live.life_area_id} onPress={() => { store.updateAction(live.id, { life_area_id: null }); close(); }} />
            </View>
          </>
        )}
        {live && panel === 'due' && (
          <>
            <Muted style={{ marginBottom: 8 }}>When should this be done?</Muted>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {DATE_CHOICES().map((c) => <Chip key={c.label} label={c.label} selected={live.due_date === c.date} onPress={() => setDue(c.date, live.deadline_type === 'hard' ? 'hard' : 'target')} />)}
              {live.due_date && <Chip label="No date" onPress={() => setDue(null)} />}
            </View>
            {live.due_date && (
              <>
                <Muted style={{ marginTop: 10, marginBottom: 6 }}>Is there a real consequence if it's late?</Muted>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                  <Chip label="Target date" selected={live.deadline_type !== 'hard'} onPress={() => setDue(live.due_date!, 'target')} />
                  <Chip label="Hard deadline" selected={live.deadline_type === 'hard'} onPress={() => setDue(live.due_date!, 'hard')} />
                </View>
              </>
            )}
          </>
        )}
      </Sheet>
    </View>
  );
}
