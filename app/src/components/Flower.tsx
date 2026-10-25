import React, { useMemo } from 'react';
import { Image, View, type ImageStyle } from 'react-native';
import { PHOTOS } from '../lib/photos';
import { colors, isAviation } from '../theme';
import Svg, { Circle, Defs, G, LinearGradient, Path, RadialGradient, Stop } from 'react-native-svg';

// A gerbera daisy drawn in vector form — crisp at any size, no image assets required.

function petal(len: number, width: number) {
  const w = width / 2;
  return `M0,0 C${w},${-len * 0.25} ${w * 1.1},${-len * 0.85} 0,${-len} C${-w * 1.1},${-len * 0.85} ${-w},${-len * 0.25} 0,0 Z`;
}

interface Props {
  size: number;
  /** Rotation offset so several flowers on a screen don't look identical. */
  seed?: number;
  opacity?: number;
}

export function Flower(props: Props) {
  // The aviation look has no flowers: a round navy badge with a classic plane instead.
  if (isAviation) {
    return (
      <View style={{ width: props.size, height: props.size, borderRadius: props.size / 2, overflow: 'hidden', backgroundColor: colors.hero, opacity: props.opacity ?? 1 }}>
        {PHOTOS.celebrate && <Image source={PHOTOS.celebrate} resizeMode="cover" style={[{ width: props.size, height: props.size }, { mixBlendMode: 'lighten' } as unknown as ImageStyle]} />}
      </View>
    );
  }
  return <GerberaFlower {...props} />;
}

function GerberaFlower({ size, seed = 0, opacity = 1 }: Props) {
  const c = 100;
  const layers = useMemo(() => {
    const ring = (count: number, len: number, width: number, offset: number, fill: string) =>
      Array.from({ length: count }, (_, i) => ({ angle: (360 / count) * i + offset + seed, len, width, fill }));
    return [
      ...ring(26, 96, 17, 4, 'url(#back)'),
      ...ring(24, 88, 17, 0, 'url(#mid)'),
      ...ring(22, 62, 13, 8, 'url(#front)'),
      ...ring(30, 40, 7, 3, 'url(#inner)'),
    ];
  }, [seed]);

  const stamens = useMemo(
    () => Array.from({ length: 36 }, (_, i) => {
      const a = (i / 36) * Math.PI * 2 + seed;
      const r = 21 + (i % 2) * 3;
      return { x: c + Math.cos(a) * r, y: c + Math.sin(a) * r, r: i % 2 ? 1.8 : 2.4 };
    }),
    [seed],
  );

  return (
    // Decorative: hidden from screen readers. (The props live on a View because react-native-svg on web passes them to the DOM.)
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: size, height: size }}>
    <Svg width={size} height={size} viewBox="0 0 200 200" opacity={opacity}>
      <Defs>
        <LinearGradient id="back" x1="0" y1="1" x2="0" y2="0">
          <Stop offset="0" stopColor="#E9577A" />
          <Stop offset="1" stopColor="#F38FA4" />
        </LinearGradient>
        <LinearGradient id="mid" x1="0" y1="1" x2="0" y2="0">
          <Stop offset="0" stopColor="#EF6D8A" />
          <Stop offset="0.7" stopColor="#F7A3B4" />
          <Stop offset="1" stopColor="#FBC6D0" />
        </LinearGradient>
        <LinearGradient id="front" x1="0" y1="1" x2="0" y2="0">
          <Stop offset="0" stopColor="#F27E97" />
          <Stop offset="1" stopColor="#FBB7C4" />
        </LinearGradient>
        <LinearGradient id="inner" x1="0" y1="1" x2="0" y2="0">
          <Stop offset="0" stopColor="#F59AA9" />
          <Stop offset="1" stopColor="#FDD7DD" />
        </LinearGradient>
        <RadialGradient id="disc" cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor="#3B1E14" />
          <Stop offset="0.6" stopColor="#5B2D18" />
          <Stop offset="1" stopColor="#9A4A1E" />
        </RadialGradient>
      </Defs>
      {layers.map((p, i) => (
        <G key={i} transform={`translate(${c} ${c}) rotate(${p.angle})`}>
          <Path d={petal(p.len, p.width)} fill={p.fill} />
        </G>
      ))}
      <Circle cx={c} cy={c} r={26} fill="#F4A24E" />
      {stamens.map((s, i) => (
        <Circle key={i} cx={s.x} cy={s.y} r={s.r} fill={i % 3 ? '#F7B55C' : '#E58A3A'} />
      ))}
      <Circle cx={c} cy={c} r={17} fill="url(#disc)" />
    </Svg>
    </View>
  );
}
