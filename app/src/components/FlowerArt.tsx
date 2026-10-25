import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { Image, View, type ImageStyle, type StyleProp, type ViewStyle } from 'react-native';
import { PHOTOS, type PhotoSlot } from '../lib/photos';
import { colors, isAviation } from '../theme';
import { Flower } from './Flower';

// The aviation photographs have near-black backdrops: "lighten" lets the navy behind them show through, so the planes
// look cut out. (Browsers support it; elsewhere the dark backdrop simply sits on the navy, which also looks fine.)
const BLEND = { mixBlendMode: 'lighten' } as unknown as ImageStyle;

/**
 * Decorative image for a design slot: the site's photo when there is one, otherwise the vector flower.
 * Momentum: a transparent cut-out. Aviation: the plane on a navy panel (`bare` skips the panel when the page behind it
 * is already navy, as on the welcome screen). `fadeTo` blends the bottom edge into a background color.
 */
export function FlowerArt({ slot, width, height, seed = 0, style, fadeTo, radius = 0, bare }: {
  slot: PhotoSlot; width: number; height: number; seed?: number; style?: StyleProp<ViewStyle>; fadeTo?: string; radius?: number; bare?: boolean;
}) {
  const photo = PHOTOS[slot];
  const panel = isAviation && !bare;
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ width, height, overflow: 'hidden', borderRadius: panel ? Math.max(radius, Math.min(width, height) * 0.14) : radius, alignItems: 'center', justifyContent: 'center' },
        // The blend can only mix with this container, so it carries the navy itself (also when `bare`: the page around
        // it is the same navy, so no edge shows).
        isAviation && { backgroundColor: colors.hero }, style]}
    >
      {photo ? (
        <Image source={photo} resizeMode={isAviation ? 'cover' : 'contain'} style={[{ width, height }, isAviation && BLEND]} />
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

/** Banner at the top of a project: a wash with a large image cropped off the right edge (a flower, or a plane on navy). */
export function ProjectBanner({ height = 120, seed = 1.3 }: { height?: number; seed?: number }) {
  const photo = PHOTOS.project;
  const size = height * 2.2;
  return (
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ height, borderRadius: 18, overflow: 'hidden' }}>
      <LinearGradient colors={isAviation ? [colors.bannerFrom, colors.bannerTo] : [colors.bannerFrom, '#F6E3E0', colors.bannerTo]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ position: 'absolute', inset: 0 }} />
      {isAviation ? (
        photo ? <Image source={photo} resizeMode="cover" style={[{ position: 'absolute', right: -height * 0.3, top: 0, width: height * 2.4, height }, BLEND]} /> : null
      ) : (
        <View style={{ position: 'absolute', right: -30, top: -height * 0.55 }}>
          {photo ? <Image source={photo} resizeMode="contain" style={{ width: size, height: size }} /> : <Flower size={size} seed={seed} />}
        </View>
      )}
    </View>
  );
}
