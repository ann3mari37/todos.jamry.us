import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { colors } from '../theme';

// A one-shot confetti popper: pieces burst up and out from an origin, then tumble down under gravity,
// spinning and flipping (scaleX swings through 0 so flat pieces look like they're turning over).
// Everything runs on the native driver; the layer never blocks touches.

const PALETTE = [colors.pink, colors.pinkDeep, colors.coral, colors.amber, colors.teal, colors.green, colors.lavender, '#FFFFFF'];
type Shape = 'strip' | 'square' | 'dot';

interface Piece {
  color: string; shape: Shape; w: number; h: number;
  xs: number[]; ys: number[]; // sampled trajectory (relative to origin), same length as STEPS
  spin: number; flips: number; delay: number; duration: number;
}

const STEPS = Array.from({ length: 17 }, (_, i) => i / 16);

/** Deterministic pseudo-random so a burst looks the same within a render but varies between bursts. */
function rng(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/**
 * Simulates one piece: launched fast, slowed by air drag, pulled down by gravity until it flutters at a
 * steady speed, swaying side to side. Returns positions sampled at STEPS of its lifetime.
 */
function flight(r: () => number, height: number, durationS: number) {
  const angle = (-90 + (r() - 0.5) * 150) * (Math.PI / 180); // mostly up, fanned out ±75°
  const power = Math.min(height, 900) * (1.3 + r() * 1.4); // px/s at launch
  let vx = Math.cos(angle) * power;
  let vy = Math.sin(angle) * power;
  const gravity = 1100; // px/s²
  const drag = 2.2 + r() * 1.6; // per second; sets the flutter (terminal) speed
  const swayAmp = 8 + r() * 22;
  const swayFreq = 2 + r() * 3;
  const phase = r() * Math.PI * 2;
  let x = 0, y = 0, t = 0;
  const dt = 1 / 120;
  const xs: number[] = [], ys: number[] = [];
  for (const step of STEPS) {
    const target = step * durationS;
    while (t < target) {
      vx -= vx * drag * dt;
      vy += (gravity - vy * drag) * dt;
      x += vx * dt;
      y += vy * dt;
      t += dt;
    }
    // Sway grows as the piece slows into its flutter.
    const sway = Math.sin(t * swayFreq * Math.PI + phase) * swayAmp * Math.min(1, t / 0.6);
    xs.push(Math.round(x + sway));
    ys.push(Math.round(y));
  }
  return { xs, ys };
}

function makePieces(count: number, width: number, height: number, seed: number, delay: number): Piece[] {
  const r = rng(seed);
  return Array.from({ length: count }, () => {
    const shape: Shape = r() < 0.55 ? 'strip' : r() < 0.6 ? 'square' : 'dot';
    const size = 8 + r() * 8;
    const duration = 2600 + r() * 1600;
    const { xs, ys } = flight(r, height, duration / 1000);
    return {
      color: PALETTE[Math.floor(r() * PALETTE.length)],
      shape,
      w: shape === 'strip' ? size * 0.5 : size * 0.85,
      h: shape === 'strip' ? size * 1.9 : size * 0.85,
      xs, ys,
      spin: (r() < 0.5 ? -1 : 1) * (360 + r() * 720),
      flips: 2 + Math.floor(r() * 5),
      delay: delay + r() * 120,
      duration,
    };
  });
}

function ConfettiPiece({ p, ox, oy }: { p: Piece; ox: number; oy: number }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.timing(t, { toValue: 1, duration: p.duration, delay: p.delay, easing: Easing.linear, useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [t, p]);
  const flipRange = Array.from({ length: p.flips * 2 + 1 }, (_, i) => i / (p.flips * 2));
  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: ox - p.w / 2,
        top: oy - p.h / 2,
        width: p.w,
        height: p.h,
        borderRadius: p.shape === 'dot' ? p.w / 2 : 1.5,
        backgroundColor: p.color,
        borderWidth: p.color === '#FFFFFF' ? StyleSheet.hairlineWidth : 0,
        borderColor: colors.pinkSoft,
        opacity: t.interpolate({ inputRange: [0, 0.02, 0.8, 1], outputRange: [0, 1, 1, 0] }),
        transform: [
          { translateX: t.interpolate({ inputRange: STEPS, outputRange: p.xs }) },
          { translateY: t.interpolate({ inputRange: STEPS, outputRange: p.ys }) },
          { rotate: t.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${p.spin}deg`] }) },
          // Flat pieces turning over: width swings 1 → -1 → 1.
          { scaleX: p.shape === 'dot' ? 1 : t.interpolate({ inputRange: flipRange, outputRange: flipRange.map((_, i) => (i % 2 === 0 ? 1 : -1)) }) },
        ],
      }}
    />
  );
}

/**
 * Full-screen confetti layer. `origin` is where the popper fires from (fractions of the screen).
 * Two bursts: a big one, then a smaller follow-up, like a real popper.
 */
export function Confetti({ width, height, origin = { x: 0.5, y: 0.4 }, count = 70, seed = 7 }: {
  width: number; height: number; origin?: { x: number; y: number }; count?: number; seed?: number;
}) {
  const pieces = useMemo(
    () => [...makePieces(count, width, height, seed, 0), ...makePieces(Math.round(count * 0.4), width, height, seed + 97, 650)],
    [count, width, height, seed],
  );
  return (
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[StyleSheet.absoluteFill, { zIndex: 10, overflow: 'hidden' }]}>
      {pieces.map((p, i) => <ConfettiPiece key={i} p={p} ox={width * origin.x} oy={height * origin.y} />)}
    </View>
  );
}
