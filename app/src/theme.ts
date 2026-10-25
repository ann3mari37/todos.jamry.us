// Design tokens. One codebase, one look per site:
//   momentum — warm cream, gerbera pink, soft teal (the Momentum mockup; dashboard.malindaperryconsulting.com)
//   aviation — deep navies, brass and steel, with classic-aircraft photography (todos.jamry.us)
// The token names come from the Momentum design; in the aviation look `pink*` is the navy accent.

export type Site = 'momentum' | 'aviation';

/** Which look this copy of the app uses: picked from the web address, or ?theme=aviation / ?theme=momentum to preview. */
function detectSite(): Site {
  if (typeof window === 'undefined' || !window.location) return 'momentum';
  try {
    const asked = new URLSearchParams(window.location.search).get('theme');
    if (asked === 'aviation' || asked === 'momentum') window.localStorage?.setItem('momentum.theme', asked);
    const saved = window.localStorage?.getItem('momentum.theme');
    if (saved === 'aviation' || saved === 'momentum') return saved;
  } catch { /* storage blocked: fall through to the address */ }
  return /(^|\.)jamry\.us$/i.test(window.location.hostname) ? 'aviation' : 'momentum';
}

export const SITE: Site = detectSite();
export const isAviation = SITE === 'aviation';

const MOMENTUM = {
  bg: '#FBF3EF',
  bgDeep: '#F6E7E1',
  card: '#FFFFFF',
  cardSoft: '#FFF8F6',
  border: '#F1E3DE',
  text: '#2B2730',
  textMuted: '#6E6670',
  textFaint: '#A39AA2',
  pink: '#EE6B85',
  pinkDeep: '#E0566F',
  pinkSoft: '#FCDDE2',
  pinkWash: '#FDEDEF',
  teal: '#47A9A6',
  tealSoft: '#DDF0EE',
  amber: '#F2B84B',
  amberSoft: '#FDF0D5',
  green: '#86B868',
  greenSoft: '#E6F2DD',
  lavender: '#A98BDB',
  lavenderSoft: '#EEE7FA',
  coral: '#F59A6B',
  track: '#EFE6E3',
  white: '#FFFFFF',
  // Hero areas (welcome screen, banners): soft blush washes.
  hero: '#F8DCDC',
  heroTop: '#FBE6E4',
  heroBottom: '#F3C9CC',
  heroText: '#2B2730',
  heroMuted: '#6E6670',
  bannerFrom: '#E9D4CF',
  bannerTo: '#FDEDEF',
};

const AVIATION: typeof MOMENTUM = {
  bg: '#F2F4F7',
  bgDeep: '#E4E9F0',
  card: '#FFFFFF',
  cardSoft: '#F7F9FB',
  border: '#DCE2EA',
  text: '#0E1A2B',
  textMuted: '#4F5D70',
  textFaint: '#8C98A8',
  pink: '#1C3557', // navy: buttons, links, active tabs
  pinkDeep: '#0F2340', // darker navy
  pinkSoft: '#D3DCE8',
  pinkWash: '#E8EDF4',
  teal: '#2E6077', // steel blue
  tealSoft: '#DCE7ED',
  amber: '#A67C2E', // brass
  amberSoft: '#F1E8D6',
  green: '#4E6E52', // olive drab
  greenSoft: '#E0E9E1',
  lavender: '#55627E', // slate
  lavenderSoft: '#E1E5EE',
  coral: '#9B4F36', // rust
  track: '#E1E6ED',
  white: '#FFFFFF',
  // Hero areas: night-sky navy, matching the museum photographs' dark backdrops.
  hero: '#0B1626',
  heroTop: '#13253F',
  heroBottom: '#070F1B',
  heroText: '#F3F1EA',
  heroMuted: '#A9B4C4',
  bannerFrom: '#0A1322',
  bannerTo: '#1A3050',
};

export const colors = isAviation ? AVIATION : MOMENTUM;

export const fonts = {
  serif: 'PlayfairDisplay_600SemiBold',
  serifBold: 'PlayfairDisplay_700Bold',
  body: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
} as const;

export const radius = { sm: 10, md: 16, lg: 22, pill: 999 } as const;
export const space = (n: number) => n * 4;

export const shadow = {
  shadowColor: isAviation ? '#6E7F96' : '#C9A49B',
  shadowOpacity: 0.14,
  shadowRadius: 14,
  shadowOffset: { width: 0, height: 4 },
  elevation: 2,
} as const;

export const KIND_STYLE = {
  meaningful_move: { color: colors.pink, soft: colors.pinkSoft, icon: 'heart' },
  time_sensitive: { color: colors.amber, soft: colors.amberSoft, icon: 'calendar' },
  easy_momentum: { color: colors.green, soft: colors.greenSoft, icon: 'feather' },
  quietly_waiting: { color: colors.lavender, soft: colors.lavenderSoft, icon: 'rotate-cw' },
  next_up: { color: colors.teal, soft: colors.tealSoft, icon: 'arrow-right-circle' },
} as const;

export const AREA_COLORS = isAviation
  ? ['#1C3557', '#2E6077', '#4E6E52', '#A67C2E', '#9B4F36', '#55627E', '#7A8494', '#3B5A80']
  : ['#F07A8C', '#3FA7A3', '#7DB46C', '#F2B84B', '#F59A6B', '#A98BDB', '#9CA3AF', '#6C9BD2'];
