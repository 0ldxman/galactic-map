import { Point } from '../model/types';
import { pointInPolygon, polygonBounds } from './geom';

/**
 * Boolean operations on map areas, done by rasterising.
 *
 * A proper polygon clipper (Greiner–Hormann and friends) is a lot of code whose
 * failure modes are exactly the cases a hand-drawn lasso produces: coincident
 * edges, self-intersections, degenerate slivers. What these shapes actually
 * need is much weaker — a sector boundary is a drawing, not a survey — so the
 * operation is done on a grid and the result traced back into smooth rings.
 * That is robust for any input, at the cost of a boundary quantised to a cell.
 *
 * The tracing (marching squares → corner simplify → Chaikin) is the same
 * approach the territory borders use, which is why the results look alike.
 */

/** Cells across the longer side of the working area. */
const GRID = 560;

export type Rings = Point[][];

/** True when the point is inside an even-odd ring set (an odd crossing count). */
export function pointInRings(x: number, y: number, rings: Rings): boolean {
  let inside = false;
  for (const r of rings) if (pointInPolygon(x, y, r)) inside = !inside;
  return inside;
}

export function ringsBounds(rings: Rings) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rings) {
    const b = polygonBounds(r);
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }
  return { minX, minY, maxX, maxY };
}

/** Signed area × 2 of a ring; the sign tells the winding. */
export function ringArea(r: readonly Point[]): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    a += r[j].x * r[i].y - r[i].x * r[j].y;
  }
  return a / 2;
}

/** Total enclosed area of an even-odd ring set (holes subtract). */
export function ringsArea(rings: Rings): number {
  let total = 0;
  for (const r of rings) total += Math.abs(ringArea(r));
  return total;
}

/** Area centroid of a ring set — where a label wants to sit. */
export function ringsCentroid(rings: Rings): Point {
  let a = 0, cx = 0, cy = 0;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const cross = ring[j].x * ring[i].y - ring[i].x * ring[j].y;
      a += cross;
      cx += (ring[j].x + ring[i].x) * cross;
      cy += (ring[j].y + ring[i].y) * cross;
    }
  }
  if (Math.abs(a) < 1e-9) {
    let n = 0, sx = 0, sy = 0;
    for (const r of rings) for (const p of r) { sx += p.x; sy += p.y; n++; }
    return n ? { x: sx / n, y: sy / n } : { x: 0, y: 0 };
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

export type BoolOp = 'union' | 'subtract' | 'intersect';

/**
 * Combine two areas. Returns the resulting rings, which may be more than one
 * (islands) or contain holes; an empty array means nothing is left.
 */
export function combineRings(a: Rings, b: Rings, op: BoolOp): Rings {
  if (a.length === 0) return op === 'union' ? clone(b) : [];
  if (b.length === 0) return op === 'intersect' ? [] : clone(a);

  // Work over whatever the result could possibly cover, padded by a cell so a
  // shape touching the edge still gets a boundary traced around it.
  const ba = ringsBounds(a);
  const bb = ringsBounds(b);
  const box =
    op === 'union'
      ? {
          minX: Math.min(ba.minX, bb.minX),
          minY: Math.min(ba.minY, bb.minY),
          maxX: Math.max(ba.maxX, bb.maxX),
          maxY: Math.max(ba.maxY, bb.maxY),
        }
      : ba;

  const spanX = box.maxX - box.minX;
  const spanY = box.maxY - box.minY;
  const cell = Math.max(spanX, spanY) / GRID || 1;
  const pad = 2;
  const minX = box.minX - pad * cell;
  const minY = box.minY - pad * cell;
  const w = Math.ceil(spanX / cell) + pad * 2 + 1;
  const h = Math.ceil(spanY / cell) + pad * 2 + 1;

  const mask = new Uint8Array(w * h);
  for (let gy = 0; gy < h; gy++) {
    // Sample at cell centres: a cell is in or out as a whole, which is what
    // makes the trace produce closed loops with no ambiguity.
    const wy = minY + (gy + 0.5) * cell;
    for (let gx = 0; gx < w; gx++) {
      const wx = minX + (gx + 0.5) * cell;
      const inA = pointInRings(wx, wy, a);
      const inB = pointInRings(wx, wy, b);
      const keep =
        op === 'union' ? inA || inB : op === 'subtract' ? inA && !inB : inA && inB;
      if (keep) mask[gy * w + gx] = 1;
    }
  }

  // Anything smaller than this is lasso jitter, not a piece of the sector.
  const minCells = 12;
  return traceMask(mask, w, h, minX, minY, cell, minCells);
}

function clone(rings: Rings): Rings {
  return rings.map((r) => r.map((p) => ({ x: p.x, y: p.y })));
}

/**
 * Trace the boundary of a filled mask into smoothed world-space rings.
 *
 * Walks the unit edges between filled and empty cells into closed directed
 * loops, converts them to world coordinates, collapses the axis-aligned
 * staircase to its corners and rounds those with Chaikin.
 */
export function traceMask(
  mask: Uint8Array,
  w: number,
  h: number,
  minX: number,
  minY: number,
  cell: number,
  minCells = 0
): Rings {
  if (minCells > 0) dropSpecks(mask, w, h, minCells);

  const W1 = w + 1;
  const out = new Map<number, number[]>();
  const add = (ax: number, ay: number, bx: number, by: number) => {
    const s = ay * W1 + ax;
    const arr = out.get(s);
    if (arr) arr.push(by * W1 + bx);
    else out.set(s, [by * W1 + bx]);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      if (y === 0 || !mask[(y - 1) * w + x]) add(x, y, x + 1, y);
      if (x === w - 1 || !mask[y * w + x + 1]) add(x + 1, y, x + 1, y + 1);
      if (y === h - 1 || !mask[(y + 1) * w + x]) add(x + 1, y + 1, x, y + 1);
      if (x === 0 || !mask[y * w + x - 1]) add(x, y + 1, x, y);
    }
  }

  const rings: Rings = [];
  for (const [start, arr] of out) {
    while (arr.length) {
      const loop: number[] = [start];
      let cur = arr.pop()!;
      loop.push(cur);
      let guard = 0;
      while (cur !== start && guard++ < 1_000_000) {
        const next = out.get(cur);
        if (!next || next.length === 0) break;
        cur = next.pop()!;
        loop.push(cur);
      }
      const pts: Point[] = [];
      for (let i = 0; i < loop.length - 1; i++) {
        const v = loop[i];
        pts.push({
          x: minX + (v % W1) * cell,
          y: minY + ((v / W1) | 0) * cell,
        });
      }
      if (pts.length < 3) continue;
      const simple = simplifyClosed(pts);
      rings.push(simple.length >= 4 ? chaikin(chaikin(simple)) : simple);
    }
  }
  // Biggest first, so callers that keep only one keep the meaningful one.
  rings.sort((p, q) => Math.abs(ringArea(q)) - Math.abs(ringArea(p)));
  return rings;
}

