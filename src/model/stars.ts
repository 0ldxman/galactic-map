import { StarType, StarBody, System } from './types';

export interface StarSize {
  id: string;
  label: string;
  /** radius multiplier applied to the base star-dot radius */
  mult: number;
}

// Real-ish size classes, smallest to largest.
export const STAR_SIZES: StarSize[] = [
  { id: 'dwarf', label: 'Dwarf', mult: 0.68 },
  { id: 'main', label: 'Main sequence', mult: 1.0 },
  { id: 'giant', label: 'Giant', mult: 1.55 },
  { id: 'supergiant', label: 'Supergiant', mult: 2.3 },
];
export const STAR_SIZE_BY_ID: Record<string, StarSize> = Object.fromEntries(
  STAR_SIZES.map((s) => [s.id, s])
);

// Types a random star may take (no black holes in ordinary clusters).
const BODY_TYPES: StarType[] = ['yellow', 'red', 'blue', 'white', 'neutron'];
const BODY_TYPE_W = [30, 34, 12, 14, 6];
const SIZE_IDS = ['dwarf', 'main', 'giant', 'supergiant'];
const SIZE_W = [34, 40, 18, 8];
const COUNT_W = [60, 27, 9, 4]; // weights for 1..4 stars

type Rand = () => number;

function wpick<T>(rand: Rand, arr: readonly T[], w: readonly number[]): T {
  let total = 0;
  for (const x of w) total += x;
  let r = rand() * total;
  for (let i = 0; i < arr.length; i++) {
    r -= w[i];
    if (r <= 0) return arr[i];
  }
  return arr[arr.length - 1];
}

/** A single random star (optionally forcing its spectral type). */
export function makeStarBody(rand: Rand, type?: StarType): StarBody {
  return {
    type: type ?? wpick(rand, BODY_TYPES, BODY_TYPE_W),
    size: wpick(rand, SIZE_IDS, SIZE_W),
    jx: (rand() - 0.5) * 2.8,
    jy: (rand() - 0.5) * 2.8,
  };
}

/** A random 1–4 star cluster with mixed types & sizes. */
export function makeStarCluster(rand: Rand): StarBody[] {
  const n = wpick(rand, [1, 2, 3, 4], COUNT_W);
  const out: StarBody[] = [];
  for (let i = 0; i < n; i++) out.push(makeStarBody(rand));
  return out;
}

/** Normalise a system's stars into StarBody[] (handles legacy / empty data). */
export function normalizeStars(s: System): StarBody[] {
  const raw = s.stars as unknown;
  if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === 'object') {
    return raw as StarBody[];
  }
  const n = typeof raw === 'number' ? Math.min(4, Math.max(1, raw)) : 1;
  const out: StarBody[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ type: s.starType, size: 'main', jx: 0, jy: 0 });
  }
  return out;
}

/**
 * Base (pre-jitter) layout position for star `i` of `n`, in spread units. It's
 * the tidy "dice" arrangement; the per-star jitter is what breaks the symmetry.
 */
export function starBaseOffset(i: number, n: number): [number, number] {
  if (n <= 1) return [0, 0];
  if (n === 2) return i === 0 ? [-1, 0] : [1, 0];
  if (n === 3) {
    return ([[0, -1], [-1, 0.8], [1, 0.8]] as [number, number][])[i];
  }
  return ([[-1, -1], [1, -1], [-1, 1], [1, 1]] as [number, number][])[i];
}
