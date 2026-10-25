import React from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { colors, fonts } from '../theme';

interface Props {
  value: number;
  label: string;
  size: number;
  from: string;
  to: string;
  emphasis?: boolean;
}

// A celebratory ring. It fills when something happened — it never represents a quota.
export function Ring({ value, label, size, from, to, emphasis }: Props) {
  const stroke = emphasis ? 9 : 6;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const filled = value > 0;
  // Unique per ring: two rings sharing a gradient id (another screen still mounted, or the label changing from
  // "project moved" to "projects moved") make the browser paint with a hidden gradient, so the fill only showed after a reload.
  const id = `ring${React.useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <View
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
      accessible
      accessibilityLabel={`${value} ${label}`}
    >
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={from} />
            <Stop offset="1" stopColor={to} />
          </LinearGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.track} strokeWidth={stroke} fill={colors.white} />
        {filled && (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={`url(#${id})`}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${circ * 0.92} ${circ}`}
            transform={`rotate(-80 ${size / 2} ${size / 2})`}
          />
        )}
      </Svg>
      <Text style={{ fontFamily: fonts.serif, fontSize: emphasis ? 34 : 24, color: colors.text, lineHeight: emphasis ? 40 : 30 }}>{value}</Text>
      <Text style={{ fontFamily: fonts.body, fontSize: emphasis ? 11 : 10, color: colors.textMuted, textAlign: 'center', maxWidth: size - 24 }}>{label}</Text>
    </View>
  );
}
