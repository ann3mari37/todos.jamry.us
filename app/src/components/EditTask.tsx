import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { friendlyDate, toISODate } from '../core/dates';
import type { Action, DeadlineType } from '../core/types';
import { minutesOf } from '../core/workload';
import { useStore } from '../lib/store';
import { colors, fonts } from '../theme';
import { AssignChips } from './TeamBits';
import { Button, Chip, Field, Muted, Sheet } from './ui';

// Edit anything about a task in one place: name, notes, time, date (and whether it's a real deadline), life area,
// project, who on the team does it (team projects), and whether it's ready or waiting on someone. Opened from the task options sheet on Today and To-dos.

const MINUTES = [5, 10, 15, 30, 45, 60, 90, 120];

function dateChoices(): { label: string; date: string }[] {
  const t = new Date();
  const at = (n: number) => toISODate(new Date(t.getFullYear(), t.getMonth(), t.getDate() + n));
  const toSat = (6 - t.getDay() + 7) % 7 || 7;
  const toMon = (8 - t.getDay()) % 7 || 7;
  return [{ label: 'Today', date: at(0) }, { label: 'Tomorrow', date: at(1) }, { label: 'This weekend', date: at(toSat) }, { label: 'Next week', date: at(toMon) }, { label: 'In 2 weeks', date: at(14) }];
}

function Section({ children }: { children: React.ReactNode }) {
  return <Muted style={{ fontFamily: fonts.medium, color: colors.text, marginTop: 12, marginBottom: 6 }}>{children}</Muted>;
}

export function EditTask({ action, onClose }: { action: Action | null; onClose: () => void }) {
  const store = useStore();
  const [d, setD] = useState<Action | null>(action);
  const [dateText, setDateText] = useState('');
  useEffect(() => { setD(action); setDateText(action?.due_date ?? ''); }, [action]);
  if (!d) return <Sheet visible={false} onClose={onClose}>{null}</Sheet>;

  const set = (p: Partial<Action>) => setD({ ...d, ...p });
  const setDate = (date: string | null, type?: DeadlineType) => {
    setDateText(date ?? '');
    set(date ? { due_date: date, deadline_type: type ?? (d.deadline_type === 'hard' ? 'hard' : 'target') } : { due_date: null, deadline_type: 'none' });
  };
  const teamId = store.goals.find((g) => g.id === d.goal_id)?.team_id ?? null;
  const projects = store.goals.filter((g) => ['active', 'waiting', 'blocked', 'paused'].includes(g.status));
  const areas = store.lifeAreas.filter((a) => !a.archived_at);
  const validTyped = /^\d{4}-\d{2}-\d{2}$/.test(dateText);

  const save = async () => {
    if (!action || !d.title.trim()) return;
    const p: Partial<Action> = {};
    (['title', 'notes', 'estimated_minutes', 'due_date', 'deadline_type', 'life_area_id', 'goal_id', 'status', 'assignee_id', 'assigned_role_id'] as const).forEach((k) => {
      if (d[k] !== action[k]) (p as Record<string, unknown>)[k] = k === 'title' ? d.title.trim() : k === 'notes' ? (d.notes?.trim() || null) : d[k];
    });
    if (Object.keys(p).length) await store.updateAction(action.id, p);
    onClose();
  };

  return (
    <Sheet visible onClose={onClose} title="Edit task">
      <Field label="Task" value={d.title} onChangeText={(title) => set({ title })} />
      <Field label="Notes (optional)" value={d.notes ?? ''} onChangeText={(notes) => set({ notes })} placeholder="Details, links, who to call…" multiline />

      <Section>How long will it take?</Section>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {MINUTES.map((m) => <Chip key={m} label={m < 60 ? `${m} min` : `${m / 60} h`} selected={d.estimated_minutes === m} onPress={() => set({ estimated_minutes: m })} />)}
      </View>
      {!d.estimated_minutes && <Muted>Not set · Momentum guesses about {minutesOf(d)} min</Muted>}

      <Section>When?</Section>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {dateChoices().map((c) => <Chip key={c.label} label={c.label} selected={d.due_date === c.date} onPress={() => setDate(c.date)} />)}
        <Chip label="No date" selected={!d.due_date} onPress={() => setDate(null)} />
      </View>
      <Field label="Or a date (YYYY-MM-DD)" value={dateText} onChangeText={(v) => { setDateText(v); if (/^\d{4}-\d{2}-\d{2}$/.test(v)) setDate(v); }} placeholder={toISODate(new Date())} />
      {d.due_date && (
        <>
          <Muted style={{ marginBottom: 6 }}>{friendlyDate(d.due_date)} · Is there a real consequence if it’s late?</Muted>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            <Chip label="Target date" selected={d.deadline_type !== 'hard'} onPress={() => set({ deadline_type: 'target' })} />
            <Chip label="Hard deadline" selected={d.deadline_type === 'hard'} onPress={() => set({ deadline_type: 'hard' })} />
          </View>
        </>
      )}

      {projects.length > 0 && (
        <>
          <Section>Project</Section>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            <Chip label="None" selected={!d.goal_id} onPress={() => set({ goal_id: null, assignee_id: null, assigned_role_id: null })} />
            {projects.map((g) => <Chip key={g.id} label={g.title} selected={d.goal_id === g.id} onPress={() => set({ goal_id: g.id, ...(g.id === d.goal_id ? {} : { assignee_id: null, assigned_role_id: null }) })} />)}
          </View>
        </>
      )}

      {teamId && (
        <>
          <Section>Who’s doing it?</Section>
          <AssignChips teamId={teamId} value={{ assignee_id: d.assignee_id ?? null, assigned_role_id: d.assigned_role_id ?? null }} onChange={(v) => set(v)} />
        </>
      )}

      <Section>Life area{d.goal_id ? ' (a project’s area is used while it’s in a project)' : ''}</Section>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        <Chip label="None" selected={!d.life_area_id} onPress={() => set({ life_area_id: null })} />
        {areas.map((a) => <Chip key={a.id} label={a.name} color={a.color} selected={d.life_area_id === a.id} onPress={() => set({ life_area_id: a.id })} />)}
      </View>

      <Section>Status</Section>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        <Chip label="Ready" selected={d.status === 'ready' || d.status === 'in_progress'} onPress={() => set({ status: 'ready' })} />
        <Chip label="Waiting on someone" selected={d.status === 'waiting'} onPress={() => set({ status: 'waiting' })} />
        <Chip label="Blocked" selected={d.status === 'blocked'} onPress={() => set({ status: 'blocked' })} />
      </View>

      <Button title="Save changes" onPress={save} disabled={!d.title.trim() || (!!dateText && !validTyped)} style={{ marginTop: 14 }} />
      <Button title="Cancel" variant="ghost" onPress={onClose} />
    </Sheet>
  );
}
