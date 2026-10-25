import React, { useEffect, useMemo, useState } from 'react';
import { Linking, Platform, Pressable, Text, View } from 'react-native';
import type { EmailCategory } from '../core/ai-contracts';
import { friendlyDate, timeOfDay, toISODate } from '../core/dates';
import { briefingParts, doFirst, emailLink, oneLine, rulesBriefing, senderLabel } from '../core/emailBrief';
import { useStore, type EmailDigest, type EmailMessage } from '../lib/store';
import { colors, fonts, radius, shadow } from '../theme';
import { Body, Icon, Muted, type IconName } from './ui';

export const CATEGORY_META: Record<EmailCategory, { label: string; color: string; soft: string; icon: IconName }> = {
  action_needed: { label: 'Needs action', color: colors.pinkDeep, soft: colors.pinkWash, icon: 'alert-circle' },
  waiting_on: { label: 'Waiting on', color: '#B7862A', soft: colors.amberSoft, icon: 'clock' },
  fyi: { label: 'FYI', color: colors.teal, soft: colors.tealSoft, icon: 'info' },
  personal: { label: 'Personal', color: colors.coral, soft: '#FDE8DD', icon: 'heart' },
  receipt: { label: 'Receipt', color: '#6E8F55', soft: colors.greenSoft, icon: 'file-text' },
  newsletter: { label: 'Newsletter', color: colors.lavender, soft: colors.lavenderSoft, icon: 'book-open' },
  promotion: { label: 'Promotion', color: colors.textMuted, soft: colors.track, icon: 'tag' },
  other: { label: 'Other', color: colors.textMuted, soft: colors.track, icon: 'mail' },
};

export function DigestCard({ digest, onOpen, compact }: { digest: EmailDigest; onOpen?: (messageId: string) => void; compact?: boolean }) {
  const c = digest.counts ?? {};
  return (
    <View style={[{ backgroundColor: colors.card, borderRadius: radius.lg, padding: 16, borderWidth: 1, borderColor: colors.border, marginTop: 8 }, shadow]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name="sun" size={16} color={colors.pink} />
        <Text style={{ fontFamily: fonts.semibold, color: colors.pinkDeep, fontSize: 13 }}>Inbox digest</Text>
        <Muted style={{ marginLeft: 'auto', fontSize: 12 }}>{friendlyDate(toISODate(new Date(digest.created_at)))}</Muted>
      </View>
      <Body style={{ marginTop: 8, lineHeight: 22 }} numberOfLines={compact ? 3 : undefined}>{digest.summary}</Body>
      {!compact && digest.highlights.map((h) => (
        <Pressable key={h.message_id} onPress={() => onOpen?.(h.message_id)} accessibilityRole="button" style={({ pressed }) => [{ flexDirection: 'row', gap: 8, paddingVertical: 6, alignItems: 'flex-start' }, pressed && { opacity: 0.6 }]}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.pink, marginTop: 8 }} />
          <Body style={{ flex: 1, fontSize: 14 }}>{h.text}</Body>
          <Icon name="chevron-right" size={16} color={colors.textFaint} />
        </Pressable>
      ))}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
        {(['action_needed', 'waiting_on', 'fyi', 'newsletter'] as EmailCategory[]).filter((k) => c[k]).map((k) => (
          <View key={k} style={{ backgroundColor: CATEGORY_META[k].soft, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 }}>
            <Text style={{ fontFamily: fonts.medium, fontSize: 12, color: CATEGORY_META[k].color }}>{c[k]} {CATEGORY_META[k].label.toLowerCase()}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** Whether this server can connect any inbox (null while checking). Accounts already connected always count. */
export function useEmailAvailable(): boolean | null {
  const store = useStore();
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    store.emailProviders().then((p) => setOk(p.gmail || p.outlook || p.imap)).catch(() => setOk(false));
  }, [store.emailProviders]);
  return store.emailAccounts.length > 0 ? true : ok;
}

const APPLE = Platform.OS === 'ios' || (typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? ''));

/** Opens an email in its own mail app (Gmail, Outlook, the inbox's webmail, or Apple Mail on Apple devices). */
export function OpenInMail({ m, small }: { m: EmailMessage; small?: boolean }) {
  const store = useStore();
  const link = emailLink(m, store.emailAccounts.find((a) => a.id === m.account_id), APPLE);
  if (!link) return null;
  return (
    <Pressable onPress={() => Linking.openURL(link.url).catch(() => {})} accessibilityRole="link" accessibilityLabel={`${link.label}: ${m.subject ?? ''}`} hitSlop={8}
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: small ? 2 : 6 }, pressed && { opacity: 0.6 }]}>
      <Icon name="external-link" size={small ? 12 : 14} color={colors.teal} />
      <Text style={{ fontFamily: fonts.medium, fontSize: small ? 12 : 14, color: colors.teal }}>{link.label}</Text>
    </Pressable>
  );
}

export interface BriefItem { m: EmailMessage; why: string }

/**
 * One briefing for the whole app, so the Inbox summary, its "Do first" tab and Today's inbox card always agree.
 * Today's briefing from the person's AI chat (or Momentum's AI) wins when there is one, with anything that arrived
 * after it flagged; otherwise Momentum's rules write it live from the synced mail.
 */
