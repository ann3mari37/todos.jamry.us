import type { ImageSourcePropType } from 'react-native';

// Photography slots from the design. A slot set to null falls back to the vector <Flower />.
// Images are transparent cut-outs so they sit on the app's pink backgrounds like the mockup.
//
// welcome   — large flower with stem filling the top of the welcome screen
// header    — top-right accent on Today, partly off-screen
// project   — cropped off the right edge of a project's banner
// celebrate — large flower on the "You did it!" screen
export type PhotoSlot = 'welcome' | 'header' | 'project' | 'celebrate';

export const PHOTOS: Record<PhotoSlot, ImageSourcePropType | null> = {
  welcome: require('../../assets/images/gerbera-stem.png'),
  header: require('../../assets/images/gerbera-top.png'),
  project: require('../../assets/images/gerbera-top.png'),
  celebrate: require('../../assets/images/gerbera-top.png'),
};
