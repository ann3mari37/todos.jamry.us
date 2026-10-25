import { Feather } from '@expo/vector-icons';
import React from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fonts, radius, shadow } from '../theme';

export type IconName = React.ComponentProps<typeof Feather>['name'];

export function Icon({ name, size = 20, color = colors.text }: { name: IconName; size?: number; color?: string }) {
  return <Feather name={name} size={size} color={color} />;
}

/** Centers content on wide (web/desktop) screens while staying full-bleed on phones. */
export function Screen({ children, scroll = true, style, header }: { children: React.ReactNode; scroll?: boolean; style?: StyleProp<ViewStyle>; header?: React.ReactNode }) {
  const body = (
    <View style={[{ width: '100%', maxWidth: 560, alignSelf: 'center', paddingHorizontal: 18, paddingBottom: 32 }, style]}>{children}</View>
  );
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      {header}
      {scroll ? (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1 }}>{body}</ScrollView>
      ) : (
        body
      )}
    </SafeAreaView>
  );
}

export function H1({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text accessibilityRole="header" style={[{ fontFamily: fonts.serif, fontSize: 30, color: colors.text, lineHeight: 38 }, style]}>{children}</Text>;
}
export function H2({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text accessibilityRole="header" style={[{ fontFamily: fonts.serif, fontSize: 22, color: colors.text, lineHeight: 28 }, style]}>{children}</Text>;
}
export function Label({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[{ fontFamily: fonts.semibold, fontSize: 14, color: colors.text, marginTop: 18, marginBottom: 8 }, style]}>{children}</Text>;
}
export function Body({ children, style, numberOfLines }: { children: React.ReactNode; style?: StyleProp<TextStyle>; numberOfLines?: number }) {
  return <Text numberOfLines={numberOfLines} style={[{ fontFamily: fonts.body, fontSize: 15, color: colors.text, lineHeight: 21 }, style]}>{children}</Text>;
}
export function Muted({ children, style, numberOfLines }: { children: React.ReactNode; style?: StyleProp<TextStyle>; numberOfLines?: number }) {
  return <Text numberOfLines={numberOfLines} style={[{ fontFamily: fonts.body, fontSize: 13, color: colors.textMuted, lineHeight: 18 }, style]}>{children}</Text>;
}

export function Card({ children, style, onPress, accessibilityLabel }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; accessibilityLabel?: string }) {
  const s = [styles.card, style];
  if (!onPress) return <View style={s}>{children}</View>;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel} style={({ pressed }) => [s, pressed && { opacity: 0.85 }]}>
      {children}
    </Pressable>
  );
}

export function Button({ title, onPress, variant = 'primary', icon, loading, disabled, style }: {
  title: string; onPress: () => void; variant?: 'primary' | 'soft' | 'ghost'; icon?: IconName; loading?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle>;
}) {
  const bg = variant === 'primary' ? colors.pink : variant === 'soft' ? colors.pinkSoft : 'transparent';
  const fg = variant === 'primary' ? colors.white : colors.pinkDeep;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      style={({ pressed }) => [
        { backgroundColor: bg, borderRadius: radius.pill, minHeight: 52, paddingHorizontal: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
        variant === 'primary' && shadow,
        (pressed || disabled) && { opacity: disabled ? 0.5 : 0.85 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : icon ? <Icon name={icon} size={18} color={fg} /> : null}
      <Text style={{ color: fg, fontFamily: fonts.medium, fontSize: 16 }}>{title}</Text>
    </Pressable>
  );
}

export function IconButton({ name, onPress, label, color = colors.text, size = 22 }: { name: IconName; onPress: () => void; label: string; color?: string; size?: number }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={10} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={name} size={size} color={color} />
    </Pressable>
  );
}

export function Segmented<T extends string>({ options, value, onChange, style }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ flexDirection: 'row', backgroundColor: colors.card, borderRadius: radius.pill, padding: 4, borderWidth: 1, borderColor: colors.border }, style]} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={{ flex: 1, paddingVertical: 9, borderRadius: radius.pill, backgroundColor: on ? colors.pink : 'transparent', alignItems: 'center' }}
          >
            <Text style={{ fontFamily: on ? fonts.semibold : fonts.medium, fontSize: 13, color: on ? colors.white : colors.text }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function ProgressBar({ done, total, color = colors.teal, height = 8 }: { done: number; total: number; color?: string; height?: number }) {
  const pct = total > 0 ? Math.min(1, done / total) : 0;
  return (
    <View
      style={{ height, backgroundColor: colors.track, borderRadius: height, overflow: 'hidden', flex: 1 }}
      accessible
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: total, now: done }}
    >
      <View style={{ width: `${pct * 100}%`, height: '100%', backgroundColor: color, borderRadius: height }} />
    </View>
  );
}

