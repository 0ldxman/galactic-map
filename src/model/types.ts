import { DisplaySettings, DEFAULT_DISPLAY } from './display';

export type ID = string;

export interface Point {
  x: number;
  y: number;
}

export type StarType =
  | 'yellow'
  | 'red'
  | 'blue'
  | 'white'
  | 'neutron'
  | 'blackhole';

/** One star within a system: its own spectral type, size class and jitter. */
export interface StarBody {
  type: StarType;
  /** star-size id (see model/stars.ts: dwarf / main / giant / supergiant) */
  size: string;
  /** small per-star position jitter in screen px, for an organic cluster */
  jx: number;
  jy: number;
}

/** How firmly an empire holds a system; drives the territory fill pattern. */
export type OwnStatus =
  | 'core'
  | 'claimed'
  | 'occupied'
  | 'contested'
  | 'demilitarized';

/**
 * A body inside a system. Not drawn on the galaxy map — the System View overlay
 * (Phase E) is where these live. Declared now so the map format is bumped once.
 */
export interface Planet {
  id: ID;
  name: string;
  type: string;
  /** relative size, 1 = earth-ish */
  size: number;
  /** orbit index, 0 = innermost */
  orbit: number;
  habitable?: boolean;
  ownerId?: ID | null;
  notes?: string;
  /** seed for the future planet-surface generator */
  mapSeed?: number;
}

export interface System {
  id: ID;
  name: string;
  x: number;
  y: number;
  /** Representative type (mirrors stars[0].type); kept for quick colouring. */
  starType: StarType;
  ownerId: ID | null;
  /** Radius of political influence (world units) used for territory blobs. */
  influence: number;
  /** Marker/annotation ids (see model/markers.ts). A system may have many. */
  markers?: string[];
  /** The stars in the system, 1–4, each with its own type & size. */
  stars?: StarBody[];
  /** Hold status; absent means 'core'. */
  status?: OwnStatus;
  /** Free-form markdown lore. */
  notes?: string;
  /** Planets & other bodies (System View, Phase E). */
  bodies?: Planet[];
}

export interface Hyperlane {
  id: ID;
  a: ID;
  b: ID;
}

export interface Empire {
  id: ID;
  name: string;
  color: string; // hex, e.g. "#e0483d" — territory fill
  /** Border colour; when absent it is derived from `color` (lightened). */
  borderColor?: string;
  capitalId: ID | null;
  /** Free-form markdown lore. */
  notes?: string;
}

/**
 * A gas cloud, painted rather than drawn: the author dabs overlapping circles
 * with a brush and the renderer melts them together into one soft cloud.
 */
export interface Nebula {
  id: ID;
  name: string;
  color: string;
  /** overall opacity of the cloud, 0..1 */
  opacity: number;
  blobs: { x: number; y: number; r: number }[];
  showName: boolean;
  notes?: string;
}

/** A named area of the galaxy — a sector, cluster or reach. Just a label. */
export interface MapRegion {
  id: ID;
  name: string;
  x: number;
  y: number;
  /** label height in world units */
  size: number;
  color?: string;
  /** extra letter spacing as a fraction of the font size */
  spacing?: number;
  notes?: string;
}

export type ObjectKind =
  | 'wormhole'
  | 'gateway'
  | 'lgate'
  | 'debris'
  | 'anomaly'
  | 'derelict'
  | 'station';

/**
 * A thing on the map, as opposed to a marker (which is a tag on a system).
 * Objects have their own position, can be pinned to a system, and can be
 * linked in pairs — that is what wormholes and gateways need.
 */
export interface SpaceObject {
  id: ID;
  kind: ObjectKind;
  name: string;
  x: number;
  y: number;
  /** when set, the object is pinned near that system */
  systemId?: ID | null;
  /** the other end of a wormhole / gate pair */
  linkedId?: ID | null;
  color?: string;
  notes?: string;
}

export type AnnotationKind = 'text' | 'arrow' | 'line' | 'polygon' | 'ellipse';

/** Free-hand map furniture: labels, arrows, front lines, claimed areas. */
export interface Annotation {
  id: ID;
  kind: AnnotationKind;
  /** text: 1 point · line/arrow/ellipse: 2 · polygon: 3+ */
  points: Point[];
  text?: string;
  color: string;
  /** stroke width in screen px */
  width: number;
  dashed?: boolean;
  /** text height in world units (text annotations only) */
  fontSize?: number;
  /** whether it draws over the systems or under the territories */
  layer: 'above' | 'below';
  filled?: boolean;
}

export interface GalaxyMap {
  version: number;
  seed: number;
  systems: Record<ID, System>;
  hyperlanes: Record<ID, Hyperlane>;
  empires: Record<ID, Empire>;
  /** Look of this map; missing keys fall back to DEFAULT_DISPLAY. */
  display?: DisplaySettings;
  nebulae: Record<ID, Nebula>;
  regions: Record<ID, MapRegion>;
  objects: Record<ID, SpaceObject>;
  annotations: Record<ID, Annotation>;
}

export const MAP_VERSION = 2;

export function emptyMap(seed = 0): GalaxyMap {
  return {
    version: MAP_VERSION,
    seed,
    systems: {},
    hyperlanes: {},
    empires: {},
    display: DEFAULT_DISPLAY,
    nebulae: {},
    regions: {},
    objects: {},
    annotations: {},
  };
}

export const STAR_COLORS: Record<StarType, string> = {
  yellow: '#ffe9a8',
  red: '#ff9b6b',
  blue: '#a8c6ff',
  white: '#f4f6ff',
  neutron: '#d6f0ff',
  blackhole: '#2a2140',
};
