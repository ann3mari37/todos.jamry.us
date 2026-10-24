import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Body, Button, Chip, Field, H1, IconButton, IconCircle, Muted, Screen, Segmented, Sheet } from '../src/components/ui';
import { startOfDay, startOfMonth, startOfWeek, timeOfDay, toISODate } from '../src/core/dates';
import type { Accomplishment } from '../src/core/types';
import { useStore } from '../src/lib/store';
import { colors, fonts } from '../src/theme';

type Range = 'today' | 'week' | 'month' | 'all';

function dayLabel(iso: string) {
  const d = toISODate(new Date(iso));
  const today = toISODate(new Date());
  const yest = toISODate(new Date(Date.now() - 86_400_000));
  if (d === today) return 'Today';
  if (d === yest) return 'Yesterday';
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

export default function History() {
  const store = useStore();
  const [kind, setKind] = useState<'all' | 'unplanned' | 'planned'>('all');
  const [range, setRange] = useState<Range>('all');
  const [area, setArea] = useState<string | null>(null);
  const [goal, setGoal] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);
  const [filters, setFilters] = useState(false);
  const [edit, setEdit] = useState<Accomplishment | null>(null);

  const from = range === 'today' ? startOfDay() : range === 'week' ? startOfWeek() : range === 'month' ? startOfMonth() : null;
  const list = useMemo(() => store.accomplishments.filter((a) =>
    (kind === 'all' || (kind === 'planned' ? a.planned : !a.planned)) &&
    (!from || new Date(a.occurred_at) >= from) &&
    (!area || a.life_area_id === area || store.goals.find((g) => g.id === a.goal_id)?.life_area_id === area) &&
    (!goal || a.goal_id === goal) &&
    (!q || a.title.toLowerCase().includes(q.toLowerCase())),
  ), [store.accomplishments, store.goals, kind, from, area, goal, q]);

  const groups = useMemo(() => {
    const m = new Map<string, Accomplishment[]>();
    for (const a of list) {
      const k = dayLabel(a.occurred_at);
      m.set(k, [...(m.get(k) ?? []), a]);
    }
    return [...m.entries()];
  }, [list]);

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
        <IconButton name="chevron-left" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.navigate('/progress'))} />
        <H1 style={{ flex: 1 }}>History</H1>
        <IconButton name="search" label="Search" onPress={() => setSearching(!searching)} />
        <IconButton name="filter" label="Filters" onPress={() => setFilters(!filters)} />
      </View>
      {searching && <Field value={q} onChangeText={setQ} placeholder="Search accomplishments" autoFocus />}
      {filters && (
        <View style={{ marginBottom: 8 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {(['today', 'week', 'month', 'all'] as Range[]).map((r) => <Chip key={r} label={{ today: 'Today', week: 'This week', month: 'This month', all: 'All time' }[r]} selected={range === r} onPress={() => setRange(r)} />)}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            <Chip label="All areas" selected={!area} onPress={() => setArea(null)} />
            {store.lifeAreas.map((a) => <Chip key={a.id} label={a.name} selected={area === a.id} onPress={() => setArea(a.id)} />)}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            <Chip label="All projects" selected={!goal} onPress={() => setGoal(null)} />
            {store.goals.map((g) => <Chip key={g.id} label={g.title} selected={goal === g.id} onPress={() => setGoal(g.id)} />)}
          </View>
        </View>
      )}
      <Segmented value={kind} onChange={setKind} options={[{ value: 'all', label: 'All' }, { value: 'unplanned', label: 'Accomplishments' }, { value: 'planned', label: 'Actions' }]} style={{ marginVertical: 10 }} />

      {groups.map(([label, items]) => (
        <View key={label}>
          <Body style={{ fontFamily: fonts.semibold, marginTop: 12, marginBottom: 4 }}>{label}</Body>
          {items.map((a) => {
            const g = store.goals.find((x) => x.id === a.goal_id);
            const ar = store.lifeAreas.find((x) => x.id === (a.life_area_id ?? g?.life_area_id));
            return (
              <Pressable key={a.id} onPress={() => setEdit(a)} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, minHeight: 52 }}>
                <IconCircle name="check" color={colors.white} soft={ar?.color ?? (a.meaningful ? colors.teal : colors.green)} size={32} />
                <View style={{ flex: 1 }}>
                  <Body>{a.title}</Body>
                  <Muted>{g?.title ?? ar?.name ?? (a.planned ? 'Planned' : 'Unplanned')}</Muted>
                </View>
                <Muted>{timeOfDay(a.occurred_at)}</Muted>
              </Pressable>
            );
          })}
        </View>
      ))}
      {groups.length === 0 && <Muted style={{ marginTop: 20, textAlign: 'center' }}>Nothing here yet.</Muted>}
      <EditAccomplishment a={edit} onClose={() => setEdit(null)} />
    </Screen>
  );
}

function EditAccomplishment({ a, onClose }: { a: Accomplishment | null; onClose: () => void }) {
  const store = useStore();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [goal, setGoal] = useState<string | null>(null);
  const [areaId, setAreaId] = useState<string | null>(null);
  React.useEffect(() => { if (a) { setTitle(a.title); setDate(toISODate(new Date(a.occurred_at))); setGoal(a.goal_id); setAreaId(a.life_area_id); } }, [a]);
  if (!a) return null;
  const local = a.id.startsWith('local-');
  return (
    <Sheet visible onClose={onClose} title="Edit accomplishment">
      {local && <Muted style={{ marginBottom: 8 }}>Still syncing — you can edit once it's saved.</Muted>}
      <Field label="What you did" value={title} onChangeText={setTitle} />
      <Field label="Date (YYYY-MM-DD)" value={date} onChangeText={setDate} />
      <Muted style={{ fontFamily: fonts.medium, color: colors.text, marginBottom: 6 }}>Project</Muted>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        <Chip label="None" selected={!goal} onPress={() => setGoal(null)} />
        {store.goals.filter((g) => g.status !== 'archived').map((g) => <Chip key={g.id} label={g.title} selected={goal === g.id} onPress={() => setGoal(g.id)} />)}
      </View>
      <Muted style={{ fontFamily: fonts.medium, color: colors.text, marginBottom: 6 }}>Life area</Muted>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        <Chip label="None" selected={!areaId} onPress={() => setAreaId(null)} />
        {store.lifeAreas.filter((x) => !x.archived_at).map((x) => <Chip key={x.id} label={x.name} selected={areaId === x.id} onPress={() => setAreaId(x.id)} />)}
      </View>
      <Button title="Save" disabled={local || !title.trim()} onPress={async () => {
        const time = new Date(a.occurred_at);
        const occurred = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}:00`).toISOString() : a.occurred_at;
        await store.updateAccomplishment(a.id, { title: title.trim(), occurred_at: occurred, goal_id: goal, life_area_id: areaId, meaningful: !!goal && (a.meaningful || goal !== a.goal_id) });
        onClose();
      }} />
      <Button title="Delete this record" variant="ghost" disabled={local} onPress={async () => { await store.deleteAccomplishment(a.id); onClose(); }} />
    </Sheet>
  );
}
