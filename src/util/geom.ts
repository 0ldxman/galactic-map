import { Point } from '../model/types';

/** Ray-casting point-in-polygon test. Points are in the same space as `poly`. */
export function pointInPolygon(x: number, y: number, poly: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (
      a.y > y !== b.y > y &&
      x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y || 1e-12) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function polygonBounds(poly: readonly Point[]): Bounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Area centroid of a polygon — where a label wants to sit. Degenerate rings
 * (zero area, fewer than three points) fall back to the average vertex.
 */
export function polygonCentroid(poly: readonly Point[]): Point {
  const n = poly.length;
  if (n === 0) return { x: 0, y: 0 };
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const cross = poly[j].x * poly[i].y - poly[i].x * poly[j].y;
    a += cross;
    cx += (poly[j].x + poly[i].x) * cross;
    cy += (poly[j].y + poly[i].y) * cross;
  }
  if (Math.abs(a) < 1e-9) {
    let sx = 0, sy = 0;
    for (const p of poly) { sx += p.x; sy += p.y; }
    return { x: sx / n, y: sy / n };
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

/**
 * Drop points closer together than `tol` — a freehand drag produces one point
 * per pointer event, far more than the shape needs.
 */
export function thinPath(pts: readonly Point[], tol: number): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= tol) out.push(p);
  }
  if (out.length < 3 && pts.length >= 3) return [...pts];
  return out;
}
