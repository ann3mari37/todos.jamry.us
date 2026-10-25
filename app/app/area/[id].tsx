import { router, useLocalSearchParams } from 'expo-router';
import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import { TaskList, useOpenTasks } from '../../src/components/TaskList';
import { Body, Card, H1, Icon, IconButton, IconCircle, Muted, ProgressBar, Screen } from '../../src/components/ui';
import { startOfWeek } from '../../src/core/dates';
import { goalProgress } from '../../src/core/recommend';
import { goalIcon } from '../../src/lib/icons';
import { useStore } from '../../src/lib/store';
import { colors, fonts } from '../../src/theme';

/** One life area: its projects, its open tasks (own or via a project), and what got done there this week. */
export default function Area() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const store = useStore();
  const area = store.lifeAreas.find((a) => a.id === id);
  const projects = useMemo(() => store.goals.filter((g) => g.life_area_id === id && ['active', 'waiting', 'blocked', 'paused'].includes(g.status)), [store.goals, id]);
  const projectIds = new Set(projects.map((g) => g.id));
  const tasks = useOpenTasks((a) => a.life_area_id === id || (!!a.goal_id && projectIds.has(a.goal_id)));
  const looseTasks = tasks.filter((a) => !a.goal_id);
  const ws = startOfWeek().getTime();
  const doneThisWeek = store.accomplishments.filter((a) => (a.life_area_id === id || (!!a.goal_id && projectIds.has(a.goal_id))) && new Date(a.occurred_at).getTime() >= ws);

  if (!area) {
    return (
      <Screen>
        <IconButton name="chevron-left" label="Back" onPress={() => router.back()} />
        <Muted>{store.loading ? 'Loading…' : 'This life area could not be found.'}</Muted>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
        <IconButton name="chevron-left" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.navigate('/life-areas'))} />
        <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: area.color, marginRight: 10 }} />
        <H1 style={{ flex: 1 }}>{area.name}</H1>
        <IconButton name="edit-2" label={`Edit ${area.name}`} size={19} onPress={() => router.push({ pathname: '/life-areas', params: { edit: area.id } })} />
      </View>
      <Muted style={{ marginBottom: 14 }}>
        {projects.length} project{projects.length === 1 ? '' : 's'} · {tasks.length} open task{tasks.length === 1 ? '' : 's'} · {doneThisWeek.length} done this week
      </Muted>

      {projects.map((g) => {
        const { done, total } = goalProgress(g.id, store.actions);
        return (
          <Card key={g.id} onPress={() => router.push({ pathname: '/project/[id]', params: { id: g.id } })} accessibilityLabel={`${g.title}, ${done} of ${total} steps`}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <Icon name={goalIcon(g, area.icon)} size={22} color={colors.text} />
              <View style={{ flex: 1 }}>
                <Body style={{ fontFamily: fonts.medium }}>{g.title}</Body>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 }}>
                  <ProgressBar done={done} total={total} color={area.color} />
                  <Muted>{done} / {total}</Muted>
                </View>
              </View>
              <Icon name="chevron-right" size={18} color={colors.textFaint} />
            </View>
          </Card>
        );
      })}

      <Card>
        <Body style={{ fontFamily: fonts.medium, marginBottom: 4 }}>{projects.length ? 'Tasks on their own' : 'Tasks'}</Body>
        <TaskList tasks={projects.length ? looseTasks : tasks} limit={10} emptyText={projects.length ? 'Every task here is part of a project.' : 'Nothing open in this area.'} />
      </Card>

      {doneThisWeek.length > 0 && (
        <>
          <Text style={{ fontFamily: fonts.semibold, fontSize: 14, color: colors.text, marginTop: 8, marginBottom: 8 }}>Done this week</Text>
          {doneThisWeek.slice(0, 8).map((a) => (
            <View key={a.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 }}>
              <IconCircle name="check" color={colors.white} soft={area.color} size={24} />
              <Body style={{ flex: 1 }} numberOfLines={1}>{a.title}</Body>
            </View>
          ))}
        </>
      )}

      <Muted style={{ marginTop: 14, fontSize: 12 }}>
        {(area.keywords?.length ?? 0) > 0
          ? `New tasks mentioning ${area.keywords!.map((k) => `“${k}”`).join(', ')} are filed here automatically.`
          : 'Tip: tap the pencil to add keywords. New tasks that mention them are filed here automatically.'}
      </Muted>
    </Screen>
  );
}
