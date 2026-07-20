import { Delaunay } from 'd3-delaunay';
import { Rng } from '../util/rng';
import { Point } from './poisson';

export type Edge = [number, number];

class UnionFind {
  parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]];
      x = this.parent[x];
    }
    return x;
  }
  union(a: number, b: number): boolean {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return false;
    this.parent[ra] = rb;
    return true;
  }
}

/**
 * Build a hyperlane graph from system positions:
 *  1. Delaunay triangulation gives natural neighbour candidates.
 *  2. Drop edges longer than a multiple of the median length (no wormhole-long
 *     connections across the void).
 *  3. Guarantee the galaxy is fully connected via an MST over the survivors.
 *  4. Add back extra short edges up to the desired connectivity for loops.
 */
export function buildGraph(
  points: Point[],
  rng: Rng,
  connectivity = 0.35
): Edge[] {
  const n = points.length;
  if (n < 2) return [];

  const delaunay = Delaunay.from(
    points,
    (p) => p.x,
    (p) => p.y
  );
  const seen = new Set<string>();
  const candidates: { edge: Edge; len: number }[] = [];
  const tris = delaunay.triangles;
  const addEdge = (a: number, b: number) => {
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (seen.has(key)) return;
    seen.add(key);
    const len = Math.hypot(points[a].x - points[b].x, points[a].y - points[b].y);
    candidates.push({ edge: [a, b], len });
  };
  for (let i = 0; i < tris.length; i += 3) {
    addEdge(tris[i], tris[i + 1]);
    addEdge(tris[i + 1], tris[i + 2]);
    addEdge(tris[i + 2], tris[i]);
  }

  const lengths = candidates.map((c) => c.len).sort((a, b) => a - b);
  const median = lengths[Math.floor(lengths.length / 2)] || 1;
  const maxLen = median * 2.2;
  const kept = candidates.filter((c) => c.len <= maxLen);

  // Sort short-to-long: MST prefers short links, matching a spacey look.
  kept.sort((a, b) => a.len - b.len);

  const uf = new UnionFind(n);
  const result: Edge[] = [];
  const extras: Edge[] = [];
  for (const c of kept) {
    if (uf.union(c.edge[0], c.edge[1])) {
      result.push(c.edge);
    } else {
      extras.push(c.edge);
    }
  }

  // If the length cap fragmented the graph, stitch components with the shortest
  // available candidate (even if long) so travel is always possible.
  if (result.length < n - 1) {
    for (const c of [...candidates].sort((a, b) => a.len - b.len)) {
      if (result.length >= n - 1) break;
      if (uf.union(c.edge[0], c.edge[1])) result.push(c.edge);
    }
  }

  // Add a fraction of the redundant short edges back for interesting routes.
  const extraCount = Math.floor(extras.length * connectivity);
  for (let i = 0; i < extraCount; i++) {
    const idx = rng.int(0, extras.length - 1);
    result.push(extras[idx]);
    extras.splice(idx, 1);
  }

  return result;
}
