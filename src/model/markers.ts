/**
 * System markers — small icons a system can be tagged with to denote points of
 * interest (stations, anomalies, resources, …), Stellaris-style. A system may
 * carry any number of them; they are stored on `System.markers` as a list of
 * these ids.
 *
 * Glyphs are deliberately monochrome Unicode symbols (not colour emoji) so they
 * take the marker's colour when drawn on the canvas.
 */
export interface MarkerType {
  id: string;
  label: string;
  glyph: string;
  color: string;
}

export const MARKER_TYPES: MarkerType[] = [
  { id: 'station', label: 'Station', glyph: '⬢', color: '#8fd4ff' },
  { id: 'shipyard', label: 'Shipyard', glyph: '✦', color: '#c7b6ff' },
  { id: 'fleet', label: 'Fleet', glyph: '▲', color: '#ff9a7a' },
  { id: 'research', label: 'Research', glyph: '✚', color: '#6fe3c2' },
  { id: 'mining', label: 'Mining', glyph: '◆', color: '#ffd27a' },
  { id: 'trade', label: 'Trade hub', glyph: '★', color: '#ffe27a' },
  { id: 'relic', label: 'Relic / anomaly', glyph: '❂', color: '#e78bff' },
  { id: 'gate', label: 'Gate / wormhole', glyph: '◎', color: '#7ab8ff' },
  { id: 'hazard', label: 'Hazard', glyph: '⬟', color: '#ff6b6b' },
];

export const MARKER_BY_ID: Record<string, MarkerType> = Object.fromEntries(
  MARKER_TYPES.map((m) => [m.id, m])
);
