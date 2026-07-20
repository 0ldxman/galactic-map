import { Rng } from '../util/rng';
import { Point } from './poisson';
import { Edge } from './graph';

export interface EmpireAssignment {
  /** capital system index for each empire */
  capitals: number[];
  /** empire index owning each system, or -1 for neutral/unclaimed */
  owner: number[];
}

/**
 * Greedy farthest-point selection: pick capitals that are spread out so empires
 * don't spawn on top of each other.
 */
function pickCapitals(points: Point[], count: number, rng: Rng): number[] {
  const n = points.length;
  const capitals: number[] = [rng.int(0, n - 1)];
  const minDist = new Array(n).fill(Infinity);
  while (capitals.length < count) {
    const last = capitals[capitals.length - 1];
    let far = -1;
    let farDist = -1;
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(points[i].x - points[last].x, points[i].y - points[last].y);
      if (d < minDist[i]) minDist[i] = d;
      if (!capitals.includes(i) && minDist[i] > farDist) {
        farDist = minDist[i];
        far = i;
      }
    }
    if (far < 0) break;
    capitals.push(far);
  }
  return capitals;
}

/**
 * Grow empires outward from their capitals along the hyperlane graph using a
 * multi-source breadth-first flood fill. A per-empire size cap plus a small
 * random chance to leave a frontier system unclaimed produces ragged,
 * Stellaris-like borders with pockets of neutral space between nations.
 */
export function assignEmpires(
  points: Point[],
  edges: Edge[],
  empireCount: number,
  rng: Rng
): EmpireAssignment {
  const n = points.length;
  const owner = new Array(n).fill(-1);
  const empires = Math.max(0, Math.min(empireCount, n));
  if (empires === 0) return { capitals: [], owner };

  const adj: number[][] = Array.from({ length: n }, () => []);
  for (const [a, b] of edges) {
    adj[a].push(b);
    adj[b].push(a);
  }

  const capitals = pickCapitals(points, empires, rng);
  // Give each empire a roughly balanced share, leaving ~25% of systems neutral.
  const targetTotal = Math.floor(n * 0.75);
  const cap = Math.max(3, Math.floor(targetTotal / empires));

  const sizes = new Array(empires).fill(0);
  // One BFS frontier per empire, advanced round-robin so growth stays even.
  const frontiers: number[][] = capitals.map((c, e) => {
    owner[c] = e;
    sizes[e] = 1;
    return [c];
  });

  let active = true;
  while (active) {
    active = false;
    for (let e = 0; e < empires; e++) {
      if (sizes[e] >= cap || frontiers[e].length === 0) continue;
      active = true;
      const next: number[] = [];
      for (const node of frontiers[e]) {
        for (const nb of adj[node]) {
          if (owner[nb] !== -1) continue;
          if (sizes[e] >= cap) break;
          // Chance to leave a border system neutral -> ragged edges.
          if (rng.float() < 0.12) continue;
          owner[nb] = e;
          sizes[e] += 1;
          next.push(nb);
        }
      }
      frontiers[e] = next;
    }
  }

  return { capitals, owner };
}
