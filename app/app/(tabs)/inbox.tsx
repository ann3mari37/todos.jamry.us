import { router } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Banner, Body, Button, Card, Chip, Field, H1, Icon, IconButton, Muted, Segmented, Sheet, SheetOption } from '../../src/components/ui';
import type { CommitItem, EmailStep } from '../../src/core/ai-contracts';
import { friendlyDate, startOfDay, timeOfDay } from '../../src/core/dates';
import { friendlyAiError } from '../../src/lib/api';
import { useStore, uuid, type EmailMessage } from '../../src/lib/store';
import { CATEGORY_META, InboxBriefing, OpenInMail, useInboxBriefing } from '../../src/components/EmailBits';
import { isAutomated, notificationGroups, senderLabel, type NotificationGroup } from '../../src/core/emailBrief';
import { colors, fonts, radius } from '../../src/theme';

type Tab = 'first' | 'waiting' | 'rest';

const when = (iso: string) => (new Date(iso).getTime() >= startOfDay().getTime() ? timeOfDay(iso) : friendlyDate(iso.slice(0, 10)));

export default function Inbox() {
  const store = useStore();
  const [tab, setTab] = useState<Tab>('first');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [open, setOpen] = useState<EmailMessage | null>(null);

  const sync = async (force = false) => {
    if (!store.emailAccounts.length) return;
    setSyncing(true);
    try {
      const res = await store.emailSync(force);
      const bad = res.accounts.filter((a) => a.status !== 'active').length;
      setNote(bad ? `${bad} inbox${bad === 1 ? '' : 'es'} couldn't sync. Check Email Accounts.` : null);
      if (!store.emailDigest || store.emailDigest.digest_date !== new Date().toISOString().slice(0, 10)) store.emailRefreshDigest(false).catch(() => {});
    } catch (e) {
      setNote(friendlyAiError(e).replace('Organized without AI — please check the items.', 'Showing what was last synced.'));
    } finally {
      setSyncing(false);
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { sync(false); }, [store.emailAccounts.length]);

  const msgs = useMemo(() => store.emailMessages.filter((m) => !account || m.account_id === account), [store.emailMessages, account]);
  // One source for "what needs me": the same briefing the summary and Today's inbox card use.
  const briefing = useInboxBriefing();
  const first = briefing.list.filter((x) => !account || x.m.account_id === account);
  const firstIds = new Set(first.map((x) => x.m.id));
  const live = msgs.filter((m) => m.status !== 'dismissed' && !m.is_archived);
  const waiting = live.filter((m) => m.category === 'waiting_on' && !firstIds.has(m.id));
  const rest = live.filter((m) => !firstIds.has(m.id) && m.category !== 'waiting_on');
  const people = rest.filter((m) => !isAutomated(m));
  const groups: NotificationGroup[] = notificationGroups(rest);
  const acct = (id: string) => store.emailAccounts.find((a) => a.id === id);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView refreshControl={<RefreshControl refreshing={syncing} onRefresh={() => sync(true)} tintColor={colors.pink} />} contentContainerStyle={{ flexGrow: 1 }}>
        <View style={{ width: '100%', maxWidth: 560, alignSelf: 'center', paddingHorizontal: 18, paddingBottom: 32 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
            <H1 style={{ flex: 1 }}>Inbox</H1>
            {syncing ? <ActivityIndicator color={colors.pink} style={{ width: 44 }} /> : <IconButton name="refresh-cw" label="Sync email" onPress={() => sync(true)} size={20} />}
            <IconButton name="settings" label="Email accounts" onPress={() => router.push('/email-accounts')} size={20} />
          </View>

          {store.emailAccounts.length === 0 ? (
            <Card style={{ alignItems: 'center', paddingVertical: 28, marginTop: 12 }}>
              <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: colors.pinkWash, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="mail" size={26} color={colors.pink} />
              </View>
              <Text style={{ fontFamily: fonts.serif, fontSize: 22, color: colors.text, marginTop: 12 }}>Bring your inbox along</Text>
              <Muted style={{ textAlign: 'center', marginTop: 6, fontSize: 14, maxWidth: 320 }}>
                Connect Gmail, Outlook, iCloud or any IMAP inbox. Momentum summarizes what matters, turns requests into tasks, and keeps the rest out of your way.
              </Muted>
              <Button title="Connect an email account" icon="plus" style={{ marginTop: 16 }} onPress={() => router.push('/email-accounts')} />
            </Card>
          ) : (
            <>
              {store.emailAccounts.length > 1 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 6, marginBottom: 4 }}>
                  <Chip label="All inboxes" selected={!account} onPress={() => setAccount(null)} />
                  {store.emailAccounts.map((a) => <Chip key={a.id} label={a.display_name || a.email_address} selected={account === a.id} onPress={() => setAccount(a.id)} color={a.color} />)}
                </ScrollView>
              )}
              {store.emailAccounts.some((a) => a.status === 'needs_reauth') && (
                <Pressable onPress={() => router.push('/email-accounts')} accessibilityRole="button"><Banner tone="soft" text="An inbox needs to be reconnected. Tap to fix." /></Pressable>
              )}
              {note && <Banner tone="soft" text={note} />}

              <InboxBriefing onOpen={(id) => { const m = store.emailMessages.find((x) => x.id === id); if (m) setOpen(m); }} />

              <Segmented
                value={tab}
                onChange={setTab}
                style={{ marginVertical: 14 }}
                options={[
                  { value: 'first', label: `Do first${first.length ? ` · ${first.length}` : ''}` },
                  { value: 'waiting', label: `Waiting${waiting.length ? ` · ${waiting.length}` : ''}` },
                  { value: 'rest', label: 'Everything else' },
                ]}
              />

              {tab === 'first' && first.map((x, i) => <MessageRow key={x.m.id} m={x.m} rank={i + 1} why={x.why} color={acct(x.m.account_id)?.color ?? colors.teal} onPress={() => setOpen(x.m)} />)}
              {tab === 'waiting' && waiting.map((m) => <MessageRow key={m.id} m={m} color={acct(m.account_id)?.color ?? colors.teal} onPress={() => setOpen(m)} />)}
              {tab === 'rest' && (
                <>
                  {people.map((m) => <MessageRow key={m.id} m={m} color={acct(m.account_id)?.color ?? colors.teal} onPress={() => setOpen(m)} />)}
                  {groups.map((g) => (
                    <View key={g.sender}>
                      <Card onPress={() => setExpanded(expanded === g.sender ? null : g.sender)} accessibilityLabel={`${g.count} from ${g.sender}`} style={{ paddingVertical: 14 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.track, alignItems: 'center', justifyContent: 'center' }}>
                            <Icon name="bell" size={18} color={colors.textMuted} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Body style={{ fontFamily: g.unread ? fonts.semibold : fonts.medium }}>{g.sender} · {g.count} notification{g.count === 1 ? '' : 's'}</Body>
                            <Muted numberOfLines={1}>{g.count > 1 && g.topic ? `Mostly “${g.topic}”` : g.latest.subject} · {when(g.latest.received_at)}</Muted>
                          </View>
                          <Icon name={expanded === g.sender ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textFaint} />
                        </View>
                      </Card>
                      {expanded === g.sender && g.ids.map((id) => {
                        const m = live.find((x) => x.id === id);
                        return m ? <MessageRow key={id} m={m} compact color={acct(m.account_id)?.color ?? colors.teal} onPress={() => setOpen(m)} /> : null;
                      })}
                    </View>
                  ))}
                </>
              )}
              {((tab === 'first' && !first.length) || (tab === 'waiting' && !waiting.length) || (tab === 'rest' && !people.length && !groups.length)) && (
                <Card style={{ alignItems: 'center', paddingVertical: 22 }}>
                  <Icon name="sun" size={22} color={colors.amber} />
                  <Body style={{ fontFamily: fonts.medium, marginTop: 8 }}>{tab === 'first' ? 'Nothing needs you first. Nice.' : tab === 'waiting' ? "You're not waiting on anyone." : 'No other mail from the last week.'}</Body>
                </Card>
              )}
            </>
          )}
        </View>
      </ScrollView>
      <MessageSheet m={open} onClose={() => setOpen(null)} />
    </SafeAreaView>
  );
}

