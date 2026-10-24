// Design tokens taken from the Momentum mockup: warm cream, gerbera pink, soft teal.

export const colors = {
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
} as const;

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
  shadowColor: '#C9A49B',
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
} as const;

export const AREA_COLORS = ['#F07A8C', '#3FA7A3', '#7DB46C', '#F2B84B', '#F59A6B', '#A98BDB', '#9CA3AF', '#6C9BD2'];
