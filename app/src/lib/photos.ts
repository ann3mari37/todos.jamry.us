import type { ImageSourcePropType } from 'react-native';
import { isAviation } from '../theme';

// Photography slots from the design. A slot set to null falls back to the vector <Flower />.
//
// welcome   — large image filling the top of the welcome screen
// header    — accent beside the greeting on Today
// project   — cropped off the right edge of a project's banner
// celebrate — large image on the "You did it!" screen (and small tiles on sign-in, onboarding…)
export type PhotoSlot = 'welcome' | 'header' | 'project' | 'celebrate';

// Momentum: transparent gerbera cut-outs that sit on the pink washes.
const MOMENTUM: Record<PhotoSlot, ImageSourcePropType | null> = {
  welcome: require('../../assets/images/gerbera-stem.png'),
  header: require('../../assets/images/gerbera-top.png'),
  project: require('../../assets/images/gerbera-top.png'),
  celebrate: require('../../assets/images/gerbera-top.png'),
};

// Aviation: museum photographs of early aircraft on near-black backdrops (Unsplash License, free to use, credit not
// required). Shown on navy panels with a "lighten" blend, so the backdrop melts into the navy and only the plane shows.
const unsplash = (id: string, w = 1200) => ({ uri: `https://images.unsplash.com/${id}?w=${w}&q=75&auto=format` });
const AVIATION: Record<PhotoSlot, ImageSourcePropType | null> = {
  welcome: unsplash('photo-1779360331736-adb9971f5704'), // WWI RAF biplane with roundels
  header: unsplash('photo-1779360331736-adb9971f5704', 800), // the same RAF biplane: its dark backdrop melts into the navy
  project: unsplash('photo-1779366487175-826510107e54'), // the Wright Flyer
  celebrate: unsplash('photo-1779360331736-adb9971f5704', 800),
};

export const PHOTOS = isAviation ? AVIATION : MOMENTUM;