function MessageRow({ m, color, onPress, rank, why, compact }: { m: EmailMessage; color: string; onPress: () => void; rank?: number; why?: string; compact?: boolean }) {
  const store = useStore();
  const meta = CATEGORY_META[m.category ?? 'other'];
  const area = store.lifeAreas.find((a) => a.id === m.life_area_id);
  const name = isAutomated(m) ? senderLabel(m) : m.from_name || m.from_address || 'Unknown sender';
  return (
    <Card onPress={onPress} accessibilityLabel={`${m.is_unread ? 'Unread. ' : ''}${name}: ${m.subject ?? ''}`} style={{ paddingVertical: 14 }}>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: meta.soft, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontFamily: fonts.semibold, fontSize: 16, color: meta.color }}>{name.trim()[0]?.toUpperCase()}</Text>
          <View style={{ position: 'absolute', right: -1, bottom: -1, width: 12, height: 12, borderRadius: 6, backgroundColor: color, borderWidth: 2, borderColor: colors.card }} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {m.is_unread && <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.pink }} />}
            <Body numberOfLines={1} style={{ flex: 1, fontFamily: m.is_unread ? fonts.semibold : fonts.medium, fontSize: 14 }}>{name}</Body>
            <Muted style={{ fontSize: 12 }}>{when(m.received_at)}</Muted>
          </View>
          <Body numberOfLines={1} style={{ fontFamily: fonts.medium, fontSize: 15, marginTop: 2 }}>{m.subject || '(no subject)'}</Body>
          {why ? <Text style={{ fontFamily: fonts.medium, fontSize: 13, color: colors.pinkDeep, marginTop: 3 }}>{rank ? `${rank}. ` : ''}{why}</Text> : null}
          {!compact && <Muted numberOfLines={2} style={{ marginTop: 3 }}>{isAutomated(m) ? '' : m.summary ?? m.snippet ?? ''}</Muted>}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8, alignItems: 'center' }}>
            {m.category && (
              <View style={{ backgroundColor: meta.soft, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 }}>
                <Text style={{ fontFamily: fonts.medium, fontSize: 11, color: meta.color }}>{meta.label}</Text>
              </View>
            )}
            {area && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: area.color }} />
                <Muted style={{ fontSize: 12 }}>{area.name}</Muted>
              </View>
            )}
            {m.status === 'tasks_created' && <Muted style={{ fontSize: 12, color: colors.teal }}>✓ In your plan</Muted>}
            <OpenInMail m={m} small />
            {m.suggested_actions.length > 0 && m.status !== 'tasks_created' && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Icon name="plus-circle" size={12} color={colors.pinkDeep} />
                <Text numberOfLines={1} style={{ fontFamily: fonts.medium, fontSize: 12, color: colors.pinkDeep, maxWidth: 220 }}>{m.suggested_actions[0].title}</Text>
              </View>
            )}
          </View>
        </View>
      </View>
    </Card>
  );
}

