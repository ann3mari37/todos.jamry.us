import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, Platform, View } from 'react-native';
import { CopyBox } from '../src/components/ConnectChat';
import { inviteLink } from '../src/components/TeamBits';
import { Banner, Body, Button, Card, Chip, Divider, Field, H1, H2, IconButton, Muted, Row, Screen, Sheet, SheetOption } from '../src/components/ui';
import type { TeamInvite, TeamMember, TeamRole } from '../src/core/types';
import { useStore } from '../src/lib/store';
import { fonts } from '../src/theme';

// The team: who's on it, the job roles steps get assigned to, and invite links. Admins manage; everyone can rename
// themselves or leave. Projects join a team from their own page.

function confirm(title: string, message: string, go: () => void) {
  if (Platform.OS === 'web') { if (window.confirm(`${title} ${message}`)) go(); }
  else Alert.alert(title, message, [{ text: 'Cancel', style: 'cancel' }, { text: 'OK', style: 'destructive', onPress: go }]);
}

export default function TeamScreen() {
  const store = useStore();
  const [teamId, setTeamId] = useState<string | null>(null);
  const team = store.teams.find((t) => t.id === teamId) ?? store.teams[0] ?? null;
  const [error, setError] = useState<string | null>(null);
  const [member, setMember] = useState<TeamMember | null>(null);
  const [role, setRole] = useState<Partial<TeamRole> | null>(null);
  const [inviting, setInviting] = useState(false);
  const [renaming, setRenaming] = useState(false);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try { await fn(); } catch (e) { setError((e as Error).message || 'That didn’t work. Try again.'); }
  };

  const back = <IconButton name="chevron-left" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.navigate('/more'))} />;

  if (!team) return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>{back}<H1 style={{ flex: 1 }}>Team</H1></View>
      <CreateTeam onCreate={(name, you) => run(async () => { setTeamId(await store.createTeam(name, you)); })} initialName={store.profile?.display_name ?? ''} />
      {error && <Banner tone="soft" text={error} />}
      <Muted style={{ marginTop: 14 }}>Joining someone else’s team? Open the invite link they sent you.</Muted>
    </Screen>
  );

  const members = store.teamMembers.filter((m) => m.team_id === team.id);
  const roles = store.teamRoles.filter((r) => r.team_id === team.id);
  const invites = store.teamInvites.filter((i) => i.team_id === team.id);
  const admin = members.some((m) => m.user_id === store.me && m.is_admin);
  const rolesOf = (userId: string) => store.teamMemberRoles.filter((x) => x.team_id === team.id && x.user_id === userId).map((x) => x.role_id);
  const roleName = (id: string | null) => roles.find((r) => r.id === id)?.name ?? null;
  const projects = store.goals.filter((g) => g.team_id === team.id && ['active', 'waiting', 'blocked'].includes(g.status));

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
        {back}
        <H1 style={{ flex: 1 }} >{team.name}</H1>
        {admin && <IconButton name="edit-2" label="Rename team" onPress={() => setRenaming(true)} />}
      </View>
      {store.teams.length > 1 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 6 }}>
          {store.teams.map((t) => <Chip key={t.id} label={t.name} selected={t.id === team.id} onPress={() => setTeamId(t.id)} />)}
        </View>
      )}
      <Muted style={{ marginBottom: 12 }}>
        Give any step to a teammate or a role and its project is shared with the team automatically. Everyone’s Today shows only their own steps, and you’ll see when teammates finish theirs. Life areas, history and email stay private.
      </Muted>
      {error && <Banner tone="soft" text={error} />}

      <H2 style={{ marginTop: 6, marginBottom: 8 }}>People</H2>
      <Card style={{ paddingVertical: 4 }}>
        {members.map((m, i) => (
          <View key={m.user_id}>
            {i > 0 && <Divider />}
            <Row icon="user" title={m.user_id === store.me ? `${m.display_name} (you)` : m.display_name}
              subtitle={rolesOf(m.user_id).map(roleName).filter(Boolean).join(', ') || 'No role yet'}
              value={m.is_admin ? 'Admin' : undefined}
              onPress={admin || m.user_id === store.me ? () => setMember(m) : undefined} />
          </View>
        ))}
      </Card>
      {admin && <Button title="Invite someone" icon="user-plus" variant="soft" onPress={() => setInviting(true)} style={{ marginTop: 10 }} />}

      {admin && invites.length > 0 && (
        <>
          <Muted style={{ marginTop: 14, marginBottom: 6 }}>Waiting to join</Muted>
          {invites.map((i) => <PendingInvite key={i.id} invite={i} roleName={roleName(i.role_id)} onRevoke={() => run(() => store.revokeInvite(i.id))} />)}
        </>
      )}

      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 20, marginBottom: 8 }}>
        <H2 style={{ flex: 1 }}>Roles</H2>
        {admin && <IconButton name="plus" label="Add a role" onPress={() => setRole({ team_id: team.id, name: '', description: '' })} />}
      </View>
      <Card style={{ paddingVertical: 4 }}>
        {roles.length === 0 && <Muted style={{ padding: 12 }}>No roles yet. Add the jobs on your team (Coach, Developer, Assistant…) so steps, and your AI chat, know who does what.</Muted>}
        {roles.map((r, i) => {
          const people = members.filter((m) => rolesOf(m.user_id).includes(r.id)).map((m) => m.display_name);
          return (
            <View key={r.id}>
              {i > 0 && <Divider />}
              <Row icon="briefcase" title={r.name} subtitle={[r.description, people.length ? people.join(', ') : 'Nobody holds it yet'].filter(Boolean).join(' · ')}
                onPress={admin ? () => setRole(r) : undefined} />
            </View>
          );
        })}
      </Card>

      <H2 style={{ marginTop: 20, marginBottom: 8 }}>Shared projects</H2>
      <Card style={{ paddingVertical: 4 }}>
        {projects.length === 0 && <Muted style={{ padding: 12 }}>None yet. Give a step to a teammate (in the step’s options, or ask your AI chat) and its project is shared automatically.</Muted>}
        {projects.map((g, i) => (
          <View key={g.id}>
            {i > 0 && <Divider />}
            <Row icon="folder" title={g.title} onPress={() => router.push({ pathname: '/project/[id]', params: { id: g.id } })} />
          </View>
        ))}
      </Card>

      <MemberSheet member={member} admin={admin} roles={roles} held={member ? rolesOf(member.user_id) : []} me={store.me} onClose={() => setMember(null)}
        onSave={(p, roleIds) => run(async () => {
          if (!member) return;
          if (p.display_name !== member.display_name || p.is_admin !== member.is_admin) await store.updateMember(team.id, member.user_id, p);
          if (admin && roleIds) await store.setMemberRoles(team.id, member.user_id, roleIds);
          setMember(null);
        })}
        onRemove={() => member && confirm(member.user_id === store.me ? 'Leave this team?' : `Remove ${member.display_name}?`,
          'Their steps on team projects go back to their role or the project owner.',
          () => run(async () => { await store.removeMember(team.id, member.user_id); setMember(null); }))} />
      <RoleSheet role={role} onClose={() => setRole(null)}
        onSave={(r) => run(async () => { await store.saveTeamRole({ id: r.id, team_id: team.id, name: r.name!, description: r.description }); setRole(null); })}
        onDelete={(r) => confirm(`Delete the ${r.name} role?`, 'Steps assigned to it become unassigned.', () => run(async () => { await store.deleteTeamRole(r.id!); setRole(null); }))} />
      <InviteSheet visible={inviting} roles={roles} onClose={() => setInviting(false)} create={(p) => store.createInvite(team.id, p)} />
      <RenameSheet visible={renaming} initial={team.name} onClose={() => setRenaming(false)} onSave={(name) => run(async () => { await store.renameTeam(team.id, name); setRenaming(false); })} />
    </Screen>
  );
}

