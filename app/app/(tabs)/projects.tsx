import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { OrganizeSheet } from '../../src/components/OrganizeSheet';
import { TaskList, useOpenTasks } from '../../src/components/TaskList';
import { Body, Card, H1, Icon, IconButton, Muted, ProgressBar, Screen } from '../../src/components/ui';
import { daysUntil, shortDate } from '../../src/core/dates';
import { goalProgress } from '../../src/core/recommend';
import type { Action, Goal } from '../../src/core/types';
import { projectHealth } from '../../src/core/workload';
import { goalIcon } from '../../src/lib/icons';
import { useStore } from '../../src/lib/store';
import { colors, fonts, radius } from '../../src/theme';

// To-dos: every open task, viewed by project (each project with its steps, then tasks without one, by life area) or
// as one list grouped by life area or by date. Every row shows when it was added and whether you or Momentum added it.

type View_ = 'projects' | 'all';
type Group = 'area' | 'date';

const LIVE: Goal['status'][] = ['active', 'waiting', 'blocked', 'paused'];
const STATUS_LABEL: Partial<Record<Goal['status'], string>> = { waiting: 'Waiting', blocked: 'Blocked', paused: 'Paused' };

/** The small switch on the left: by project or all tasks. */
function MiniTabs<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string; icon: React.ComponentProps<typeof Icon>['name'] }[]; onChange: (v: T) => void }) {
  return (
    <View style={{ flexDirection: 'row', backgroundColor: colors.card, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, padding: 3 }} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} onPress={() => onChange(o.value)} accessibilityRole="tab" accessibilityState={{ selected: on }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: on ? colors.pink : 'transparent' }}>
            <Icon name={o.icon} size={13} color={on ? colors.white : colors.textMuted} />
            <Text style={{ fontFamily: fonts.medium, fontSize: 12, color: on ? colors.white : colors.text }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function SectionHeader({ color, title, count, onPress }: { color?: string; title: string; count: number; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? 'button' : 'header'}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14, marginBottom: 2 }}>
      {color && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} />}
      <Text style={{ fontFamily: fonts.semibold, fontSize: 13, letterSpacing: 0.5, color: colors.textMuted, flex: 1 }}>{title.toUpperCase()}</Text>
      <Muted>{count}</Muted>
    </Pressable>
  );
}

