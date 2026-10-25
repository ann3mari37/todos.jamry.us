import React, { useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import type { EmailCategory } from '../core/ai-contracts';
import { friendlyDate, timeOfDay, toISODate } from '../core/dates';
import { doFirst, emailLink, rulesBriefing } from '../core/emailBrief';
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

/** Opens an email in its own mail app (Gmail, Outlook, Apple Mail, or the provider's webmail). */
export function OpenInMail({ m, small }: { m: EmailMessage; small?: boolean }) {
  const store = useStore();
  const link = emailLink(m, store.emailAccounts.find((a) => a.id === m.account_id));
  if (!link) return null;
  return (
    <Pressable onPress={() => Linking.openURL(link.url).catch(() => {})} accessibilityRole="link" accessibilityLabel={`${link.label}: ${m.subject ?? ''}`} hitSlop={8}
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: small ? 2 : 6 }, pressed && { opacity: 0.6 }]}>
      <Icon name="external-link" size={small ? 12 : 14} color={colors.teal} />
      <Text style={{ fontFamily: fonts.medium, fontSize: small ? 12 : 14, color: colors.teal }}>{link.label}</Text>
    </Pressable>
  );
}

/**
 * The inbox briefing: one cohesive paragraph and the emails to do first, each with why and a link to open it.
 * Uses today's briefing from the person's AI chat (or Momentum's AI) when there is one, and flags mail that arrived
 * after it; otherwise Momentum's rules write it live from the synced mail.
 */
export function InboxBriefing({ compact, onOpen }: { compact?: boolean; onOpen?: (messageId: string) => void }) {
  const store = useStore();
  const today = toISODate(new Date());
  const recent = useMemo(() => store.emailMessages.filter((m) => Date.now() - new Date(m.received_at).getTime() < 2 * 86_400_000), [store.emailMessages]);
  const projects = store.goals.filter((g) => ['active', 'waiting', 'blocked'].includes(g.status));
  const saved = store.emailDigest && store.emailDigest.digest_date === today && store.emailDigest.source && store.emailDigest.source !== 'rules' ? store.emailDigest : null;
  const live = useMemo(() => rulesBriefing(recent, projects), [recent, projects.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const since = saved?.updated_at ?? saved?.created_at;
  const newer = saved && since ? doFirst(recent.filter((m) => m.received_at > since), projects) : [];
  const summary = saved?.summary ?? live.summary;
  const list = (saved?.do_first?.length ? saved.do_first : saved ? saved.highlights.map((h) => ({ message_id: h.message_id, why: h.text })) : live.do_first)
    .filter((d) => store.emailMessages.some((m) => m.id === d.message_id && !m.is_archived && m.status !== 'dismissed'));
  const who = saved?.source === 'chat' ? `From ${saved.author && !/^[0-9a-f-]{20,}$/i.test(saved.author) ? saved.author : 'your AI chat'}` : saved?.source === 'ai' ? 'From Momentum’s AI' : 'Momentum’s rules';
  const when = saved && since ? timeOfDay(since) : 'live';
  const row = (d: { message_id: string; why: string }, i: number, isNew = false) => {
    const m = store.emailMessages.find((x) => x.id === d.message_id)!;
    return (
      <View key={`${isNew ? 'n' : 'd'}-${d.message_id}`} style={{ flexDirection: 'row', gap: 10, paddingVertical: 7 }}>
        <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: isNew ? colors.amberSoft : colors.pinkWash, alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
          <Text style={{ fontFamily: fonts.semibold, fontSize: 11, color: isNew ? '#B7862A' : colors.pinkDeep }}>{isNew ? 'new' : i + 1}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Pressable onPress={() => onOpen?.(m.id)} accessibilityRole="button" accessibilityLabel={`${m.from_name ?? m.from_address}: ${m.subject ?? ''}`}>
            <Body numberOfLines={1} style={{ fontFamily: fonts.medium, fontSize: 14 }}>{m.from_name || m.from_address} · {m.subject || '(no subject)'}</Body>
            <Muted numberOfLines={2}>{d.why}</Muted>
          </Pressable>
          <OpenInMail m={m} small />
        </View>
      </View>
    );
  };
  return (
    <View style={[{ backgroundColor: colors.card, borderRadius: radius.lg, padding: 16, borderWidth: 1, borderColor: colors.border, marginTop: 8 }, shadow]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name={saved?.source === 'chat' ? 'message-circle' : 'sun'} size={16} color={colors.pink} />
        <Text style={{ fontFamily: fonts.semibold, color: colors.pinkDeep, fontSize: 13 }}>Inbox briefing</Text>
        <Muted style={{ marginLeft: 'auto', fontSize: 12 }}>{who} · {when}</Muted>
      </View>
      <Body style={{ marginTop: 8, lineHeight: 22 }} numberOfLines={compact ? 4 : undefined}>{summary}</Body>
      {list.length > 0 && <Text style={{ fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 0.5, color: colors.textMuted, marginTop: 12 }}>DO FIRST</Text>}
      {list.slice(0, compact ? 3 : 10).map((d, i) => row(d, i))}
      {newer.length > 0 && (
        <>
          <Text style={{ fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 0.5, color: '#B7862A', marginTop: 10 }}>ARRIVED SINCE</Text>
          {newer.slice(0, compact ? 2 : 5).map((d, i) => row(d, i, true))}
        </>
      )}
      {!compact && !saved && (
        <Muted style={{ marginTop: 10, fontSize: 12 }}>Want a smarter read? Ask your AI chat: “Check my Momentum inbox and tell me what to answer first.” Its briefing will show here.</Muted>
      )}
    </View>
  );
}