function CreateTeam({ onCreate, initialName }: { onCreate: (name: string, you: string) => void; initialName: string }) {
  const [name, setName] = useState('');
  const [you, setYou] = useState(initialName);
  const [busy, setBusy] = useState(false);
  return (
    <Card style={{ marginTop: 12 }}>
      <Body style={{ fontFamily: fonts.medium, marginBottom: 4 }}>Start a team</Body>
      <Muted style={{ marginBottom: 10 }}>Share projects with the people you work with, give everyone a role, and let your AI chat assign each step to the right person.</Muted>
      <Field label="Team name" value={name} onChangeText={setName} placeholder="e.g. Malinda Perry Consulting" />
      <Field label="Your name on the team" value={you} onChangeText={setYou} placeholder="e.g. Malinda" />
      <Button title="Create team" loading={busy} disabled={!name.trim() || !you.trim() || busy} onPress={async () => { setBusy(true); await onCreate(name.trim(), you.trim()); setBusy(false); }} style={{ marginTop: 6 }} />
    </Card>
  );
}

function PendingInvite({ invite, roleName, onRevoke }: { invite: TeamInvite; roleName: string | null; onRevoke: () => void }) {
  const expired = new Date(invite.expires_at) <= new Date();
  return (
    <Card style={{ marginBottom: 8 }}>
      <Body style={{ fontFamily: fonts.medium }}>{invite.name || 'Someone'}{roleName ? ` · ${roleName}` : ''}</Body>
      <Muted>{expired ? 'This link has expired.' : `Link works until ${new Date(invite.expires_at).toLocaleDateString()}.`}</Muted>
      {!expired && <CopyBox text={inviteLink(invite.code)} label="Copy the invite link" />}
      <Button title={expired ? 'Remove' : 'Cancel this invite'} variant="ghost" onPress={onRevoke} />
    </Card>
  );
}