export default function Todos() {
  const store = useStore();
  const [view, setView] = useState<View_>('projects');
  const [group, setGroup] = useState<Group>('area');
  const [organizing, setOrganizing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const open = useOpenTasks();
  const everyone = useOpenTasks(undefined, true);
  const inactivity = store.accountability?.inactivity_days ?? 10;

  const areaOf = (a: Action) => a.life_area_id ?? store.goals.find((g) => g.id === a.goal_id)?.life_area_id ?? null;
  const areas = store.lifeAreas.filter((x) => !x.archived_at);
  const projects = store.goals.filter((g) => LIVE.includes(g.status));
  const finishedProjects = store.goals.filter((g) => g.status === 'completed' || g.status === 'archived');
  const standalone = open.filter((a) => !a.goal_id);
  const loose = standalone.filter((a) => !a.life_area_id);

  // All tasks, grouped by life area or by when they're due.
  const groups = useMemo(() => {
    if (group === 'area') {
      return [
        ...areas.map((x) => ({ key: x.id, title: x.name, color: x.color, tasks: open.filter((a) => areaOf(a) === x.id) })),
        { key: 'none', title: 'No life area', color: colors.textFaint, tasks: open.filter((a) => !areaOf(a) || !areas.some((x) => x.id === areaOf(a))) },
      ].filter((g) => g.tasks.length);
    }
    const bucket = (a: Action) => {
      if (!a.due_date || a.deadline_type === 'none') return 'No date';
      const d = daysUntil(a.due_date);
      return d < 0 ? 'Overdue' : d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : d <= 7 ? 'This week' : 'Later';
    };
    const order = ['Overdue', 'Today', 'Tomorrow', 'This week', 'Later', 'No date'];
    const color: Record<string, string> = { Overdue: colors.pinkDeep, Today: colors.amber, Tomorrow: colors.amber, 'This week': colors.teal, Later: colors.lavender, 'No date': colors.textFaint };
    return order.map((t) => ({ key: t, title: t, color: color[t], tasks: open.filter((a) => bucket(a) === t) })).filter((g) => g.tasks.length);
  }, [group, open, areas]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8, marginBottom: 12 }}>
        <H1 style={{ flex: 1 }}>To-dos</H1>
        <IconButton name="star" label="Organize" color={colors.pink} onPress={() => setOrganizing(true)} />
        <IconButton name="plus" label="Add a to-do or project" onPress={() => router.push('/capture')} />
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
        <MiniTabs value={view} onChange={setView} options={[{ value: 'projects', label: 'By project', icon: 'folder' }, { value: 'all', label: 'All tasks', icon: 'list' }]} />
        {view === 'all' && (
          <MiniTabs value={group} onChange={setGroup} options={[{ value: 'area', label: 'Area', icon: 'grid' }, { value: 'date', label: 'Date', icon: 'calendar' }]} />
        )}
      </View>
      <Muted style={{ marginBottom: 4 }}>{open.length} open · {projects.length} project{projects.length === 1 ? '' : 's'}</Muted>

      {loose.length >= 3 && (
        <Pressable onPress={() => setOrganizing(true)} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: colors.pinkWash, marginTop: 8, alignSelf: 'flex-start' }}>
          <Icon name="star" size={14} color={colors.pinkDeep} />
          <Text style={{ fontFamily: fonts.medium, color: colors.pinkDeep, fontSize: 13 }}>{loose.length} unsorted · Organize them</Text>
        </Pressable>
      )}
      {note && <Muted style={{ color: colors.teal, marginTop: 8 }}>{note}</Muted>}

      {view === 'projects' && (
        <>
          {projects.map((g) => {
            const { done, total } = goalProgress(g.id, store.allActions);
            const area = store.lifeAreas.find((x) => x.id === g.life_area_id);
            const health = g.status === 'active' ? projectHealth(g, store.allActions, new Date(), inactivity) : null;
            const healthColor = health?.tone === 'warn' ? '#B7791F' : health?.tone === 'good' ? colors.teal : '#7A5FB8';
            const steps = everyone.filter((a) => a.goal_id === g.id);
            return (
              <Card key={g.id} style={{ marginTop: 12 }}>
                <Pressable onPress={() => router.push({ pathname: '/project/[id]', params: { id: g.id } })} accessibilityRole="button" accessibilityLabel={`Open ${g.title}`}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <Icon name={goalIcon(g, area?.icon)} size={20} color={area?.color ?? colors.text} />
                    <View style={{ flex: 1 }}>
                      <Body style={{ fontFamily: fonts.medium }}>{g.title}</Body>
                      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                        {area && <Muted>{area.name}</Muted>}
                        {g.deadline && <Text style={{ fontFamily: fonts.medium, fontSize: 12, color: g.deadline_type === 'hard' ? colors.pinkDeep : colors.textMuted }}>{g.deadline_type === 'hard' ? 'Due' : 'Target'} {shortDate(g.deadline)}</Text>}
                        {STATUS_LABEL[g.status] && <Muted>{STATUS_LABEL[g.status]}</Muted>}
                        {health && health.state !== 'on_track' && <Text style={{ fontFamily: fonts.medium, fontSize: 12, color: healthColor }}>{health.label}</Text>}
                      </View>
                    </View>
                    <Muted>{done}/{total}</Muted>
                    <Icon name="chevron-right" size={16} color={colors.textFaint} />
                  </View>
                  {total > 0 && <View style={{ flexDirection: 'row', marginTop: 10 }}><ProgressBar done={done} total={total} height={6} /></View>}
                </Pressable>
                <View style={{ marginTop: 6 }}>
                  <TaskList tasks={steps} limit={5} showAdded hideProject />
                  {steps.length === 0 && (
                    <Pressable onPress={() => router.push({ pathname: '/project/[id]', params: { id: g.id } })} accessibilityRole="button" style={{ paddingVertical: 8 }}>
                      <Muted style={{ color: colors.pinkDeep, fontFamily: fonts.medium }}>{total > 0 ? 'All steps done · mark complete or add one ›' : 'No steps yet · add the first one ›'}</Muted>
                    </Pressable>
                  )}
                </View>
              </Card>
            );
          })}

          {standalone.length > 0 && (
            <>
              <SectionHeader title="Not in a project" count={standalone.length} />
              {[...areas.map((x) => ({ key: x.id, title: x.name, color: x.color, tasks: standalone.filter((a) => a.life_area_id === x.id) })),
                { key: 'none', title: 'No life area', color: colors.textFaint, tasks: standalone.filter((a) => !a.life_area_id || !areas.some((x) => x.id === a.life_area_id)) }]
                .filter((s) => s.tasks.length)
                .map((s) => (
                  <Card key={s.key} style={{ marginTop: 8, paddingVertical: 8 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 4 }}>
                      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: s.color }} />
                      <Body style={{ fontFamily: fonts.medium, flex: 1 }}>{s.title}</Body>
                      <Muted>{s.tasks.length}</Muted>
                    </View>
                    <TaskList tasks={s.tasks} limit={6} showAdded hideProject />
                  </Card>
                ))}
            </>
          )}

          {finishedProjects.length > 0 && (
            <>
              <SectionHeader title={`Finished & archived projects`} count={finishedProjects.length} onPress={() => setShowDone(!showDone)} />
              {showDone && finishedProjects.map((g) => (
                <Card key={g.id} onPress={() => router.push({ pathname: '/project/[id]', params: { id: g.id } })} style={{ marginTop: 8, paddingVertical: 12 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <Icon name={g.status === 'completed' ? 'check-circle' : 'archive'} size={18} color={g.status === 'completed' ? colors.teal : colors.textMuted} />
                    <Body style={{ flex: 1 }}>{g.title}</Body>
                    <Muted>{g.status === 'completed' ? 'Done' : 'Archived'}</Muted>
                  </View>
                </Card>
              ))}
            </>
          )}
        </>
      )}

      {view === 'all' && groups.map((s) => (
        <View key={s.key}>
          <SectionHeader color={s.color} title={s.title} count={s.tasks.length} />
          <Card style={{ marginTop: 6, paddingVertical: 4 }}>
            <TaskList tasks={s.tasks} showAdded hideProject={false} />
          </Card>
        </View>
      ))}

      {open.length === 0 && projects.length === 0 && (
        <Card style={{ alignItems: 'center', paddingVertical: 24, marginTop: 12 }}>
          <Muted style={{ textAlign: 'center' }}>Nothing on your list yet. Tap + to add a to-do or describe something you want to achieve.</Muted>
        </Card>
      )}

      <OrganizeSheet visible={organizing} onClose={() => setOrganizing(false)} onApplied={(t) => setNote(t)} />
    </Screen>
  );
}
