import React from 'react';
import { View } from 'react-native';
import type { Assignment } from '../core/team';
import { useStore } from '../lib/store';
import { isAviation } from '../theme';
import { Chip, Muted } from './ui';

/** Teams are a dashboard feature; todos.jamry.us stays personal (team projects still show there if you're on one). */
export const TEAMS_UI = !isAviation;

/** The link someone opens to join (on whichever site made it). */
export function inviteLink(code: string) {
  const site = typeof window !== 'undefined' && window.location?.origin?.startsWith('http') ? window.location.origin : 'https://dashboard.malindaperryconsulting.com';
  return `${site}/join?code=${code}`;
}

/** Pick who does a step: a teammate, a role (anyone who holds it), or nobody yet. */
export function AssignChips({ teamId, value, onChange }: { teamId: string; value: Assignment; onChange: (v: Assignment) => void }) {
  const store = useStore();
  const members = store.teamMembers.filter((m) => m.team_id === teamId);
  const roles = store.teamRoles.filter((r) => r.team_id === teamId);
  return (
    <View>
      <Muted style={{ marginBottom: 6 }}>A person</Muted>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {members.map((m) => (
          <Chip key={m.user_id} label={m.user_id === store.me ? `${m.display_name} (you)` : m.display_name} selected={value.assignee_id === m.user_id}
            onPress={() => onChange({ assignee_id: m.user_id, assigned_role_id: null })} />
        ))}
      </View>
      {roles.length > 0 && (
        <>
          <Muted style={{ marginTop: 8, marginBottom: 6 }}>Or a role: whoever holds it can take it</Muted>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {roles.map((r) => (
              <Chip key={r.id} label={r.name} selected={!value.assignee_id && value.assigned_role_id === r.id}
                onPress={() => onChange({ assignee_id: null, assigned_role_id: r.id })} />
            ))}
          </View>
        </>
      )}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 }}>
        <Chip label="Nobody yet" selected={!value.assignee_id && !value.assigned_role_id} onPress={() => onChange({ assignee_id: null, assigned_role_id: null })} />
      </View>
    </View>
  );
}