function MemberSheet({ member, admin, roles, held, me, onClose, onSave, onRemove }: {
  member: TeamMember | null; admin: boolean; roles: TeamRole[]; held: string[]; me: string;
  onClose: () => void; onSave: (p: { display_name: string; is_admin: boolean }, roleIds: string[] | null) => void; onRemove: () => void;
}) {
  const [name, setName] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [shownFor, setShownFor] = useState<string | null>(null);
  if (member && shownFor !== member.user_id) { setShownFor(member.user_id); setName(member.display_name); setIsAdmin(member.is_admin); setPicked(held); }
  if (!member && shownFor) setShownFor(null);
  if (!member) return <Sheet visible={false} onClose={onClose}>{null}</Sheet>;
  const self = member.user_id === me;
  return (
    <Sheet visible onClose={onClose} title={self ? 'You on this team' : member.display_name}>
      <Field label="Name on the team" value={name} onChangeText={setName} />
      {admin && (
        <>
          <Muted style={{ marginTop: 6, marginBottom: 6 }}>Roles (tap to add or remove)</Muted>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {roles.map((r) => <Chip key={r.id} label={r.name} selected={picked.includes(r.id)} onPress={() => setPicked(picked.includes(r.id) ? picked.filter((x) => x !== r.id) : [...picked, r.id])} />)}
            {roles.length === 0 && <Muted>Add roles on the Team screen first.</Muted>}
          </View>
          {!self && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 }}>
              <Chip label="Admin: manages people, roles and invites" selected={isAdmin} onPress={() => setIsAdmin(!isAdmin)} />
            </View>
          )}
        </>
      )}
      <Button title="Save" disabled={!name.trim()} onPress={() => onSave({ display_name: name.trim(), is_admin: isAdmin }, admin ? picked : null)} style={{ marginTop: 12 }} />
      <SheetOption icon={self ? 'log-out' : 'user-x'} label={self ? 'Leave this team' : 'Remove from the team'} destructive onPress={onRemove} />
    </Sheet>
  );
}

