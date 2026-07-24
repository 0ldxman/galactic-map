import { StarType, StarBody, System } from './types';

export interface StarSize {
  id: string;
  label: string;
  /** radius multiplier applied to the base star-dot radius */
  mult: number;
}

// Real-ish size classes, smallest to largest. Kept in a fairly tight range so
// even a supergiant stays a modest dot (stars are a constant on-screen size, so
// an absolutely-large dot would dominate the view when zoomed out).
export const STAR_SIZES: StarSize[] = [
  { id: 'dwarf', label: 'Dwarf', mult: 0.72 },
  { id: 'main', label: 'Main sequence', mult: 1.0 },
  { id: 'giant', label: 'Giant', mult: 1.3 },
  { id: 'supergiant', label: 'Supergiant', mult: 1.7 },
];

/**
 * Size labels for a black hole. Same ids and multipliers as the star sizes —
 * a black hole is drawn by the same layout code and needs a size class like
 * anything else — but "Main sequence" is nonsense for one, so the picker uses
 * these names when the body is a black hole.
 */
export const HOLE_SIZE_LABELS: Record<string, string> = {
  dwarf: 'Stellar-mass',
  main: 'Intermediate',
  giant: 'Supermassive',
  supergiant: 'Ultramassive',
};

export function sizeLabel(type: StarType, sizeId: string): string {
  if (type === 'blackhole') return HOLE_SIZE_LABELS[sizeId] ?? sizeId;
  return STAR_SIZE_BY_ID[sizeId]?.label ?? sizeId;
}
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

/**
 * A single random star (optionally forcing its spectral type). `jx`/`jy` are a
 * normalised jitter in roughly [-0.5, 0.5]; the renderer scales them by the
 * cluster's spread (which itself grows with the biggest star present), so the
 * jitter stays proportional and big stars never sit on top of small ones.
 */
export function makeStarBody(rand: Rand, type?: StarType): StarBody {
  return {
    type: type ?? wpick(rand, BODY_TYPES, BODY_TYPE_W),
    size: wpick(rand, SIZE_IDS, SIZE_W),
    jx: rand() - 0.5,
    jy: rand() - 0.5,
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
