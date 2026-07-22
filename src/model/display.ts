/**
 * Per-map display settings. They live inside the map (so a saved / published map
 * carries the look its author chose) and are edited from the Display panel.
 */
export interface DisplaySettings {
  /** territory outline width in screen px (constant at any zoom) */
  borderWidth: number;
  /** territory outline opacity, 0..1 */
  borderAlpha: number;
  /** territory fill opacity, 0..1 */
  fillAlpha: number;

  showGrid: boolean;
  showHyperlanes: boolean;
  showTerritories: boolean;
  showStarGlow: boolean;
  showBgStars: boolean;
  showVignette: boolean;

  showSystemNames: boolean;
  showEmpireNames: boolean;
  showMarkers: boolean;

  showNebulae: boolean;
  showRegions: boolean;
  showObjects: boolean;
  showAnnotations: boolean;

  /** zoom level at which system name cards start to appear */
  systemNameZoom: number;
  /** multiplier on the empire-label size derived from territory area */
  empireNameScale: number;

  /**
   * Unclaimed systems project influence of their own, so a neighbouring empire
   * stops halfway instead of swallowing them. Their own borders are never
   * drawn — they exist only to hold the space open.
   */
  neutralBorders: boolean;

  /** global multiplier on every cloud's filament strength */
  nebulaTexture: number;
  /** resolution of the baked nebula texture (higher = finer, slower) */
  nebulaDetail: number;
  /** brightness of the gas */
  nebulaBrightness: number;
}

export const DEFAULT_DISPLAY: DisplaySettings = {
  borderWidth: 2,
  borderAlpha: 0.95,
  fillAlpha: 0.12,

  showGrid: true,
  showHyperlanes: true,
  showTerritories: true,
  showStarGlow: true,
  showBgStars: true,
  showVignette: true,

  showSystemNames: true,
  showEmpireNames: true,
  showMarkers: true,

  showNebulae: true,
  showRegions: true,
  showObjects: true,
  showAnnotations: true,

  systemNameZoom: 1.3,
  empireNameScale: 1,

  neutralBorders: true,

  nebulaTexture: 1,
  nebulaDetail: 1,
  nebulaBrightness: 1,
};

let memoIn: Partial<DisplaySettings> | undefined;
let memoOut: DisplaySettings = DEFAULT_DISPLAY;

/**
 * Fill in any missing keys (older maps predate some settings).
 *
 * The result is memoised on the input reference, so calling this every frame
 * returns the *same* object until the settings actually change. Renderers rely
 * on that: they decide whether to rebuild expensive caches by comparing
 * references, and a fresh object each frame would defeat them.
 */
export function resolveDisplay(d?: Partial<DisplaySettings>): DisplaySettings {
  if (!d) return DEFAULT_DISPLAY;
  if (d === memoIn) return memoOut;
  memoIn = d;
  memoOut = { ...DEFAULT_DISPLAY, ...d };
  return memoOut;
}
