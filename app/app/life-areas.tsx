import { router } from 'expo-router';
import React, { useState } from 'react';
import { Alert, Platform, Pressable, View } from 'react-native';
import { Button, Card, Divider, Field, H1, IconButton, Muted, Row, Screen, Sheet } from '../src/components/ui';
import type { LifeArea } from '../src/core/types';
import { useStore } from '../src/lib/store';
import { AREA_COLORS, colors } from '../src/theme';

export default function LifeAreas() {
  const store = useStore();
  const [edit, setEdit] = useState<Partial<LifeArea> | null>(null);
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
        <IconButton name="plus" label="Add life area" onPress={() => setEdit({ name: '', color: AREA_COLORS[active.length % AREA_COLORS.length], icon: 'circle' })} />
      </View>
      <Muted style={{ marginBottom: 12 }}>Ways to group your life — never quotas.</Muted>
      <Card style={{ paddingVertical: 4 }}>
        {active.map((a, i) => (
          <View key={a.id}>
            {i > 0 && <Divider />}
            <Row title={a.name} leading={<View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: a.color }} />} onPress={() => setEdit(a)} />
          </View>
        ))}
      </Card>
      {archived.length > 0 && (
        <>
          <Muted style={{ marginTop: 12, marginBottom: 6 }}>Archived</Muted>
          <Card style={{ paddingVertical: 4 }}>
            {archived.map((a) => <Row key={a.id} title={a.name} onPress={() => setEdit(a)} />)}
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
            <Button title="Save" disabled={!edit.name?.trim()} onPress={async () => { await store.upsertLifeArea({ ...edit, name: edit.name!.trim() } as LifeArea); setEdit(null); }} />
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
