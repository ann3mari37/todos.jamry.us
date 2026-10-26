import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { dueToRevisit, revisitIn, revisitLabel } from '../core/parked';
import type { Goal } from '../core/types';
import { useStore } from '../lib/store';
import { supabase } from '../lib/supabase';
import { colors, fonts, radius, shadow } from '../theme';
import { Body, Button, Card, Chip, Field, Icon, Muted, Sheet } from './ui';

// Parking: an idea that needs working out but isn't ready to unpack into steps. It keeps its notes, stays out of
// Today and the task lists, and comes back on its revisit date (or when your AI chat sees the moment has come).

const WHEN = [
  { label: 'In 2 weeks', days: 14 },
  { label: 'In a month', days: 30 },
  { label: 'In 3 months', days: 90 },
];

/** Park an existing project, change when it comes back, or (no goal) park a new idea. */
export function ParkSheet({ visible, goal, onClose }: { visible: boolean; goal?: Goal | null; onClose: () => void }) {
  const store = useStore();
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [on, setOn] = useState<string | null>(null);
  const [when, setWhen] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!visible) return;
    setTitle(''); setNote('');
    setOn(goal?.revisit_on ?? revisitIn(30));
    setWhen(goal?.revisit_when ?? '');
  }, [visible, goal]);

  const save = async () => {
    setBusy(true);
    const p = { status: 'parked' as const, revisit_on: on, revisit_when: when.trim() || null };
    try {
      if (goal) await store.updateGoal(goal.id, p);
      else {
        const g = await store.createGoal({ title: title.trim(), ...p });
        if (g && note.trim()) { await supabase.from('goal_context').insert({ goal_id: g.id, kind: 'note', body: note.trim() }); }
      }
      onClose();
    } finally { setBusy(false); }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={goal ? (goal.status === 'parked' ? 'When should this come back?' : 'Park this project') : 'Park an idea'}>
      <Muted style={{ marginBottom: 10 }}>Parked ideas stay out of Today and your lists until it’s time. Your AI chat can help work them out and will bring them up when they fit.</Muted>
      {!goal && (
        <>
          <Field label="The idea" value={title} onChangeText={setTitle} placeholder="e.g. Group coaching program" />
          <Field label="What you know so far (optional)" value={note} onChangeText={setNote} placeholder="Questions, constraints, who it’s for…" multiline />
        </>
      )}
      <Muted style={{ marginTop: 4, marginBottom: 6 }}>Bring it back</Muted>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {WHEN.map((w) => { const d = revisitIn(w.days); return <Chip key={w.label} label={w.label} selected={on === d} onPress={() => setOn(d)} />; })}
        <Chip label="No date" selected={!on} onPress={() => setOn(null)} />
      </View>
      <Field label="Or when… (optional)" value={when} onChangeText={setWhen} placeholder="e.g. after the review system launches" />
      <Button title={goal ? 'Park it' : 'Park this idea'} loading={busy} disabled={busy || (!goal && !title.trim())} onPress={save} style={{ marginTop: 6 }} />
    </Sheet>
  );
}

/** To-dos: the parked ideas, folded away until opened. */
export function ParkedSection() {
  const store = useStore();
  const [open, setOpen] = useState(false);
  const [parking, setParking] = useState(false);
  const parked = store.goals.filter((g) => g.status === 'parked').sort((a, b) => (a.revisit_on ?? '9999').localeCompare(b.revisit_on ?? '9999'));
  return (
    <View style={{ marginTop: 18 }}>
      <Pressable onPress={() => setOpen(!open)} accessibilityRole="button" accessibilityState={{ expanded: open }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, minHeight: 44 }}>
        <Icon name="archive" size={16} color={colors.textMuted} />
        <Text style={{ flex: 1, fontFamily: fonts.medium, fontSize: 15, color: colors.text }}>Parked ideas{parked.length ? ` · ${parked.length}` : ''}</Text>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textFaint} />
      </Pressable>
      {open && (
        <>
          {parked.length === 0 && <Muted style={{ marginBottom: 8 }}>Nothing parked. Park ideas that need working out but aren’t ready to become steps.</Muted>}
          {parked.map((g) => (
            <Card key={g.id} style={{ marginBottom: 8 }} onPress={() => router.push({ pathname: '/project/[id]', params: { id: g.id } })} accessibilityLabel={`Open ${g.title}`}>
              <Body style={{ fontFamily: fonts.medium }}>{g.title}</Body>
              {g.description && <Muted style={{ marginTop: 2 }} numberOfLines={2}>{g.description}</Muted>}
              <Muted style={{ marginTop: 2 }}>{revisitLabel(g)}</Muted>
            </Card>
          ))}
          <Button title="Park an idea" icon="plus" variant="soft" onPress={() => setParking(true)} />
        </>
      )}
      <ParkSheet visible={parking} onClose={() => setParking(false)} />
    </View>
  );
}

/** Today: a parked idea whose revisit date has come. Unpack it, or push it back. */
export function RevisitCard() {
  const store = useStore();
  const g = dueToRevisit(store.goals)[0];
  if (!g) return null;
  const more = dueToRevisit(store.goals).length - 1;
  return (
    <View style={[{ backgroundColor: colors.card, borderRadius: radius.lg, padding: 16, borderWidth: 1, borderColor: colors.border, marginBottom: 12 }, shadow]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name="archive" size={16} color={colors.pink} />
        <Text style={{ fontFamily: fonts.medium, fontSize: 13, color: colors.pinkDeep }}>Parked idea · ready to look at again</Text>
      </View>
      <Body style={{ fontFamily: fonts.medium, fontSize: 17, marginTop: 6 }}>{g.title}</Body>
      {g.revisit_when && <Muted style={{ marginTop: 2 }}>You said: revisit {g.revisit_when.replace(/^(when|after)\s+/i, (m) => m.toLowerCase())}</Muted>}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
        <Button title="Unpack it" icon="box" onPress={async () => { await store.updateGoal(g.id, { status: 'active', revisit_on: null }); router.push({ pathname: '/project/[id]', params: { id: g.id } }); }} style={{ minHeight: 42 }} />
        <Button title="Not yet" variant="ghost" onPress={() => store.updateGoal(g.id, { revisit_on: revisitIn(14) })} style={{ minHeight: 42 }} />
      </View>
      {more > 0 && <Muted style={{ marginTop: 6 }}>{more} more parked idea{more === 1 ? '' : 's'} ready in To-dos.</Muted>}
    </View>
  );
}
