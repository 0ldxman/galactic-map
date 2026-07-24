import { GalaxyMap, ID, MapRegion, System } from './types';

/**
 * Sector membership and nesting.
 *
 * Membership is stored on the systems, so "which systems are in this sector"
 * is a scan — cheap at this scale, and it means moving a system between
 * sectors is one op on one entity rather than edits to two lists that could
 * disagree with each other.
 *
 * Nesting is a parent pointer on the sector. A child's systems count as the
 * parent's, so a containing sector needn't repeat what its children already
 * list. Everything here tolerates a broken tree (a parent that was deleted, or
 * a cycle written by an older client) rather than looping forever.
 */

/** The sectors a system is directly assigned to. */
export function sectorsOf(s: System): ID[] {
  return s.sectors ?? [];
}

/** Direct children of a sector, in map order. */
export function childSectors(map: GalaxyMap, id: ID): MapRegion[] {
  return Object.values(map.regions).filter((r) => r.parentId === id);
}

/**
 * `id` and everything nested under it. Guards against a cycle, so a map with a
 * damaged parent chain still renders instead of hanging.
 */
export function sectorSubtree(map: GalaxyMap, id: ID): ID[] {
  const out: ID[] = [];
  const seen = new Set<ID>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    out.push(cur);
    for (const c of childSectors(map, cur)) stack.push(c.id);
  }
  return out;
}

/** The chain from a sector up to its root, nearest first. */
export function sectorAncestors(map: GalaxyMap, id: ID): MapRegion[] {
  const out: MapRegion[] = [];
  const seen = new Set<ID>([id]);
  let cur = map.regions[id]?.parentId ?? null;
  while (cur && map.regions[cur] && !seen.has(cur)) {
    seen.add(cur);
    out.push(map.regions[cur]);
    cur = map.regions[cur].parentId ?? null;
  }
  return out;
}

/** How deep a sector sits, for indenting a list. */
export function sectorDepth(map: GalaxyMap, id: ID): number {
  return sectorAncestors(map, id).length;
}

/**
 * Every system counted as part of `id` — its own members plus those of every
 * sector nested under it.
 */
export function sectorSystems(map: GalaxyMap, id: ID): System[] {
  const ids = new Set(sectorSubtree(map, id));
  return Object.values(map.systems).filter((s) =>
    sectorsOf(s).some((x) => ids.has(x))
  );
}

/**
 * The systems of `id`, and everything else on the map.
 *
 * The second list matters as much as the first: a sector boundary is decided
 * by competition, exactly as an empire border is. A system outside the sector —
 * whether it is in a different one or in none at all — pushes the boundary
 * back with its own influence, so a sector stops short of the systems it does
 * not contain instead of flowing over them.
 */
export function sectorPartition(
  map: GalaxyMap,
  id: ID
): { members: System[]; others: System[] } {
  const ids = new Set(sectorSubtree(map, id));
  const members: System[] = [];
  const others: System[] = [];
  for (const s of Object.values(map.systems)) {
    if (sectorsOf(s).some((x) => ids.has(x))) members.push(s);
    else others.push(s);
  }
  return { members, others };
}

/** Systems assigned to this sector itself, ignoring its children. */
export function ownSystems(map: GalaxyMap, id: ID): System[] {
  return Object.values(map.systems).filter((s) => sectorsOf(s).includes(id));
}

/**
 * Whether `parentId` may become the parent of `id`: not itself, and not one of
 * its own descendants — that is the only way to make a cycle.
 */
export function canReparent(
  map: GalaxyMap,
  id: ID,
  parentId: ID | null
): boolean {
  if (!parentId) return true;
  if (parentId === id) return false;
  if (!map.regions[parentId]) return false;
  return !sectorSubtree(map, id).includes(parentId);
}

/** Sectors in tree order (a parent immediately followed by its children). */
export function sectorTree(map: GalaxyMap): { region: MapRegion; depth: number }[] {
  const out: { region: MapRegion; depth: number }[] = [];
  const all = Object.values(map.regions);
  const seen = new Set<ID>();

  const walk = (r: MapRegion, depth: number) => {
    if (seen.has(r.id)) return;
    seen.add(r.id);
    out.push({ region: r, depth });
    for (const c of childSectors(map, r.id)) walk(c, depth + 1);
  };

  // Roots first: no parent, or a parent that no longer exists.
  for (const r of all) {
    if (!r.parentId || !map.regions[r.parentId]) walk(r, 0);
  }
  // Anything left is inside a cycle; show it flat rather than hiding it.
  for (const r of all) if (!seen.has(r.id)) walk(r, 0);
  return out;
}
