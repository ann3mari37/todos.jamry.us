import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import type { Action } from '../core/types';
import { useStore } from '../lib/store';
import { colors, fonts } from '../theme';
import { Body, Icon, Muted, Sheet, SheetOption } from './ui';

const OPEN: Action['status'][] = ['ready', 'in_progress', 'waiting', 'blocked'];

/** Open tasks, optionally filtered. Every task the user has is reachable from here. */
export function useOpenTasks(filter?: (a: Action) => boolean) {
  const store = useStore();
  return store.actions
    .filter((a) => OPEN.includes(a.status) && (!filter || filter(a)))
    .sort((x, y) => (x.goal_id ? 1 : 0) - (y.goal_id ? 1 : 0) || x.created_at.localeCompare(y.created_at));
}

/** A checklist of tasks: tap the circle to finish, tap the row for options. */
export function TaskList({ tasks, limit, emptyText }: { tasks: Action[]; limit?: number; emptyText?: string }) {
  const store = useStore();
  const [open, setOpen] = useState<Action | null>(null);
  const [all, setAll] = useState(false);
  const shown = limit && !all ? tasks.slice(0, limit) : tasks;

  const complete = async (a: Action) => {
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setOpen(null);
    await store.completeAction(a.id);
    router.push({ pathname: '/celebrate', params: { action: a.id } });
  };

  if (!tasks.length) return emptyText ? <Muted style={{ marginVertical: 6 }}>{emptyText}</Muted> : null;

  return (
    <View>
      {shown.map((a) => {
        const goal = a.goal_id ? store.goals.find((g) => g.id === a.goal_id) : null;
        const area = store.lifeAreas.find((x) => x.id === (a.life_area_id ?? goal?.life_area_id));
        const meta = [goal?.title, !goal && area?.name, a.estimated_minutes ? `${a.estimated_minutes} min` : null, a.status === 'waiting' ? 'Waiting' : a.status === 'blocked' ? 'Blocked' : null]
          .filter(Boolean).join(' · ');
        return (
          <View key={a.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, minHeight: 48 }}>
            <Pressable onPress={() => complete(a)} accessibilityRole="checkbox" accessibilityState={{ checked: false }} accessibilityLabel={`Complete ${a.title}`} hitSlop={8}
              style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: colors.textFaint, alignItems: 'center', justifyContent: 'center' }} />
            <Pressable style={{ flex: 1 }} onPress={() => setOpen(a)} accessibilityRole="button" accessibilityLabel={`Options for ${a.title}`}>
              <Body>{a.title}</Body>
              {meta ? <Muted numberOfLines={1}>{meta}</Muted> : null}
            </Pressable>
            {area && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: area.color }} />}
          </View>
        );
      })}
      {limit && tasks.length > limit && (
        <Pressable onPress={() => setAll(!all)} accessibilityRole="button" style={{ paddingVertical: 10, minHeight: 44 }}>
          <Muted style={{ color: colors.pinkDeep, fontFamily: fonts.medium }}>{all ? 'Show fewer' : `Show all ${tasks.length} tasks`}</Muted>
        </Pressable>
      )}

      <Sheet visible={!!open} onClose={() => setOpen(null)} title={open?.title}>
        {open && <SheetOption icon="check-circle" label="Mark done" onPress={() => complete(open)} />}
        {open?.goal_id && <SheetOption icon="folder" label="Open project" onPress={() => { const id = open.goal_id!; setOpen(null); router.push({ pathname: '/project/[id]', params: { id } }); }} />}
        {open && open.status !== 'waiting' && <SheetOption icon="clock" label="I'm waiting on something" onPress={() => { store.updateAction(open.id, { status: 'waiting' }); setOpen(null); }} />}
        {open && open.status === 'waiting' && <SheetOption icon="play" label="Ready again" onPress={() => { store.updateAction(open.id, { status: 'ready' }); setOpen(null); }} />}
        {open && <SheetOption icon="x-circle" label="Remove from my list" destructive onPress={() => { store.updateAction(open.id, { status: 'dismissed' }); setOpen(null); }} />}
      </Sheet>
    </View>
  );
}