export function IconCircle({ name, color, soft, size = 40 }: { name: IconName; color: string; soft: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: soft, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={name} size={size * 0.48} color={color} />
    </View>
  );
}

export function Pill({ text, color = colors.teal, soft = colors.tealSoft }: { text: string; color?: string; soft?: string }) {
  return (
    <View style={{ backgroundColor: soft, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' }}>
      <Text style={{ color, fontFamily: fonts.medium, fontSize: 12 }}>{text}</Text>
    </View>
  );
}

export function Chip({ label, selected, onPress, color = colors.pink }: { label: string; selected?: boolean; onPress: () => void; color?: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: selected ? color : colors.border, backgroundColor: selected ? colors.pinkWash : colors.card, marginRight: 8, marginBottom: 8 }}
    >
      <Text style={{ fontFamily: fonts.medium, fontSize: 13, color: selected ? colors.pinkDeep : colors.text }}>{label}</Text>
    </Pressable>
  );
}

export function Row({ icon, iconColor, leading, title, subtitle, value, onPress, right, accessibilityLabel }: {
  icon?: IconName; iconColor?: string; leading?: React.ReactNode; title: string; subtitle?: string | null; value?: string; onPress?: () => void; right?: React.ReactNode; accessibilityLabel?: string;
}) {
  const inner = (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12, minHeight: 52 }}>
      {icon && <Icon name={icon} size={20} color={iconColor ?? colors.text} />}
      {leading}
      <View style={{ flex: 1 }}>
        <Body style={{ fontFamily: fonts.medium }}>{title}</Body>
        {subtitle ? <Muted numberOfLines={2}>{subtitle}</Muted> : null}
      </View>
      {value ? <Muted>{value}</Muted> : null}
      {right}
      {onPress && <Icon name="chevron-right" size={18} color={colors.textFaint} />}
    </View>
  );
  return onPress ? (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? title} style={({ pressed }) => pressed && { opacity: 0.7 }}>
      {inner}
    </Pressable>
  ) : inner;
}

export function Divider() {
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />;
}

export function Field(props: TextInputProps & { label?: string }) {
  const { label, style, ...rest } = props;
  return (
    <View style={{ marginBottom: 12 }}>
      {label ? <Muted style={{ marginBottom: 6, fontFamily: fonts.medium, color: colors.text }}>{label}</Muted> : null}
      <TextInput
        placeholderTextColor={colors.textFaint}
        accessibilityLabel={label}
        {...rest}
        style={[{ backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 12, fontFamily: fonts.body, fontSize: 16, color: colors.text, minHeight: 48 }, style]}
      />
    </View>
  );
}

/** Bottom sheet used for edits and choices (cross-platform replacement for Alert.prompt). */
export function Sheet({ visible, onClose, title, children, footer }: { visible: boolean; onClose: () => void; title?: string; children: React.ReactNode; footer?: React.ReactNode }) {
  // A numeric max height: a percentage has no sized parent here, so on web the sheet grew past the screen and cut off its buttons.
  const { height } = useWindowDimensions();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1, justifyContent: 'flex-end' }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(43,39,48,0.28)' }} onPress={onClose} accessibilityLabel="Close" />
        <View style={{ backgroundColor: colors.bg, borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 34, maxHeight: Math.round(height * 0.88), width: '100%', maxWidth: 560, alignSelf: 'center' }}>
          <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: 12 }} />
          {title && <H2 style={{ marginBottom: 12 }}>{title}</H2>}
          <ScrollView style={{ flexGrow: 0, flexShrink: 1 }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
          {footer && <View style={{ paddingTop: 8 }}>{footer}</View>}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function SheetOption({ icon, label, onPress, destructive }: { icon: IconName; label: string; onPress: () => void; destructive?: boolean }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, minHeight: 48 }, pressed && { opacity: 0.6 }]}>
      <Icon name={icon} size={20} color={destructive ? colors.pinkDeep : colors.text} />
      <Body style={destructive ? { color: colors.pinkDeep } : undefined}>{label}</Body>
    </Pressable>
  );
}

export function Banner({ text, tone = 'info' }: { text: string; tone?: 'info' | 'soft' }) {
  return (
    <View accessibilityLiveRegion="polite" style={{ backgroundColor: tone === 'info' ? colors.tealSoft : colors.pinkWash, padding: 12, borderRadius: radius.md, marginVertical: 8 }}>
      <Muted style={{ color: colors.text }}>{text}</Muted>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: colors.border, ...shadow },
});
