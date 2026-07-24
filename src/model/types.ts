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
  /** Sectors this system belongs to. A system may be in several. */
  sectors?: ID[];
  /** The stars in the system, 1–4, each with its own type & size. */
  stars?: StarBody[];
  /** Hold status; absent means 'core'. */
  status?: OwnStatus;
  /**
   * Who is sitting on it. Only meaningful for a status that implies someone
   * else is present (occupied / contested): the territory keeps the owner's
   * fill and border, and the hatch over it takes the occupier's colour, which
   * is how a map shows "theirs, but held by them".
   */
  occupierId?: ID | null;
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
  /** label height in world units; absent = derived from the cloud's size */
  nameSize?: number;
  /** label colour; absent = the cloud's own colour */
  nameColor?: string;
  /** extra letter spacing as a fraction of the font size */
  nameSpacing?: number;
  /** how filamentary the gas is: 0 = smooth haze, 1 = torn and stringy */
  texture?: number;
  /** size of the largest noise features, in world units */
  detail?: number;
  /** noise seed, so two clouds never share the same pattern */
  seed?: number;
}

/**
 * A sector: a named grouping of systems.
 *
 * Membership lives on the systems (`System.sectors`), exactly as empire
 * ownership does — you assign systems to a sector rather than drawing an
 * outline around them. The boundary the map draws is *derived* from whichever
 * systems currently belong, so it follows them when they move and never has to
 * be re-drawn by hand.
 *
 * Two consequences the earlier drawn-shape version could not have:
 *  - a system can belong to several sectors at once (overlapping groupings —
 *    a trade league across an empire border, say);
 *  - sectors nest. A child's systems count as the parent's too, so "Outer Rim"
 *    encloses the sectors inside it without listing their systems again.
 *
 * A sector with no members is just a wide label sitting at (x, y) — which is
 * what every region on a map made before this was.
 */
export interface MapRegion {
  id: ID;
  name: string;
  /**
   * Where the label goes when the sector has no members, and the fallback
   * anchor generally. With members, the label follows their centre of mass.
   */
  x: number;
  y: number;
  /** label height in world units; also scaled by the derived area */
  size: number;
  color?: string;
  /** extra letter spacing as a fraction of the font size */
  spacing?: number;
  notes?: string;
  /** parent sector, for nesting. Cycles are refused when it is set. */
  parentId?: ID | null;
  /** wash inside the boundary; 0 or `showFill: false` leaves the outline alone */
  fillAlpha?: number;
  showFill?: boolean;
  /** draw the name (default true) */
  showName?: boolean;
  /**
   * Legacy hand-drawn boundary, from before sectors were membership-based.
   * Nothing writes it any more; `migrate` turns one into members where it can.
   */
  shape?: Point[];
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

/**
 * A picture pinned to the map to trace over — a screenshot of the galaxy from
 * the game, a hand-drawn sketch, an old export. Scaffolding, not content: it is
 * drawn only while editing, never for a guest reading the published map, and
 * only goes into an exported image if you ask for it.
 *
 * The bitmap travels inside the map as a data URI so it survives a reload,
 * reaches co-editors and rides along in the JSON export with no extra
 * plumbing. That is only affordable because the importer downscales and
 * re-encodes first — see persistence/images.ts.
 */
export interface RefImage {
  id: ID;
  name: string;
  /** the picture itself, as a data URI */
  src: string;
  /** top-left corner, world coordinates */
  x: number;
  y: number;
  /** size in world units (the aspect ratio is the author's to break) */
  w: number;
  h: number;
  opacity: number;
  /** pinned down: not pickable on the canvas, so you can draw over it freely */
  locked?: boolean;
  /** under the whole map, or over the territories but under the stars */
  layer?: 'below' | 'above';
  /** include it in a PNG export (off by default) */
  exported?: boolean;
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
  /** Tracing references. Absent on maps made before v3. */
  references: Record<ID, RefImage>;
}

export const MAP_VERSION = 4;

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
    references: {},
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
