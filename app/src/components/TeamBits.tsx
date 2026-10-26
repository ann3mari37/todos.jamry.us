import { router } from 'expo-router';
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { teamUpdates, type Assignment } from '../core/team';
import { useStore } from '../lib/store';
import { colors, fonts, isAviation, radius, shadow } from '../theme';
import { Body, Chip, Icon, Muted, type IconName } from './ui';

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

/**
 * Today's "Team updates": what teammates finished on projects you share, your steps that can start now because of
 * it, and what you're still waiting on. Read-only; hidden when there's nothing to say.
 */
export function TeamUpdatesCard() {
  const store = useStore();
  if (!store.teams.length) return null;
  const u = teamUpdates({
    all: store.allActions, goals: store.goals, dependencies: store.dependencies, me: store.me,
    team: { members: store.teamMembers, roles: store.teamRoles, memberRoles: store.teamMemberRoles },
  });
  const lines: { icon: IconName; text: string; goalId: string | null; tone: string }[] = [
    ...u.unblocked.map((a) => ({ icon: 'play-circle' as const, text: `Your turn: ${a.title}`, goalId: a.goal_id, tone: colors.teal })),
    ...u.finished.slice(0, 4).map((f) => ({ icon: 'check-circle' as const, text: `${f.by} finished “${f.action.title}”${f.goal ? ` · ${f.goal.title}` : ''}`, goalId: f.goal?.id ?? null, tone: colors.text })),
  ];
  const waiting = u.waiting.length;
  if (!lines.length && !waiting) return null;
  return (
    <View style={[{ backgroundColor: colors.card, borderRadius: radius.lg, padding: 16, borderWidth: 1, borderColor: colors.border, marginBottom: 12 }, shadow]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <Icon name="users" size={16} color={colors.pink} />
        <Text style={{ fontFamily: fonts.medium, fontSize: 13, color: colors.pinkDeep }}>Team updates</Text>
      </View>
      {lines.map((l, i) => (
        <Pressable key={i} disabled={!l.goalId} onPress={() => l.goalId && router.push({ pathname: '/project/[id]', params: { id: l.goalId } })}
          accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 }}>
          <Icon name={l.icon} size={16} color={l.tone === colors.teal ? colors.teal : colors.textMuted} />
          <Body style={{ flex: 1, color: l.tone, fontSize: 15 }}>{l.text}</Body>
        </Pressable>
      ))}
      {waiting > 0 && (
        <Muted style={{ marginTop: 4 }}>
          {waiting === 1
            ? `Waiting on ${u.waiting[0].who.replace(' · open', ' (not taken yet)')}: “${u.waiting[0].on.title}”, before you can do “${u.waiting[0].action.title}”.`
            : `${waiting} of your steps are waiting on teammates.`}
        </Muted>
      )}
    </View>
  );
}
