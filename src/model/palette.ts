/** Starting colours handed out to new empires, in order. */
export const EMPIRE_PALETTE = [
  '#e0483d', '#3d8ee0', '#49c26b', '#e0b23d', '#a34fe0',
  '#e0733d', '#3dd6c2', '#e03d94', '#7ac23d', '#5a5fe0',
];

/** Starting colours for new nebulae — deeper, so gas reads as gas. */
export const NEBULA_PALETTE = [
  '#7a4bd6', '#c2416b', '#2f8fb8', '#b8632f', '#3fa06a',
  '#8f3fa0', '#3f5fa0', '#a0863f',
];

/** Starting colours for new sectors — pale, so they read as chart notation. */
export const SECTOR_PALETTE = [
  '#c9d6f2', '#8fd4ff', '#a8f0b8', '#ffe08f', '#cfa8ff',
  '#ffa8d8', '#8fe6d8', '#ffc08f',
];

/**
 * The swatches offered by the colour picker. Four rows that walk the hue
 * circle at three brightnesses, plus a neutral row — enough to pick a
 * distinguishable colour for a dozen empires without opening the OS dialog.
 */
export const SWATCHES = [
  '#e0483d', '#e0733d', '#e0b23d', '#c2c23d', '#7ac23d', '#49c26b',
  '#3dc2a5', '#3dd6c2', '#3d8ee0', '#5a5fe0', '#a34fe0', '#e03d94',
  '#8f2b23', '#8f4a23', '#8f7023', '#6f8f23', '#3d7a2b', '#237a45',
  '#1f6b7a', '#23628f', '#2b3a8f', '#5f2b8f', '#8f2360', '#7a2340',
  '#ff9a8f', '#ffc08f', '#ffe08f', '#dfff8f', '#a8f0b8', '#8fe6d8',
  '#8fd4ff', '#a8b4ff', '#cfa8ff', '#ffa8d8', '#ffffff', '#c9d6f2',
  '#8b92ad', '#5a6078', '#343a52', '#1a1d30', '#0a0a14', '#000000',
];
