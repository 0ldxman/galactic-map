import { Rng } from '../util/rng';

export interface Point {
  x: number;
  y: number;
}

/**
 * Bridson-style Poisson-disk sampling inside a square of half-size `radius`,
 * centred on the origin. Each candidate is additionally accepted with a
 * probability given by `accept(x, y)` so the point cloud follows the galaxy
 * shape. Sampling stops once `limit` points are produced.
 */
export function poissonDisk(
  radius: number,
  minDist: number,
  accept: (x: number, y: number) => number,
  rng: Rng,
  limit: number
): Point[] {
  const cell = minDist / Math.SQRT2;
  const gridSize = Math.ceil((2 * radius) / cell);
  const grid: (Point | null)[] = new Array(gridSize * gridSize).fill(null);
  const toGrid = (v: number) => Math.floor((v + radius) / cell);
  const gridIndex = (gx: number, gy: number) => gy * gridSize + gx;

  const points: Point[] = [];
  const active: Point[] = [];

  const insert = (pt: Point) => {
    points.push(pt);
    active.push(pt);
    grid[gridIndex(toGrid(pt.x), toGrid(pt.y))] = pt;
  };

  const fits = (x: number, y: number) => {
    if (x < -radius || x > radius || y < -radius || y > radius) return false;
    const gx = toGrid(x);
    const gy = toGrid(y);
    for (let iy = Math.max(0, gy - 2); iy <= Math.min(gridSize - 1, gy + 2); iy++) {
      for (let ix = Math.max(0, gx - 2); ix <= Math.min(gridSize - 1, gx + 2); ix++) {
        const other = grid[gridIndex(ix, iy)];
        if (other && Math.hypot(other.x - x, other.y - y) < minDist) return false;
      }
    }
    return true;
  };

  // Seed with several accepted points scattered across the disc. Seeding a
  // single central point would fail for shapes with a hollow core (the galactic
  // gap / ring), where the centre has zero density and sampling would die out.
  let seeds = 0;
  for (let tries = 0; tries < 5000 && seeds < 40; tries++) {
    const x = rng.range(-radius, radius);
    const y = rng.range(-radius, radius);
    if (rng.float() > accept(x, y)) continue;
    if (!fits(x, y)) continue;
    insert({ x, y });
    seeds++;
  }
  if (points.length === 0) insert({ x: 0, y: 0 });

  const k = 25; // candidates per active point
  while (active.length > 0 && points.length < limit) {
    const idx = rng.int(0, active.length - 1);
    const origin = active[idx];
    let placed = false;
    for (let i = 0; i < k; i++) {
      const ang = rng.range(0, Math.PI * 2);
      const r = rng.range(minDist, 2 * minDist);
      const x = origin.x + Math.cos(ang) * r;
      const y = origin.y + Math.sin(ang) * r;
      if (!fits(x, y)) continue;
      if (rng.float() > accept(x, y)) continue;
      insert({ x, y });
      placed = true;
      break;
    }
    if (!placed) active.splice(idx, 1);
  }

  return points;
}
