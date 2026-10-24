import { router } from 'expo-router';
import React, { useState } from 'react';
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
  const list = store.goals.filter((g) =>
    tab === 'active' ? ['active', 'waiting', 'blocked', 'paused'].includes(g.status) : g.status === tab,
  );

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, marginBottom: 14 }}>
        <H1>Projects</H1>
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
