import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Flower } from '../src/components/Flower';
import { Button, IconButton, IconCircle, Muted, type IconName } from '../src/components/ui';
import { useStore } from '../src/lib/store';
import { colors, fonts } from '../src/theme';

const BADGES: { icon: IconName; label: string; color: string; soft: string }[] = [
  { icon: 'star', label: 'Progress\nmade', color: colors.amber, soft: colors.amberSoft },
  { icon: 'heart', label: 'One step\ncloser', color: colors.pink, soft: colors.pinkSoft },
  { icon: 'feather', label: 'Momentum\nbuilding', color: colors.green, soft: colors.greenSoft },
  { icon: 'sun', label: 'Your effort\nmatters', color: colors.amber, soft: colors.amberSoft },
];

function Petal({ x, delay, width, height, color }: { x: number; delay: number; width: number; height: number; color: string }) {
  const y = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(Animated.timing(y, { toValue: 1, duration: 5200, delay, easing: Easing.linear, useNativeDriver: true })).start();
  }, [y, delay]);
  return (
    <Animated.View
      style={{
        position: 'absolute', left: x, top: -20, width: 14, height: 22, borderRadius: 10, backgroundColor: color, opacity: 0.75,
        transform: [
          { translateY: y.interpolate({ inputRange: [0, 1], outputRange: [0, height + 40] }) },
          { translateX: y.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, width * 0.04, -width * 0.02] }) },
          { rotate: y.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '320deg'] }) },
        ],
      }}
    />
  );
}

export default function Celebrate() {
  const { action: actionId, goal: goalId, count } = useLocalSearchParams<{ action?: string; goal?: string; count?: string }>();
  const store = useStore();
  const { width, height } = useWindowDimensions();
  const [reduceMotion, setReduceMotion] = useState(true);
  useEffect(() => { AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => setReduceMotion(true)); }, []);

  const action = store.actions.find((a) => a.id === actionId);
  const goal = store.goals.find((g) => g.id === (goalId ?? action?.goal_id));
  const n = Number(count ?? 0);
  const subtitle = goalId && goal ? `${goal.title} is complete. What a milestone.`
    : action ? `${action.title} is complete.`
    : n > 1 ? `${n} accomplishments recorded. It all counts.`
    : 'Recorded. It all counts.';

  useEffect(() => { AccessibilityInfo.announceForAccessibility?.(`You did it! ${subtitle}`); }, [subtitle]);

  const scale = useRef(new Animated.Value(reduceMotion ? 1 : 0.85)).current;
  useEffect(() => {
    if (!reduceMotion) Animated.spring(scale, { toValue: 1, friction: 5, useNativeDriver: true }).start();
  }, [reduceMotion, scale]);

  const petals = useMemo(() => Array.from({ length: 14 }, (_, i) => ({ x: ((i * 97) % 100) / 100 * width, delay: i * 360, color: i % 4 === 0 ? colors.amber : i % 5 === 0 ? colors.green : colors.pink })), [width]);
  const close = () => (router.canGoBack() ? router.back() : router.replace('/today'));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      {!reduceMotion && petals.map((p, i) => <Petal key={i} {...p} width={width} height={height} />)}
      <View style={{ width: '100%', maxWidth: 520, alignSelf: 'center', flex: 1, paddingHorizontal: 24 }}>
        <IconButton name="x" label="Close" onPress={close} />
        <View style={{ alignItems: 'center', flex: 1, justifyContent: 'center' }}>
          <Animated.View style={{ transform: [{ scale }] }}><Flower size={Math.min(260, width * 0.62)} seed={1.5} /></Animated.View>
          <Text accessibilityRole="header" style={{ fontFamily: fonts.serif, fontSize: 42, color: colors.text, marginTop: 10 }}>You did it!</Text>
          <Muted style={{ fontSize: 17, textAlign: 'center', marginTop: 8, lineHeight: 24 }}>{subtitle}</Muted>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%', marginTop: 28 }}>
            {BADGES.map((b) => (
              <View key={b.label} style={{ alignItems: 'center', flex: 1 }}>
                <IconCircle name={b.icon} color={b.color} soft={b.soft} size={52} />
                <Muted style={{ textAlign: 'center', marginTop: 8, fontSize: 12 }}>{b.label}</Muted>
              </View>
            ))}
          </View>
        </View>
        <View style={{ paddingBottom: 16 }}>
          {goal && goal.status === 'active' ? (
            <>
              <Button title="Next Step  ›" onPress={() => router.replace({ pathname: '/project/[id]', params: { id: goal.id } })} />
              <Button title="Back to Today" variant="soft" style={{ marginTop: 10 }} onPress={() => router.replace('/today')} />
            </>
          ) : (
            <Button title="Done" onPress={() => router.replace('/today')} />
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}
