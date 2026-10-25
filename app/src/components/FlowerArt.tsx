import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { Image, View, type StyleProp, type ViewStyle } from 'react-native';
import { PHOTOS, type PhotoSlot } from '../lib/photos';
import { colors } from '../theme';
import { Flower } from './Flower';

/**
 * Decorative flower for a design slot: the configured photo when there is one, otherwise the vector flower.
 * `fadeTo` blends the photo's bottom edge into a background color, the way the mockup's images dissolve into the page.
 */
export function FlowerArt({ slot, width, height, seed = 0, style, fadeTo, radius = 0 }: {
  slot: PhotoSlot; width: number; height: number; seed?: number; style?: StyleProp<ViewStyle>; fadeTo?: string; radius?: number;
}) {
  const photo = PHOTOS[slot];
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ width, height, overflow: 'hidden', borderRadius: radius, alignItems: 'center', justifyContent: 'center' }, style]}
    >
      {photo ? (
        <Image source={photo} resizeMode="contain" style={{ width, height }} />
      ) : (
        <Flower size={Math.max(width, height) * (slot === 'project' ? 0.9 : 1)} seed={seed} />
      )}
      {fadeTo && (
        <LinearGradient
          colors={['transparent', fadeTo]}
          locations={[0.55, 1]}
          style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: height * 0.6 }}
        />
      )}
    </View>
  );
}

/** Banner at the top of a project: a soft pink wash with a large flower cropped off the right edge. */
export function ProjectBanner({ height = 120, seed = 1.3 }: { height?: number; seed?: number }) {
  const photo = PHOTOS.project;
  const size = height * 2.2;
  return (
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ height, borderRadius: 18, overflow: 'hidden' }}>
      <LinearGradient colors={['#E9D4CF', '#F6E3E0', colors.pinkWash]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ position: 'absolute', inset: 0 }} />
      <View style={{ position: 'absolute', right: -30, top: -height * 0.55 }}>
        {photo ? <Image source={photo} resizeMode="contain" style={{ width: size, height: size }} /> : <Flower size={size} seed={seed} />}
      </View>
    </View>
  );
}