function MessageSheet({ m, onClose }: { m: EmailMessage | null; onClose: () => void }) {
  const store = useStore();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<(EmailStep & { on: boolean; area: string | null })[] | null>(null);
  const [labeling, setLabeling] = useState(false);
  const [label, setLabel] = useState('');

  useEffect(() => { setError(null); setSteps(null); setLabeling(false); setLabel(''); }, [m?.id]);
  if (!m) return <Sheet visible={false} onClose={onClose}>{null}</Sheet>;
  const live = store.emailMessages.find((x) => x.id === m.id) ?? m;
  const account = store.emailAccounts.find((a) => a.id === live.account_id);
  const meta = CATEGORY_META[live.category ?? 'other'];

  const run = async (key: string, fn: () => Promise<unknown>, close = false) => {
    setBusy(key); setError(null);
    try { await fn(); if (close) onClose(); } catch (e) { setError(friendlyAiError(e).replace('Organized without AI — please check the items.', 'Please try again.')); } finally { setBusy(null); }
  };

  const proposeTasks = () => {
    const base = live.thread_next_steps.length ? live.thread_next_steps : live.suggested_actions;
    const fallback = { title: `Reply to ${live.from_name ?? live.from_address ?? 'email'}${live.subject ? ` about ${live.subject}` : ''}`.slice(0, 200), estimated_minutes: 10, deadline: null };
    setSteps((base.length ? base : [fallback]).map((s) => ({ ...s, on: true, area: live.life_area_id ?? account?.life_area_id ?? null })));
  };

  const addTasks = () => run('tasks', async () => {
    const items: CommitItem[] = (steps ?? []).filter((s) => s.on && s.title.trim()).map((s) => ({
      client_id: uuid(), kind: 'action', title: s.title.trim(), goal_id: live.suggested_goal_id, life_area_id: live.suggested_goal_id ? null : s.area,
      estimated_minutes: s.estimated_minutes, deadline: s.deadline, deadline_type: s.deadline ? 'target' : 'none', occurred_at: null, meaningful: false,
      next_actions: [], source_email_id: live.id,
    }));
    if (!items.length) return;
    await store.commitCapture(`Email from ${live.from_name ?? live.from_address}: ${live.subject ?? ''}`, 'email', null, items);
  }, true);

  return (
    <Sheet visible onClose={onClose} title={live.subject || '(no subject)'}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: account?.color ?? colors.teal }} />
        <Muted numberOfLines={1} style={{ flex: 1 }}>{live.from_name ?? live.from_address} · {when(live.received_at)} · {account?.display_name || account?.email_address}</Muted>
        <View style={{ backgroundColor: meta.soft, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 }}>
          <Text style={{ fontFamily: fonts.medium, fontSize: 11, color: meta.color }}>{meta.label}</Text>
        </View>
      </View>

      <OpenInMail m={live} />
      <View style={{ backgroundColor: colors.card, borderRadius: radius.md, padding: 14, borderWidth: 1, borderColor: colors.border, marginTop: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <Icon name="star" size={13} color={colors.pink} />
          <Text style={{ fontFamily: fonts.semibold, fontSize: 12, color: colors.pinkDeep }}>{live.thread_summary ? 'Thread summary' : 'Summary'}</Text>
        </View>
        <Body style={{ lineHeight: 22 }}>{live.thread_summary ?? live.summary ?? live.snippet ?? 'Not summarized yet.'}</Body>
        {!live.thread_summary && (
          <Pressable onPress={() => run('thread', () => store.emailThread(live.id))} accessibilityRole="button" style={{ marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32 }}>
            {busy === 'thread' ? <ActivityIndicator size="small" color={colors.pink} /> : <Icon name="align-left" size={14} color={colors.pinkDeep} />}
            <Text style={{ fontFamily: fonts.medium, color: colors.pinkDeep }}>{busy === 'thread' ? 'Reading the whole conversation…' : 'Summarize the whole thread'}</Text>
          </Pressable>
        )}
      </View>
      {error && <Banner tone="soft" text={error} />}

      {steps ? (
        <View style={{ marginTop: 14 }}>
          <Text style={{ fontFamily: fonts.semibold, fontSize: 14, color: colors.text, marginBottom: 4 }}>Add to my plan</Text>
          {live.suggested_goal_id && <Muted style={{ marginBottom: 6 }}>Into project: {store.goals.find((g) => g.id === live.suggested_goal_id)?.title}</Muted>}
          {steps.map((s, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Pressable onPress={() => setSteps(steps.map((x, j) => (j === i ? { ...x, on: !x.on } : x)))} accessibilityRole="checkbox" accessibilityState={{ checked: s.on }} hitSlop={8}
                style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: s.on ? colors.pink : colors.textFaint, backgroundColor: s.on ? colors.pink : 'transparent', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
                {s.on && <Icon name="check" size={13} color={colors.white} />}
              </Pressable>
              <View style={{ flex: 1 }}>
                <Field value={s.title} onChangeText={(title) => setSteps(steps.map((x, j) => (j === i ? { ...x, title } : x)))} accessibilityLabel={`Task ${i + 1}`} />
              </View>
            </View>
          ))}
          {!live.suggested_goal_id && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {store.lifeAreas.filter((a) => !a.archived_at).map((a) => (
                <Chip key={a.id} label={a.name} selected={steps[0]?.area === a.id} onPress={() => setSteps(steps.map((x) => ({ ...x, area: a.id })))} />
              ))}
            </View>
          )}
          <Button title="Add to My Plan" icon="plus" loading={busy === 'tasks'} onPress={addTasks} disabled={!steps.some((s) => s.on && s.title.trim())} style={{ marginTop: 8 }} />
          <Button title="Cancel" variant="ghost" onPress={() => setSteps(null)} />
        </View>
      ) : labeling ? (
        <View style={{ marginTop: 14 }}>
          <Field label="Label" value={label} onChangeText={setLabel} placeholder="e.g. Follow up" autoFocus />
          <Button title="Apply label" loading={busy === 'label'} disabled={!label.trim()} onPress={() => run('label', () => store.emailModify([live.id], 'label', label.trim()), true)} />
          <Button title="Cancel" variant="ghost" onPress={() => setLabeling(false)} />
        </View>
      ) : (
        <View style={{ marginTop: 8 }}>
          {live.status !== 'tasks_created'
            ? <SheetOption icon="plus-circle" label={live.suggested_actions.length || live.thread_next_steps.length ? 'Turn into tasks' : 'Create a task from this'} onPress={proposeTasks} />
            : <SheetOption icon="check-circle" label="Already in your plan — add another task" onPress={proposeTasks} />}
          <SheetOption icon="archive" label={busy === 'archive' ? 'Archiving…' : 'Archive (in your mailbox too)'} onPress={() => run('archive', () => store.emailModify([live.id], 'archive'), true)} />
          {live.is_unread && <SheetOption icon="eye" label="Mark as read (in your mailbox too)" onPress={() => run('read', () => store.emailModify([live.id], 'mark_read'))} />}
          <SheetOption icon="tag" label="Add a label (in your mailbox too)" onPress={() => setLabeling(true)} />
          {live.category === 'action_needed' && <SheetOption icon="x-circle" label="Doesn't need me (hides it here only)" onPress={() => run('dismiss', () => store.emailModify([live.id], 'dismiss'), true)} />}
        </View>
      )}
    </Sheet>
  );
}
