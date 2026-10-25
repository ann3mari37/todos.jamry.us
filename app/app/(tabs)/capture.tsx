import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, Switch, Text, TextInput, View } from 'react-native';
import { Banner, Body, Button, Card, Chip, Field, H1, Icon, IconCircle, Muted, Screen, Sheet, type IconName } from '../../src/components/ui';
import type { CaptureItem, CommitItem } from '../../src/core/ai-contracts';
import { toISODate } from '../../src/core/dates';
import { fallbackInterpret, guessLifeArea } from '../../src/core/fallback-capture';
import { suggestSteps } from '../../src/core/templates';
import { useStore, uuid } from '../../src/lib/store';
import { useSpeech } from '../../src/lib/useSpeech';
import { colors, fonts, radius, shadow } from '../../src/theme';

type Draft = CaptureItem & { client_id: string; meaning: string; meaningful: boolean; matches_action_id: string | null };
type Mode = 'any' | 'did' | 'goal';

const KIND_META: Record<Draft['kind'], { label: string; icon: IconName; color: string; soft: string }> = {
  goal: { label: 'Project', icon: 'folder', color: colors.pink, soft: colors.pinkWash },
  action: { label: 'Action', icon: 'arrow-right-circle', color: colors.teal, soft: colors.tealSoft },
  accomplishment: { label: 'Accomplishment', icon: 'check-circle', color: colors.green, soft: colors.greenSoft },
  note: { label: 'Note', icon: 'edit-3', color: colors.lavender, soft: colors.lavenderSoft },
};

const blank = (p: Partial<Draft>): Draft => ({
  kind: 'action', title: '', source_excerpt: '', estimated_minutes: null, suggested_goal_id: null, suggested_life_area_id: null,
  possible_duplicate_of: null, deadline: null, deadline_type: 'none', occurred_at: null, confidence: 1, next_actions: [],
  client_id: uuid(), meaning: '', meaningful: false, matches_action_id: null, ...p,
});