/** Clear connected blobs smaller than `minCells` cells. */
function dropSpecks(mask: Uint8Array, w: number, h: number, minCells: number) {
  const seen = new Uint8Array(mask.length);
  const stack: number[] = [];
  const comp: number[] = [];
  for (let s = 0; s < mask.length; s++) {
    if (seen[s] || !mask[s]) continue;
    comp.length = 0;
    stack.length = 0;
    stack.push(s);
    seen[s] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      comp.push(p);
      const x = p % w;
      const y = (p / w) | 0;
      if (x > 0 && !seen[p - 1] && mask[p - 1]) { seen[p - 1] = 1; stack.push(p - 1); }
      if (x < w - 1 && !seen[p + 1] && mask[p + 1]) { seen[p + 1] = 1; stack.push(p + 1); }
      if (y > 0 && !seen[p - w] && mask[p - w]) { seen[p - w] = 1; stack.push(p - w); }
      if (y < h - 1 && !seen[p + w] && mask[p + w]) { seen[p + w] = 1; stack.push(p + w); }
    }
    if (comp.length < minCells) for (const p of comp) mask[p] = 0;
  }
}

/** One Chaikin corner-cutting pass on a closed ring. */
function chaikin(pts: Point[]): Point[] {
  const n = pts.length;
  const out: Point[] = new Array(n * 2);
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    out[i * 2] = { x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 };
    out[i * 2 + 1] = { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 };
  }
  return out;
}

/** Drop points on a straight run, keeping only the corners. */
function simplifyClosed(pts: Point[]): Point[] {
  const n = pts.length;
  if (n < 3) return pts;
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n];
    const b = pts[i];
    const c = pts[(i + 1) % n];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) > 1e-6) out.push(b);
  }
  return out.length >= 3 ? out : pts;
}
