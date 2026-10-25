import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, Platform, Pressable, View } from 'react-native';
import { OrganizeSheet } from '../src/components/OrganizeSheet';
import { Banner, Button, Card, Divider, Field, H1, IconButton, Muted, Row, Screen, Sheet } from '../src/components/ui';
import type { LifeArea } from '../src/core/types';
import { useStore } from '../src/lib/store';
import { AREA_COLORS, colors } from '../src/theme';

export default function LifeAreas() {
  const store = useStore();
  const params = useLocalSearchParams<{ edit?: string }>();
  const [edit, setEdit] = useState<(Partial<LifeArea> & { kw?: string }) | null>(null);
  const startEdit = (a: Partial<LifeArea>) => setEdit({ ...a, kw: (a.keywords ?? []).join(', ') });
  // Opened from an area screen's pencil: go straight to that area's settings.
  useEffect(() => {
    const a = params.edit ? store.lifeAreas.find((x) => x.id === params.edit) : null;
    if (a) startEdit(a);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.edit, store.lifeAreas.length]);
  const [organizing, setOrganizing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const OPEN = ['ready', 'in_progress', 'waiting', 'blocked'];
  const counts = (id: string) => {
    const projects = store.goals.filter((g) => g.life_area_id === id && g.status === 'active').length;
    const tasks = store.actions.filter((a) => OPEN.includes(a.status) && (a.life_area_id ?? store.goals.find((g) => g.id === a.goal_id)?.life_area_id) === id).length;
    return `${projects} project${projects === 1 ? '' : 's'} · ${tasks} open task${tasks === 1 ? '' : 's'}`;
  };
  const unfiled = store.actions.filter((a) => OPEN.includes(a.status) && !a.goal_id && !a.life_area_id).length + store.goals.filter((g) => g.status === 'active' && !g.life_area_id).length;
  const active = store.lifeAreas.filter((a) => !a.archived_at);
  const archived = store.lifeAreas.filter((a) => a.archived_at);

  const confirmDelete = (a: Partial<LifeArea>) => {
    const go = async () => { await store.deleteLifeArea(a.id!); setEdit(null); };
    const msg = 'Projects and history stay — they just lose this label.';
    if (Platform.OS === 'web') { if (window.confirm(`Delete ${a.name}? ${msg}`)) go(); }
    else Alert.alert(`Delete ${a.name}?`, msg, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: go }]);
  };

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
        <IconButton name="chevron-left" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.navigate('/more'))} />
        <H1 style={{ flex: 1 }}>Life Areas</H1>
        <IconButton name="star" label="Organize" color={colors.pink} onPress={() => setOrganizing(true)} />
        <IconButton name="plus" label="Add life area" onPress={() => startEdit({ name: '', color: AREA_COLORS[active.length % AREA_COLORS.length], icon: 'circle' })} />
      </View>
      <Muted style={{ marginBottom: 12 }}>Ways to group your life — never quotas.</Muted>
      {note && <Banner text={note} />}
      {unfiled > 0 && (
        <Button variant="soft" icon="star" title={`File ${unfiled} unsorted item${unfiled === 1 ? '' : 's'}`} onPress={() => setOrganizing(true)} style={{ marginBottom: 12, minHeight: 46 }} />
      )}
      <OrganizeSheet visible={organizing} onClose={() => setOrganizing(false)} onApplied={(t) => setNote(t)} />
      <Card style={{ paddingVertical: 4 }}>
        {active.map((a, i) => (
          <View key={a.id}>
            {i > 0 && <Divider />}
            <Row title={a.name} subtitle={counts(a.id)} leading={<View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: `${a.color}33`, alignItems: 'center', justifyContent: 'center' }}><View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: a.color }} /></View>} onPress={() => router.push({ pathname: '/area/[id]', params: { id: a.id } })} />
          </View>
        ))}
      </Card>
      {archived.length > 0 && (
        <>
          <Muted style={{ marginTop: 12, marginBottom: 6 }}>Archived</Muted>
          <Card style={{ paddingVertical: 4 }}>
            {archived.map((a) => <Row key={a.id} title={a.name} onPress={() => startEdit(a)} />)}
          </Card>
        </>
      )}

      <Sheet visible={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit life area' : 'New life area'}>
        {edit && (
          <>
            <Field label="Name" value={edit.name} onChangeText={(name) => setEdit({ ...edit, name })} autoFocus />
            <Muted style={{ marginBottom: 8 }}>Color</Muted>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
              {AREA_COLORS.map((c) => (
                <Pressable key={c} onPress={() => setEdit({ ...edit, color: c })} accessibilityRole="radio" accessibilityState={{ selected: edit.color === c }} accessibilityLabel={`Color ${c}`}
                  style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c, borderWidth: 3, borderColor: edit.color === c ? colors.text : 'transparent' }} />
              ))}
            </View>
            <Field
              label="Keywords (optional)"
              value={edit.kw ?? ''}
              onChangeText={(kw) => setEdit({ ...edit, kw })}
              placeholder="e.g. crm, client, Malinda"
              autoCapitalize="none"
            />
            <Muted style={{ marginTop: -6, marginBottom: 14 }}>New tasks that mention any of these words are filed in this area automatically. Separate words with commas.</Muted>
            <Button title="Save" disabled={!edit.name?.trim()} onPress={async () => {
              const { kw, ...rest } = edit;
              const keywords = [...new Set((kw ?? '').split(',').map((w) => w.trim()).filter(Boolean))].slice(0, 30);
              await store.upsertLifeArea({ ...rest, name: edit.name!.trim(), keywords } as LifeArea);
              setEdit(null);
            }} />
            {edit.id && (
              <>
                <Button variant="ghost" title={edit.archived_at ? 'Restore' : 'Archive'} onPress={async () => { await store.upsertLifeArea({ id: edit.id, name: edit.name!, archived_at: edit.archived_at ? null : new Date().toISOString() }); setEdit(null); }} />
                <Button variant="ghost" title="Delete" onPress={() => confirmDelete(edit)} />
              </>
            )}
          </>
        )}
      </Sheet>
    </Screen>
  );
}