export default function Capture() {
  const params = useLocalSearchParams<{ mode?: string; goal?: string }>();
  const mode: Mode = params.mode === 'did' ? 'did' : params.mode === 'goal' ? 'goal' : 'any';
  const store = useStore();
  const [text, setText] = useState('');
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [captureId, setCaptureId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [questions, setQuestions] = useState<string[]>([]);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [source, setSource] = useState<'text' | 'voice'>('text');

  const reset = useCallback(() => {
    setText(''); setDrafts(null); setCaptureId(null); setNotice(null); setQuestions([]);
  }, []);
  useEffect(reset, [params.mode, params.goal, reset]);

  const speech = useSpeech(useCallback((t: string) => { setSource('voice'); setText((prev) => (prev ? `${prev} ${t}` : t)); }, []));

  // Organizing is rule-based: instant, free, and works offline. You review everything before it's saved.
  const interpret = () => {
    const raw = text.trim();
    if (!raw) return;
    setNotice(null); setQuestions([]); setCaptureId(null);
    const goals = store.goals.filter((g) => ['active', 'waiting', 'blocked'].includes(g.status));
    const local = mode === 'goal'
      ? { items: [blank({ kind: 'goal', title: raw.slice(0, 200), source_excerpt: raw, suggested_life_area_id: guessLifeArea(raw, store.lifeAreas),
          next_actions: suggestSteps(raw).steps.slice(0, 3).map((st) => ({ title: st.title, estimated_minutes: st.minutes })) })] }
      : fallbackInterpret(raw, store.lifeAreas, goals);
    setDrafts(local.items.map((i) => {
      const goalId = params.goal ?? i.suggested_goal_id;
      return blank({ ...i, kind: mode === 'did' ? 'accomplishment' : i.kind, suggested_goal_id: goalId, meaningful: !!goalId && (mode === 'did' || !!params.goal) });
    }));
  };

  const save = async () => {
    if (!drafts?.length) return;
    setSaving(true);
    try {
      // Accomplishments that finish an existing step complete that step instead of duplicating it.
      const viaAction = drafts.filter((d) => d.kind === 'accomplishment' && d.matches_action_id);
      for (const d of viaAction) await store.completeAction(d.matches_action_id!);
      const validDate = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
      const items: CommitItem[] = drafts.filter((d) => !viaAction.includes(d)).map((d) => ({
        client_id: d.client_id, kind: d.kind, title: d.title.trim(), goal_id: d.kind === 'goal' ? null : d.suggested_goal_id,
        life_area_id: d.suggested_life_area_id, estimated_minutes: d.estimated_minutes, deadline: validDate(d.deadline),
        deadline_type: validDate(d.deadline) ? (d.deadline_type === 'none' ? 'target' : d.deadline_type) : 'none',
        occurred_at: d.occurred_at, meaningful: d.meaningful && !!d.suggested_goal_id,
        next_actions: d.kind === 'goal' ? d.next_actions.filter((n) => n.title.trim()) : [],
        ...(d.kind === 'goal' && d.meaning.trim() ? { meaning: d.meaning.trim() } : {}),
      }));
      if (items.length) await store.commitCapture(text, mode === 'did' ? 'accomplishment' : source, captureId, items);
      const n = drafts.length;
      reset();
      if (mode === 'did' || drafts.every((d) => d.kind === 'accomplishment')) router.push({ pathname: '/celebrate', params: { count: String(n) } });
      else router.navigate(params.goal ? { pathname: '/project/[id]', params: { id: params.goal } } : '/today');
    } catch (e) {
      setNotice(`Couldn't save: ${(e as Error).message}. Your text is still here.`);
    } finally {
      setSaving(false);
    }
  };

  const update = (d: Draft) => setDrafts((list) => list?.map((x) => (x.client_id === d.client_id ? d : x)) ?? null);
  const remove = (d: Draft) => setDrafts((list) => list?.filter((x) => x.client_id !== d.client_id) ?? null);
  const addManual = () => {
    const d = blank({ kind: mode === 'did' ? 'accomplishment' : mode === 'goal' ? 'goal' : 'action', suggested_goal_id: params.goal ?? null });
    setDrafts((l) => [...(l ?? []), d]);
    setEditing(d);
  };

  const title = mode === 'did' ? 'Look what you did!' : mode === 'goal' ? 'What would you like to achieve?' : "What's on your mind?";
  const subtitle = mode === 'did'
    ? 'List anything you got done — planned or not. It all counts.'
    : mode === 'goal' ? 'Describe the outcome. You don’t need a plan — we’ll find a first step.'
    : 'Add anything — a goal, a task, an idea, or something you already got done.';

  return (
    <Screen>
      <Pressable onPress={() => (drafts ? reset() : router.canGoBack() ? router.back() : router.navigate('/today'))} accessibilityRole="button" style={{ paddingVertical: 12, alignSelf: 'flex-start' }}>
        <Body style={{ fontFamily: fonts.medium }}>Cancel</Body>
      </Pressable>
      <H1>{title}</H1>
      <Muted style={{ fontSize: 15, marginTop: 6, marginBottom: 18 }}>{subtitle}</Muted>

      {!drafts && (
        <>
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
            <Method icon="edit-2" label="Type" active={speech.state === 'idle'} onPress={() => {}} />
            <Method icon={speech.state === 'listening' ? 'square' : 'mic'} label={speech.state === 'listening' ? 'Stop' : speech.state === 'transcribing' ? '…' : 'Speak'} active={speech.state !== 'idle'} onPress={speech.toggle} />
            <Method icon="camera" label="Photo" onPress={() => setNotice('Photo capture is planned for a later phase. For now, type or speak it.')} />
            <Method icon="paperclip" label="File" onPress={() => setNotice('File attachments are planned for a later phase.')} />
          </View>
          {speech.state === 'listening' && <Banner text="Listening… tap Stop when you're done." />}
          {speech.state === 'transcribing' && <Banner text="Turning your words into text…" />}
          {speech.error && <Banner tone="soft" text={speech.error} />}
          <View style={[{ backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: 14, minHeight: 150 }, shadow]}>
            <TextInput
              value={text}
              onChangeText={setText}
              multiline
              autoFocus={false}
              placeholder={mode === 'did' ? 'Called the insurance company, cleaned the kitchen counter, 30 min workout…' : 'Submit the document, call the insurance company, and I already paid the electric bill…'}
              placeholderTextColor={colors.textFaint}
              accessibilityLabel="Capture text"
              style={{ fontFamily: fonts.body, fontSize: 16, color: colors.text, minHeight: 100, textAlignVertical: 'top', paddingRight: 48 }}
            />
            <Pressable
              onPress={interpret}
              disabled={!text.trim()}
              accessibilityRole="button"
              accessibilityLabel="Organize this"
              style={{ position: 'absolute', right: 12, bottom: 12, width: 40, height: 40, borderRadius: 20, backgroundColor: text.trim() ? colors.pink : colors.pinkSoft, alignItems: 'center', justifyContent: 'center' }}
            >
              <Icon name="arrow-up" size={20} color={colors.white} />
            </Pressable>
          </View>
          {notice && <Banner tone="soft" text={notice} />}
          <Button variant="ghost" title={mode === 'did' ? 'Add one by hand' : 'Skip AI and add by hand'} onPress={addManual} />
        </>
      )}

      {drafts && (
        <>
          <View style={[{ backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 12 }]}>
            <Muted numberOfLines={4}>{text || 'Added by hand'}</Muted>
          </View>
          {notice && <Banner tone="soft" text={notice} />}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginVertical: 8 }}>
            <Icon name="star" size={14} color={colors.pink} />
            <Text style={{ fontFamily: fonts.medium, color: colors.pinkDeep }}>Here's how I organized it — tap Edit to change anything.</Text>
          </View>
          {questions.map((q) => <Banner key={q} text={q} />)}
          {drafts.map((d) => <ReviewRow key={d.client_id} d={d} onEdit={() => setEditing(d)} />)}
          <Button title="Add another item" variant="ghost" icon="plus" onPress={addManual} />
          <Button title={mode === 'did' ? 'Save to my history' : 'Add to My Plan'} onPress={save} loading={saving} disabled={!drafts.length || drafts.some((d) => !d.title.trim())} style={{ marginTop: 8 }} />
        </>
      )}

      <EditDraft draft={editing} onClose={() => setEditing(null)} onSave={(d) => { update(d); setEditing(null); }} onRemove={(d) => { remove(d); setEditing(null); }} />
    </Screen>
  );
}

