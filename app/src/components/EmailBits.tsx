import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { EmailCategory } from '../core/ai-contracts';
import { friendlyDate, toISODate } from '../core/dates';
import { useStore, type EmailDigest } from '../lib/store';
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
