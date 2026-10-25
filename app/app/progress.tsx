import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { Banner, Body, Button, Card, H1, H2, Icon, IconButton, Muted, ProgressBar, Row, Screen, Segmented } from '../../src/components/ui';
import { shortDate, startOfWeek, toISODate } from '../../src/core/dates';
import { api, friendlyAiError } from '../../src/lib/api';
import { useStore } from '../../src/lib/store';
import { colors, fonts, radius } from '../../src/theme';

const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const DAY = 86_400_000;

export default function Progress() {
  const store = useStore();
  const [offset, setOffset] = useState(0);
  const [tab, setTab] = useState<'activity' | 'meaningful'>('activity');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const ws = useMemo(() => { const d = startOfWeek(); d.setDate(d.getDate() - offset * 7); return d; }, [offset]);
  const we = ws.getTime() + 7 * DAY;
  const weekAcc = store.accomplishments.filter((a) => { const t = new Date(a.occurred_at).getTime(); return t >= ws.getTime() && t < we; });
  const shown = tab === 'activity' ? weekAcc : weekAcc.filter((a) => a.meaningful);
  const goalsAdvanced = new Set(weekAcc.filter((a) => a.meaningful && a.goal_id).map((a) => a.goal_id));
  const perDay = DAYS.map((_, i) => shown.filter((a) => { const t = new Date(a.occurred_at).getTime(); return t >= ws.getTime() + i * DAY && t < ws.getTime() + (i + 1) * DAY; }).length);
  const max = Math.max(1, ...perDay);
  const completedProjects = store.goals.filter((g) => g.status === 'completed').sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? '')).slice(0, 5);
  const milestones = store.events.filter((e) => e.type === 'goal_completed').slice(0, 5);
  const reflection = store.reflections.find((r) => r.week_start === toISODate(ws));

  const reflect = async () => {
    setBusy(true); setMsg(null);
    try { await api('/api/ai/weekly-summary', { week_start: toISODate(ws) }); await store.refresh(); }
    catch (e) { setMsg(friendlyAiError(e).replace(/Organized without AI.*$/, '')); }
    finally { setBusy(false); }
  };

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
        <H1 style={{ flex: 1 }}>{offset === 0 ? 'This Week' : offset === 1 ? 'Last Week' : `Week of ${shortDate(toISODate(ws))}`}</H1>
        <IconButton name="chevron-left" label="Previous week" onPress={() => setOffset(offset + 1)} />
        <IconButton name="chevron-right" label="Next week" onPress={() => setOffset(Math.max(0, offset - 1))} color={offset === 0 ? colors.textFaint : colors.text} />
      </View>
      <Segmented value={tab} onChange={setTab} options={[{ value: 'activity', label: 'Activity' }, { value: 'meaningful', label: 'Meaningful Progress' }]} style={{ marginVertical: 12 }} />

      <Card>
        <View style={{ flexDirection: 'row' }}>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={{ fontFamily: fonts.serif, fontSize: 34, color: colors.text }}>{shown.length}</Text>
            <Muted>{tab === 'activity' ? 'accomplishments' : 'meaningful steps'}</Muted>
          </View>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={{ fontFamily: fonts.serif, fontSize: 34, color: colors.text }}>{goalsAdvanced.size}</Text>
            <Muted>goals advanced</Muted>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 90, marginTop: 18 }} accessible accessibilityLabel={`Per day: ${perDay.join(', ')}`}>
          {perDay.map((v, i) => (
            <View key={i} style={{ alignItems: 'center', flex: 1 }}>
              <View style={{ width: 22, height: Math.max(6, (v / max) * 70), borderTopLeftRadius: 6, borderTopRightRadius: 6, backgroundColor: v === max && v > 0 ? colors.pink : colors.pinkSoft }} />
              <Muted style={{ marginTop: 4, fontSize: 11 }}>{DAYS[i]}</Muted>
            </View>
          ))}
        </View>
        {tab === 'activity' && weekAcc.length > 0 && (
          <Muted style={{ marginTop: 10, textAlign: 'center' }}>
            {weekAcc.filter((a) => !a.planned).length} of these weren't planned — they count too.
          </Muted>
        )}
      </Card>

      <H2 style={{ fontSize: 18, marginTop: 10, marginBottom: 8 }}>Life Area Progress</H2>
      <Card>
        {store.lifeAreas.filter((a) => !a.archived_at).map((area) => {
          const acts = store.actions.filter((a) => (a.life_area_id ?? store.goals.find((g) => g.id === a.goal_id)?.life_area_id) === area.id && a.status !== 'dismissed' && a.status !== 'suggested');
          const done = acts.filter((a) => a.status === 'completed').length;
          return (
            <View key={area.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 }}>
              <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: area.color }} />
              <Body style={{ width: 120 }} numberOfLines={1}>{area.name}</Body>
              <ProgressBar done={done} total={acts.length} color={area.color} />
              <Muted style={{ width: 40, textAlign: 'right' }}>{done} / {acts.length}</Muted>
            </View>
          );
        })}
      </Card>

      <H2 style={{ fontSize: 18, marginTop: 10, marginBottom: 8 }}>Weekly reflection</H2>
      <Card style={{ backgroundColor: colors.cardSoft }}>
        {reflection?.summary ? <Body>{reflection.summary}</Body> : (
          <Muted>An optional, AI-written look back at this week, based only on what you recorded.</Muted>
        )}
        {msg && <Banner tone="soft" text={msg} />}
        {store.profile?.ai_enabled !== false && (
          <Button title={reflection?.summary ? 'Refresh reflection' : 'Reflect on this week'} icon="star" variant="soft" loading={busy} onPress={reflect} style={{ marginTop: 12, minHeight: 44 }} />
        )}
      </Card>

      {(completedProjects.length > 0 || milestones.length > 0) && <H2 style={{ fontSize: 18, marginTop: 10, marginBottom: 8 }}>Completed projects</H2>}
      {completedProjects.map((g) => (
        <Card key={g.id} onPress={() => router.push({ pathname: '/project/[id]', params: { id: g.id } })} style={{ paddingVertical: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Icon name="award" color={colors.amber} />
            <Body style={{ flex: 1 }}>{g.title}</Body>
            {g.completed_at && <Muted>{shortDate(g.completed_at.slice(0, 10))}</Muted>}
          </View>
        </Card>
      ))}

      <Card style={{ marginTop: 10, paddingVertical: 4 }}>
        <Row icon="clock" title="Full history" subtitle="Search everything you've done" onPress={() => router.push('/history')} />
      </Card>
      <View style={{ height: 8, borderRadius: radius.sm }} />
    </Screen>
  );
}
