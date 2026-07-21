export type ID = string;

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
}

export interface Hyperlane {
  id: ID;
  a: ID;
  b: ID;
}

export interface Empire {
  id: ID;
  name: string;
  color: string; // hex, e.g. "#e0483d"
  capitalId: ID | null;
}

export interface GalaxyMap {
  version: number;
  seed: number;
  systems: Record<ID, System>;
  hyperlanes: Record<ID, Hyperlane>;
  empires: Record<ID, Empire>;
}

export const MAP_VERSION = 1;

export function emptyMap(seed = 0): GalaxyMap {
  return {
    version: MAP_VERSION,
    seed,
    systems: {},
    hyperlanes: {},
    empires: {},
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