function RoleSheet({ role, onClose, onSave, onDelete }: { role: Partial<TeamRole> | null; onClose: () => void; onSave: (r: Partial<TeamRole>) => void; onDelete: (r: Partial<TeamRole>) => void }) {
  const [d, setD] = useState<Partial<TeamRole> | null>(null);
  // A fresh copy each time the sheet opens (a new role has no id to compare, so key on the object itself).
  useEffect(() => { setD(role); }, [role]);
  if (!role || !d) return <Sheet visible={false} onClose={onClose}>{null}</Sheet>;
  return (
    <Sheet visible onClose={onClose} title={role.id ? 'Edit role' : 'New role'}>
      <Field label="Role" value={d.name ?? ''} onChangeText={(name) => setD({ ...d, name })} placeholder="e.g. Developer" />
      <Field label="What this role does (helps your AI chat assign steps)" value={d.description ?? ''} onChangeText={(description) => setD({ ...d, description })} placeholder="e.g. Builds and fixes the website and systems" multiline />
      <Button title="Save" disabled={!d.name?.trim()} onPress={() => onSave({ ...d, name: d.name!.trim(), description: d.description?.trim() || null })} style={{ marginTop: 6 }} />
      {role.id && <SheetOption icon="trash-2" label="Delete this role" destructive onPress={() => onDelete(role)} />}
    </Sheet>
  );
}

function InviteSheet({ visible, roles, onClose, create }: { visible: boolean; roles: TeamRole[]; onClose: () => void; create: (p: { name?: string; role_id?: string | null }) => Promise<TeamInvite> }) {
  const [name, setName] = useState('');
  const [roleId, setRoleId] = useState<string | null>(null);
  const [made, setMade] = useState<TeamInvite | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => { setName(''); setRoleId(null); setMade(null); setError(null); onClose(); };
  return (
    <Sheet visible={visible} onClose={close} title="Invite someone">
      {made ? (
        <>
          <Muted style={{ marginBottom: 6 }}>Send this link to {made.name || 'them'}. It works once, for 14 days. They sign in or create an account, then join.</Muted>
          <CopyBox text={inviteLink(made.code)} label="Copy the invite link" />
          <Button title="Done" onPress={close} style={{ marginTop: 8 }} />
        </>
      ) : (
        <>
          <Field label="Their name (optional)" value={name} onChangeText={setName} placeholder="e.g. AnneMarie" />
          {roles.length > 0 && (
            <>
              <Muted style={{ marginTop: 6, marginBottom: 6 }}>Their role (optional)</Muted>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {roles.map((r) => <Chip key={r.id} label={r.name} selected={roleId === r.id} onPress={() => setRoleId(roleId === r.id ? null : r.id)} />)}
              </View>
            </>
          )}
          {error && <Banner tone="soft" text={error} />}
          <Button title="Create invite link" icon="link" loading={busy} disabled={busy} style={{ marginTop: 10 }}
            onPress={async () => {
              setBusy(true); setError(null);
              try { setMade(await create({ name: name.trim(), role_id: roleId })); } catch (e) { setError((e as Error).message); }
              setBusy(false);
            }} />
        </>
      )}
    </Sheet>
  );
}

function RenameSheet({ visible, initial, onClose, onSave }: { visible: boolean; initial: string; onClose: () => void; onSave: (name: string) => void }) {
  const [name, setName] = useState(initial);
  const [shown, setShown] = useState(false);
  if (visible && !shown) { setShown(true); setName(initial); }
  if (!visible && shown) setShown(false);
  return (
    <Sheet visible={visible} onClose={onClose} title="Team name">
      <Field value={name} onChangeText={setName} />
      <Button title="Save" disabled={!name.trim()} onPress={() => onSave(name.trim())} style={{ marginTop: 6 }} />
    </Sheet>
  );
}
