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

  /** zoom level at which system name cards start to appear */
  systemNameZoom: number;
  /** multiplier on the empire-label size derived from territory area */
  empireNameScale: number;
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

  systemNameZoom: 1.3,
  empireNameScale: 1,
};

/** Fill in any missing keys (older maps predate some settings). */
export function resolveDisplay(d?: Partial<DisplaySettings>): DisplaySettings {
  return d ? { ...DEFAULT_DISPLAY, ...d } : DEFAULT_DISPLAY;
}
