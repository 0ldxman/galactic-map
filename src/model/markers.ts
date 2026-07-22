import { ObjectKind } from './types';

/**
 * System markers — small icons a system can be tagged with to denote points of
 * interest (stations, anomalies, gates, …), Stellaris-style. A system may carry
 * any number of them; they are stored on `System.markers` as a list of these ids.
 *
 * Glyphs are deliberately monochrome Unicode symbols (not colour emoji) so they
 * take the marker's colour when drawn on the canvas. A marker may instead name
 * an `icon`, in which case the badge is drawn with the same vector primitive the
 * matching special object uses — which keeps gates recognisable and crisp at any
 * zoom, including in a 16K export.
 */
export interface MarkerType {
  id: string;
  label: string;
  glyph: string;
  color: string;
  /** draw this vector icon instead of the glyph (see render/icons.ts) */
  icon?: ObjectKind;
}

export const MARKER_TYPES: MarkerType[] = [
  { id: 'station', label: 'Station', glyph: '⬢', color: '#8fd4ff' },
  { id: 'shipyard', label: 'Shipyard', glyph: '✦', color: '#c7b6ff' },
  { id: 'fleet', label: 'Fleet', glyph: '▲', color: '#ff9a7a' },
  { id: 'research', label: 'Research', glyph: '✚', color: '#6fe3c2' },
  { id: 'mining', label: 'Mining', glyph: '◆', color: '#ffd27a' },
  { id: 'trade', label: 'Trade hub', glyph: '★', color: '#ffe27a' },
  { id: 'relic', label: 'Relic / anomaly', glyph: '❂', color: '#e78bff' },
  { id: 'wormhole', label: 'Wormhole', glyph: '◍', color: '#b58cff', icon: 'wormhole' },
  { id: 'gateway', label: 'Gateway', glyph: '◎', color: '#7ad6ff', icon: 'gateway' },
  { id: 'lgate', label: 'L-Gate', glyph: '⬡', color: '#ff8ad0', icon: 'lgate' },
  { id: 'hazard', label: 'Hazard', glyph: '⬟', color: '#ff6b6b' },
];

/**
 * Retired marker ids. They are still resolvable so maps made before the gate
 * markers were split into three keep drawing what their author placed; they
 * just aren't offered in the picker any more.
 */
const LEGACY_MARKERS: MarkerType[] = [
  { id: 'gate', label: 'Gate / wormhole', glyph: '◎', color: '#7ab8ff', icon: 'gateway' },
];

export const MARKER_BY_ID: Record<string, MarkerType> = Object.fromEntries(
  [...MARKER_TYPES, ...LEGACY_MARKERS].map((m) => [m.id, m])
);