export function useInboxBriefing() {
  const store = useStore();
  const today = toISODate(new Date());
  const recent = useMemo(() => store.emailMessages.filter((m) => Date.now() - new Date(m.received_at).getTime() < 3 * 86_400_000), [store.emailMessages]);
  const projects = useMemo(() => store.goals.filter((g) => ['active', 'waiting', 'blocked'].includes(g.status)), [store.goals]);
  const live = useMemo(() => rulesBriefing(recent, projects), [recent, projects]);
  const d = store.emailDigest;
  const saved = d && d.digest_date === today && d.source && d.source !== 'rules' ? d : null;
  const since = saved?.updated_at ?? saved?.created_at ?? null;
  const open = (id: string) => store.emailMessages.find((x) => x.id === id && !x.is_archived && x.status !== 'dismissed' && x.status !== 'tasks_created');
  const resolve = (xs: { message_id: string; why: string }[]): BriefItem[] => xs.map((x) => ({ m: open(x.message_id)!, why: x.why })).filter((x) => x.m);
  const savedList = saved ? (saved.do_first?.length ? saved.do_first : saved.highlights.map((h) => ({ message_id: h.message_id, why: h.text }))) : null;
  const list = resolve(savedList ?? live.do_first);
  const newer = saved && since ? resolve(doFirst(recent.filter((m) => m.received_at > since), projects)).filter((x) => !list.some((l) => l.m.id === x.m.id)) : [];
  const who = saved?.source === 'chat' ? `From ${saved.author && !/^[0-9a-f-]{20,}$/i.test(saved.author) ? saved.author : 'your AI chat'}` : saved?.source === 'ai' ? 'From Momentum’s AI' : 'Momentum’s rules';
  return { summary: saved?.summary ?? live.summary, list: [...list, ...newer], newer: newer.length, saved: !!saved, who, when: since ? timeOfDay(since) : 'live' };
}

/** The Inbox summary: one short paragraph. The emails themselves are in the "Do first" tab below it. */
/**
 * Summary text with each referenced email drawn as a chip ("✉ Dana · Document review") that opens it, so emails and
 * plain words never blur together. A reference to an email that's gone (archived) shows muted.
 */
export function BriefingText({ summary, onOpen }: { summary: string; onOpen?: (messageId: string) => void }) {
  const store = useStore();
  return (
    <Text style={{ fontFamily: fonts.body, fontSize: 15, color: colors.text, lineHeight: 26, marginTop: 8 }}>
      {briefingParts(summary).map((part, i) => {
        if ('text' in part) return <Text key={i}>{part.text}</Text>;
        const m = store.emailMessages.find((x) => x.id === part.email);
        const label = part.label ?? (m ? `${senderLabel(m)} · ${m.subject ?? 'no subject'}` : 'an email');
        return (
          <Text key={i} onPress={m && onOpen ? () => onOpen(m.id) : undefined} accessibilityRole={m ? 'link' : undefined}
            style={{ fontFamily: fonts.medium, color: m ? colors.pinkDeep : colors.textMuted, backgroundColor: m ? colors.pinkWash : colors.track }}>
            {` ✉ ${label} `}
          </Text>
        );
      })}
    </Text>
  );
}

export function InboxBriefing({ onOpen }: { onOpen?: (messageId: string) => void }) {
  const b = useInboxBriefing();
  return (
    <View style={[{ backgroundColor: colors.card, borderRadius: radius.lg, padding: 16, borderWidth: 1, borderColor: colors.border, marginTop: 8 }, shadow]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name={b.who.startsWith('From your') || b.who.startsWith('From ') ? 'message-circle' : 'sun'} size={16} color={colors.pink} />
        <Text style={{ fontFamily: fonts.semibold, color: colors.pinkDeep, fontSize: 13 }}>Inbox briefing</Text>
        <Muted style={{ marginLeft: 'auto', fontSize: 12 }}>{b.who} · {b.when}</Muted>
      </View>
      <BriefingText summary={b.summary} onOpen={onOpen} />
      {b.newer > 0 && <Muted style={{ marginTop: 6, color: '#B7862A' }}>{b.newer} more arrived since this briefing.</Muted>}
      {!b.saved && <Muted style={{ marginTop: 10, fontSize: 12 }}>Want a smarter read? Ask your AI chat: “Check my Momentum inbox and tell me what to answer first.” Its briefing will show here.</Muted>}
    </View>
  );
}

/** Today: the inbox as one task ("Answer 2 emails"), not a block of text. Hidden when nothing needs you. */
export function InboxTaskCard({ onPress }: { onPress: () => void }) {
  const b = useInboxBriefing();
  if (!b.list.length) return null;
  const n = b.list.length;
  const first = b.list[0];
  const minutes = Math.min(60, n * 5);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`Inbox: answer ${n} email${n === 1 ? '' : 's'}`}
      style={({ pressed }) => [{ backgroundColor: colors.card, borderRadius: radius.lg, padding: 16, borderWidth: 1, borderColor: colors.border, marginBottom: 12 }, shadow, pressed && { opacity: 0.8 }]}>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.pinkWash, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="mail" size={20} color={colors.pink} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: fonts.medium, fontSize: 13, color: colors.pinkDeep }}>Inbox</Text>
          <Body style={{ fontFamily: fonts.medium, fontSize: 17, marginTop: 2 }}>Answer {n} email{n === 1 ? '' : 's'}</Body>
          <Muted style={{ marginTop: 4 }} numberOfLines={2}>Start with {oneLine(first.m)}</Muted>
        </View>
        <View style={{ alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <Icon name="chevron-right" size={18} color={colors.textFaint} />
          <View style={{ backgroundColor: colors.tealSoft, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 }}>
            <Text style={{ fontFamily: fonts.medium, fontSize: 12, color: colors.teal }}>~{minutes} min</Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}
