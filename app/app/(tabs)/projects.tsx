import { router } from 'expo-router';
import React, { useState } from 'react';
import { OrganizeSheet } from '../../src/components/OrganizeSheet';
import { Text, View } from 'react-native';
import { Card, Body, H1, Icon, IconButton, Muted, ProgressBar, Screen, Segmented } from '../../src/components/ui';
import { goalIcon } from '../../src/lib/icons';
import { shortDate } from '../../src/core/dates';
import { goalProgress } from '../../src/core/recommend';
import type { Goal } from '../../src/core/types';
import { useStore } from '../../src/lib/store';
import { colors, fonts } from '../../src/theme';

const STATUS_LABEL: Partial<Record<Goal['status'], string>> = { waiting: 'Waiting', blocked: 'Blocked', paused: 'Paused' };


export default function Projects() {
  const store = useStore();
  const [tab, setTab] = useState<'active' | 'completed' | 'archived'>('active');
  const [organizing, setOrganizing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const list = store.goals.filter((g) =>
    tab === 'active' ? ['active', 'waiting', 'blocked', 'paused'].includes(g.status) : g.status === tab,
  );

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, marginBottom: 14 }}>
        <H1 style={{ flex: 1 }}>Projects</H1>
        {store.profile?.ai_enabled !== false && <IconButton name="star" label="Organize with AI" color={colors.pink} onPress={() => setOrganizing(true)} />}
        <IconButton name="plus" label="New project" onPress={() => router.push({ pathname: '/capture', params: { mode: 'goal' } })} />
      </View>
      <Segmented value={tab} onChange={setTab} options={[{ value: 'active', label: 'Active' }, { value: 'completed', label: 'Completed' }, { value: 'archived', label: 'Archived' }]} style={{ marginBottom: 14 }} />
      {list.map((g) => {
        const { done, total } = goalProgress(g.id, store.actions);
        const area = store.lifeAreas.find((a) => a.id === g.life_area_id);
        return (
          <Card key={g.id} onPress={() => router.push({ pathname: '/project/[id]', params: { id: g.id } })} accessibilityLabel={`${g.title}, ${done} of ${total} steps`}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <Icon name={goalIcon(g, area?.icon)} size={22} color={colors.text} />
              <View style={{ flex: 1 }}>
                <Body style={{ fontFamily: fonts.medium }}>{g.title}</Body>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 }}>
                  <ProgressBar done={done} total={total} />
                  {g.deadline && g.status === 'active' && (
                    <Text style={{ fontFamily: fonts.medium, fontSize: 12, color: g.deadline_type === 'hard' ? colors.pinkDeep : colors.textMuted }}>
                      {g.deadline_type === 'hard' ? 'Due' : 'Target'} {shortDate(g.deadline)}
                    </Text>
                  )}
                  {STATUS_LABEL[g.status] && <Muted>{STATUS_LABEL[g.status]}</Muted>}
                  <Muted>{done} / {total}</Muted>
                </View>
              </View>
              <Icon name="chevron-right" size={18} color={colors.textFaint} />
            </View>
          </Card>
        );
      })}
      {tab === 'active' && (() => {
        const loose = store.actions.filter((a) => !a.goal_id && !a.life_area_id && ['ready', 'in_progress', 'waiting', 'blocked'].includes(a.status));
        return loose.length > 0 ? (
          <Card onPress={() => setOrganizing(true)} style={{ backgroundColor: colors.pinkWash, borderColor: colors.pinkSoft }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <Icon name="inbox" size={22} color={colors.pinkDeep} />
              <View style={{ flex: 1 }}>
                <Body style={{ fontFamily: fonts.medium }}>{loose.length} unsorted task{loose.length === 1 ? '' : 's'}</Body>
                <Muted>Let AI group them into projects and life areas</Muted>
              </View>
              <Icon name="chevron-right" size={18} color={colors.textFaint} />
            </View>
          </Card>
        ) : null;
      })()}
      {note && <Muted style={{ textAlign: 'center', color: colors.teal, marginBottom: 8 }}>{note}</Muted>}
      <OrganizeSheet visible={organizing} onClose={() => setOrganizing(false)} onApplied={(t) => setNote(t)} />
      {list.length === 0 && (
        <Card style={{ alignItems: 'center', paddingVertical: 24 }}>
          <Muted style={{ textAlign: 'center' }}>
            {tab === 'active' ? 'No active projects. Tap + to describe something you want to achieve.' : tab === 'completed' ? 'Completed projects will gather here.' : 'Nothing archived.'}
          </Muted>
        </Card>
      )}
    </Screen>
  );
}
