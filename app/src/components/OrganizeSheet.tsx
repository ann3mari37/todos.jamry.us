import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { friendlyAiError } from '../lib/api';
import { useStore, type OrganizePlan } from '../lib/store';
import { colors, fonts, radius } from '../theme';
import { Banner, Body, Button, Icon, Muted, Sheet } from './ui';

/**
 * Review sheet for "Organize with AI": proposes new projects, moves loose tasks into projects,
 * and files everything into life areas. Nothing changes until the user applies; applying can be undone.
 */
export function OrganizeSheet({ visible, onClose, scope = 'loose', onApplied }: {
  visible: boolean; onClose: () => void; scope?: 'loose' | 'all'; onApplied?: (summary: string, runId: string) => void;
}) {
  const store = useStore();
  const [plan, setPlan] = useState<OrganizePlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setPlan(null); setError(null); setOff(new Set());
    store.organizePreview(scope)
      .then((p) => {
        setPlan(p);
        // Low-confidence guesses start unchecked; the user opts in.
        setOff(new Set(p.assignments.filter((a) => a.confidence < 0.6).map((a) => a.id)));
      })
      .catch((e) => setError(friendlyAiError(e).replace('Organized without AI — please check the items.', 'Try again in a moment.')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, scope]);

  const areaName = (id: string | null) => store.lifeAreas.find((a) => a.id === id);
  const goalTitle = (id: string | null) => store.goals.find((g) => g.id === id)?.title;
  const toggle = (id: string) => setOff((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const chosen = plan?.assignments.filter((a) => !off.has(a.id)) ?? [];
  const refsInUse = new Set(chosen.map((a) => a.goal_ref).filter(Boolean));
  const projects = plan?.new_projects.filter((p) => refsInUse.has(p.ref) && !off.has(`project:${p.ref}`)) ?? [];

  const apply = async () => {
    if (!plan) return;
    setApplying(true);
    try {
      const keep = new Set(projects.map((p) => p.ref));
      const run = await store.organizeApply({
        new_projects: projects.map(({ ref, title, life_area_id }) => ({ ref, title, life_area_id })),
        assignments: chosen.map(({ kind, id, goal_id, goal_ref, life_area_id }) => ({ kind, id, goal_id, goal_ref: goal_ref && keep.has(goal_ref) ? goal_ref : null, life_area_id })),
      });
      const n = run.changes.length;
      onApplied?.(`Organized ${n} item${n === 1 ? '' : 's'}${projects.length ? ` and created ${projects.length} project${projects.length === 1 ? '' : 's'}` : ''}.`, run.id);
      onClose();
    } catch (e) {
      setError(friendlyAiError(e));
    } finally {
      setApplying(false);
    }
  };

  const grouped = plan
    ? {
        newProjects: plan.new_projects.map((p) => ({ p, items: plan.assignments.filter((a) => a.goal_ref === p.ref) })),
        intoExisting: plan.assignments.filter((a) => !a.goal_ref && a.goal_id),
        areasOnly: plan.assignments.filter((a) => !a.goal_ref && !a.goal_id && a.life_area_id),
      }
    : null;

  return (
    <Sheet visible={visible} onClose={onClose} title="Organize with AI">
      {!plan && !error && (
        <View style={{ alignItems: 'center', paddingVertical: 28, gap: 12 }} accessibilityLiveRegion="polite">
          <ActivityIndicator color={colors.pink} />
          <Text style={{ fontFamily: fonts.medium, color: colors.pinkDeep }}>AI is sorting your tasks into projects and life areas…</Text>
        </View>
      )}
      {error && <Banner tone="soft" text={error} />}

      {grouped && plan && plan.assignments.length === 0 && (
        <View style={{ alignItems: 'center', paddingVertical: 20 }}>
          <Icon name="check-circle" size={28} color={colors.teal} />
          <Body style={{ fontFamily: fonts.medium, marginTop: 8 }}>Everything is already in its place.</Body>
        </View>
      )}

      {grouped && plan && plan.assignments.length > 0 && (
        <>
          <Muted style={{ marginBottom: 6 }}>Review the suggestions. Uncheck anything that doesn't fit — nothing changes until you apply, and you can undo.</Muted>

          {grouped.newProjects.map(({ p, items }) => (
            <View key={p.ref} style={{ backgroundColor: colors.pinkWash, borderRadius: radius.md, padding: 12, marginTop: 10 }}>
              <CheckRow
                checked={!off.has(`project:${p.ref}`)}
                onPress={() => toggle(`project:${p.ref}`)}
                icon="folder-plus"
                title={`New project: ${p.title}`}
                meta={[areaName(p.life_area_id)?.name, p.reason].filter(Boolean).join(' · ')}
                strong
              />
              {items.map((a) => (
                <View key={a.id} style={{ paddingLeft: 30 }}>
                  <CheckRow checked={!off.has(a.id) && !off.has(`project:${p.ref}`)} onPress={() => toggle(a.id)} title={a.title} meta={a.reason} />
                </View>
              ))}
            </View>
          ))}

          {grouped.intoExisting.length > 0 && <Section label="Move into existing projects" />}
          {grouped.intoExisting.map((a) => (
            <CheckRow key={a.id} checked={!off.has(a.id)} onPress={() => toggle(a.id)} icon="corner-down-right" title={a.title} meta={`→ ${goalTitle(a.goal_id) ?? 'project'}${a.reason ? ` · ${a.reason}` : ''}`} />
          ))}

          {grouped.areasOnly.length > 0 && <Section label="File into life areas" />}
          {grouped.areasOnly.map((a) => {
            const area = areaName(a.life_area_id);
            return (
              <CheckRow key={a.id} checked={!off.has(a.id)} onPress={() => toggle(a.id)} dot={area?.color} title={a.title}
                meta={`${a.kind === 'goal' ? 'Project' : 'Task'} → ${area?.name ?? 'area'}${a.reason ? ` · ${a.reason}` : ''}`} />
            );
          })}

          <Button title={`Apply ${chosen.length} change${chosen.length === 1 ? '' : 's'}`} icon="check" onPress={apply} loading={applying} disabled={!chosen.length} style={{ marginTop: 16 }} />
        </>
      )}
      <Button title={plan?.assignments.length ? 'Not now' : 'Close'} variant="ghost" onPress={onClose} />
    </Sheet>
  );
}

function Section({ label }: { label: string }) {
  return <Text style={{ fontFamily: fonts.semibold, fontSize: 13, color: colors.textMuted, marginTop: 16, marginBottom: 2, textTransform: 'uppercase', letterSpacing: 0.6 }}>{label}</Text>;
}

function CheckRow({ checked, onPress, title, meta, icon, dot, strong }: {
  checked: boolean; onPress: () => void; title: string; meta?: string; icon?: React.ComponentProps<typeof Icon>['name']; dot?: string; strong?: boolean;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked }} accessibilityLabel={title}
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, minHeight: 44 }, pressed && { opacity: 0.7 }]}>
      <View style={{ width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: checked ? colors.pink : colors.textFaint, backgroundColor: checked ? colors.pink : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
        {checked && <Icon name="check" size={13} color={colors.white} />}
      </View>
      {icon && <Icon name={icon} size={16} color={colors.textMuted} />}
      {dot && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: dot }} />}
      <View style={{ flex: 1 }}>
        <Body style={{ fontFamily: strong ? fonts.semibold : fonts.medium, fontSize: 15, opacity: checked ? 1 : 0.55 }}>{title}</Body>
        {meta ? <Muted numberOfLines={2} style={{ fontSize: 12 }}>{meta}</Muted> : null}
      </View>
    </Pressable>
  );
}