function Method({ icon, label, onPress, active }: { icon: IconName; label: string; onPress: () => void; active?: boolean }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={[{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: radius.md, backgroundColor: active ? colors.pinkWash : colors.card, borderWidth: 1, borderColor: active ? colors.pinkSoft : colors.border, gap: 6 }]}>
      <Icon name={icon} size={22} color={active ? colors.pink : colors.text} />
      <Text style={{ fontFamily: fonts.medium, fontSize: 12, color: active ? colors.pinkDeep : colors.text }}>{label}</Text>
    </Pressable>
  );
}

function ReviewRow({ d, onEdit }: { d: Draft; onEdit: () => void }) {
  const store = useStore();
  const meta = KIND_META[d.kind];
  const goal = d.suggested_goal_id ? store.goals.find((g) => g.id === d.suggested_goal_id) : null;
  const dup = d.possible_duplicate_of
    ? store.goals.find((g) => g.id === d.possible_duplicate_of)?.title ?? store.actions.find((a) => a.id === d.possible_duplicate_of)?.title ?? store.accomplishments.find((a) => a.id === d.possible_duplicate_of)?.title
    : null;
  const parts = [meta.label];
  if (d.kind === 'goal' && d.next_actions.length) parts.push(`${d.next_actions.length} next step${d.next_actions.length === 1 ? '' : 's'}`);
  if (d.estimated_minutes && d.kind === 'action') parts.push(`${d.estimated_minutes} min`);
  if (goal) parts.push(d.kind === 'accomplishment' && d.meaningful ? `advances ${goal.title}` : goal.title);
  const area = !goal && d.suggested_life_area_id ? store.lifeAreas.find((x) => x.id === d.suggested_life_area_id) : null;
  if (area) parts.push(area.name);
  if (d.matches_action_id) parts.push('completes a planned step');
  if (d.deadline) parts.push(`${d.deadline_type === 'hard' ? 'Due' : 'Target'} ${d.deadline}`);
  return (
    <Card style={{ paddingVertical: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <IconCircle name={meta.icon} color={meta.color} soft={meta.soft} size={38} />
        <View style={{ flex: 1 }}>
          <Body style={{ fontFamily: fonts.medium }}>{d.title || 'Untitled'}</Body>
          <Muted>{parts.join(' · ')}</Muted>
          {dup && <Muted style={{ color: colors.pinkDeep }}>Looks similar to “{dup}”</Muted>}
        </View>
        <Pressable onPress={onEdit} accessibilityRole="button" accessibilityLabel={`Edit ${d.title}`} style={{ backgroundColor: colors.pinkWash, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 }}>
          <Text style={{ color: colors.pinkDeep, fontFamily: fonts.medium, fontSize: 12 }}>Edit</Text>
        </Pressable>
      </View>
    </Card>
  );
}

function EditDraft({ draft, onClose, onSave, onRemove }: { draft: Draft | null; onClose: () => void; onSave: (d: Draft) => void; onRemove: (d: Draft) => void }) {
  const store = useStore();
  const [d, setD] = useState<Draft | null>(draft);
  useEffect(() => setD(draft), [draft]);
  if (!d) return <Sheet visible={false} onClose={onClose}>{null}</Sheet>;
  const set = (p: Partial<Draft>) => setD({ ...d, ...p });
  const goals = store.goals.filter((g) => ['active', 'waiting', 'blocked'].includes(g.status));
  const areas = store.lifeAreas.filter((a) => !a.archived_at);
  const yesterday = new Date(Date.now() - 86_400_000);
  return (
    <Sheet visible onClose={onClose} title="Edit item">
      <Field label="Title" value={d.title} onChangeText={(title) => set({ title })} />
      <Muted style={{ fontFamily: fonts.medium, color: colors.text, marginBottom: 6 }}>This is a…</Muted>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {(Object.keys(KIND_META) as Draft['kind'][]).map((k) => <Chip key={k} label={KIND_META[k].label} selected={d.kind === k} onPress={() => set({ kind: k })} />)}
      </View>

      {d.kind !== 'goal' && goals.length > 0 && (
        <>
          <Muted style={{ fontFamily: fonts.medium, color: colors.text, marginVertical: 6 }}>Part of a project?</Muted>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            <Chip label="None" selected={!d.suggested_goal_id} onPress={() => set({ suggested_goal_id: null, meaningful: false })} />
            {goals.map((g) => <Chip key={g.id} label={g.title} selected={d.suggested_goal_id === g.id} onPress={() => set({ suggested_goal_id: g.id, meaningful: d.kind === 'accomplishment' ? true : d.meaningful })} />)}
          </View>
        </>
      )}
      {d.kind === 'accomplishment' && d.suggested_goal_id && (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: 8 }}>
          <Body style={{ flex: 1 }}>This moved the project forward</Body>
          <Switch value={d.meaningful} onValueChange={(meaningful) => set({ meaningful })} trackColor={{ true: colors.teal }} />
        </View>
      )}

      <Muted style={{ fontFamily: fonts.medium, color: colors.text, marginVertical: 6 }}>Life area</Muted>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        <Chip label="None" selected={!d.suggested_life_area_id} onPress={() => set({ suggested_life_area_id: null })} />
        {areas.map((a) => <Chip key={a.id} label={a.name} selected={d.suggested_life_area_id === a.id} onPress={() => set({ suggested_life_area_id: a.id })} />)}
      </View>

      {d.kind === 'accomplishment' && (
        <>
          <Muted style={{ fontFamily: fonts.medium, color: colors.text, marginVertical: 6 }}>When?</Muted>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            <Chip label="Today" selected={!d.occurred_at} onPress={() => set({ occurred_at: null })} />
            <Chip label="Yesterday" selected={!!d.occurred_at && d.occurred_at.slice(0, 10) === toISODate(yesterday)} onPress={() => set({ occurred_at: new Date(yesterday.setHours(12, 0, 0, 0)).toISOString() })} />
          </View>
          <Field label="Or a date (YYYY-MM-DD)" value={d.occurred_at?.slice(0, 10) ?? ''} onChangeText={(v) => set({ occurred_at: /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00`).toISOString() : d.occurred_at })} placeholder={toISODate(new Date())} />
        </>
      )}

      {(d.kind === 'goal' || d.kind === 'action') && (
        <>
          {d.kind === 'action' && <Field label="Minutes (optional)" keyboardType="number-pad" value={d.estimated_minutes ? String(d.estimated_minutes) : ''} onChangeText={(v) => set({ estimated_minutes: v ? Math.min(600, Math.max(1, parseInt(v, 10) || 1)) : null })} />}
          <Field label="Date (optional, YYYY-MM-DD)" value={d.deadline ?? ''} onChangeText={(v) => set({ deadline: v.trim() || null })} placeholder="No deadline" />
          {d.deadline && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              <Chip label="Target date" selected={d.deadline_type !== 'hard'} onPress={() => set({ deadline_type: 'target' })} />
              <Chip label="Hard deadline" selected={d.deadline_type === 'hard'} onPress={() => set({ deadline_type: 'hard' })} />
            </View>
          )}
        </>
      )}

      {d.kind === 'goal' && (
        <>
          <Field label="Why does this matter to you? (optional)" value={d.meaning} onChangeText={(meaning) => set({ meaning })} placeholder="e.g. It will remove a lingering obligation." multiline />
          <Muted style={{ fontFamily: fonts.medium, color: colors.text, marginBottom: 6 }}>First steps</Muted>
          {d.next_actions.map((n, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Field value={n.title} onChangeText={(title) => set({ next_actions: d.next_actions.map((x, j) => (j === i ? { ...x, title } : x)) })} />
              </View>
              <Pressable onPress={() => set({ next_actions: d.next_actions.filter((_, j) => j !== i) })} accessibilityLabel="Remove step" hitSlop={8} style={{ marginBottom: 12 }}>
                <Icon name="x" color={colors.textMuted} />
              </Pressable>
            </View>
          ))}
          {d.next_actions.length < 5 && <Button variant="ghost" icon="plus" title="Add a step" onPress={() => set({ next_actions: [...d.next_actions, { title: '', estimated_minutes: null }] })} />}
        </>
      )}

      <Button title="Done" onPress={() => onSave(d)} disabled={!d.title.trim()} style={{ marginTop: 8 }} />
      <Button title="Remove this item" variant="ghost" onPress={() => onRemove(d)} />
    </Sheet>
  );
}
