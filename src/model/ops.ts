import {
  GalaxyMap,
  System,
  Hyperlane,
  Empire,
  ID,
  Nebula,
  MapRegion,
  SpaceObject,
  Annotation,
} from './types';
import { DisplaySettings, resolveDisplay } from './display';

/** Map collections that hold a plain id-keyed entity, edited through `ent.*`. */
export type EntColl = 'nebulae' | 'regions' | 'objects' | 'annotations';

export interface EntMap {
  nebulae: Nebula;
  regions: MapRegion;
  objects: SpaceObject;
  annotations: Annotation;
}

type EntAdd = { [C in EntColl]: { t: 'ent.add'; c: C; ent: EntMap[C] } }[EntColl];
type EntDel = { [C in EntColl]: { t: 'ent.del'; c: C; ent: EntMap[C] } }[EntColl];
type EntSet = {
  [C in EntColl]: {
    t: 'ent.set';
    c: C;
    id: ID;
    patch: Partial<EntMap[C]>;
    prev: Partial<EntMap[C]>;
  };
}[EntColl];

/**
 * Every edit to the map is expressed as one of these operations. Two properties
 * are deliberate and load-bearing:
 *
 *  - **Serialisable** — an op is plain JSON, so the same value that mutates the
 *    local map can later be sent to the server and broadcast to co-editors.
 *  - **Invertible** — every op carries whatever previous state undo needs, so
 *    the history is a list of ops rather than snapshots of the whole map. That
 *    is what makes undo *local* (undoing only your own edits) once several
 *    people edit the same map at once.
 *
 * Compound edits (deleting a system also drops its hyperlanes) are not a single
 * op: the action emits several ops inside one transaction, so each op stays
 * atomic and independently invertible.
 */
export type Op =
  | { t: 'sys.add'; sys: System }
  | { t: 'sys.del'; sys: System }
  | { t: 'sys.set'; id: ID; patch: Partial<System>; prev: Partial<System> }
  | { t: 'lane.add'; lane: Hyperlane }
  | { t: 'lane.del'; lane: Hyperlane }
  | { t: 'emp.add'; emp: Empire }
  | { t: 'emp.del'; emp: Empire }
  | { t: 'emp.set'; id: ID; patch: Partial<Empire>; prev: Partial<Empire> }
  | {
      t: 'disp.set';
      patch: Partial<DisplaySettings>;
      prev: Partial<DisplaySettings>;
    }
  | EntAdd
  | EntDel
  | EntSet
  /** whole-document replacement (generate / import) */
  | { t: 'map.set'; map: GalaxyMap; prev: GalaxyMap };

export function applyOp(map: GalaxyMap, op: Op): GalaxyMap {
  switch (op.t) {
    case 'sys.add':
      return { ...map, systems: { ...map.systems, [op.sys.id]: op.sys } };
    case 'sys.del': {
      const systems = { ...map.systems };
      delete systems[op.sys.id];
      return { ...map, systems };
    }
    case 'sys.set': {
      const cur = map.systems[op.id];
      if (!cur) return map;
      return {
        ...map,
        systems: { ...map.systems, [op.id]: { ...cur, ...op.patch } },
      };
    }
    case 'lane.add':
      return { ...map, hyperlanes: { ...map.hyperlanes, [op.lane.id]: op.lane } };
    case 'lane.del': {
      const hyperlanes = { ...map.hyperlanes };
      delete hyperlanes[op.lane.id];
      return { ...map, hyperlanes };
    }
    case 'emp.add':
      return { ...map, empires: { ...map.empires, [op.emp.id]: op.emp } };
    case 'emp.del': {
      const empires = { ...map.empires };
      delete empires[op.emp.id];
      return { ...map, empires };
    }
    case 'emp.set': {
      const cur = map.empires[op.id];
      if (!cur) return map;
      return {
        ...map,
        empires: { ...map.empires, [op.id]: { ...cur, ...op.patch } },
      };
    }
    case 'disp.set':
      return { ...map, display: { ...resolveDisplay(map.display), ...op.patch } };
    case 'ent.add':
      return { ...map, [op.c]: { ...map[op.c], [op.ent.id]: op.ent } };
    case 'ent.del': {
      const coll = { ...map[op.c] } as Record<ID, unknown>;
      delete coll[op.ent.id];
      return { ...map, [op.c]: coll };
    }
    case 'ent.set': {
      const cur = (map[op.c] as Record<ID, object>)[op.id];
      if (!cur) return map;
      return {
        ...map,
        [op.c]: { ...map[op.c], [op.id]: { ...cur, ...op.patch } },
      };
    }
    case 'map.set':
      return op.map;
  }
}

export function applyOps(map: GalaxyMap, ops: readonly Op[]): GalaxyMap {
  let out = map;
  for (const op of ops) out = applyOp(out, op);
  return out;
}

export function invertOp(op: Op): Op {
  switch (op.t) {
    case 'sys.add':
      return { t: 'sys.del', sys: op.sys };
    case 'sys.del':
      return { t: 'sys.add', sys: op.sys };
    case 'sys.set':
      return { t: 'sys.set', id: op.id, patch: op.prev, prev: op.patch };
    case 'lane.add':
      return { t: 'lane.del', lane: op.lane };
    case 'lane.del':
      return { t: 'lane.add', lane: op.lane };
    case 'emp.add':
      return { t: 'emp.del', emp: op.emp };
    case 'emp.del':
      return { t: 'emp.add', emp: op.emp };
    case 'emp.set':
      return { t: 'emp.set', id: op.id, patch: op.prev, prev: op.patch };
    case 'disp.set':
      return { t: 'disp.set', patch: op.prev, prev: op.patch };
    case 'ent.add':
      return { t: 'ent.del', c: op.c, ent: op.ent } as Op;
    case 'ent.del':
      return { t: 'ent.add', c: op.c, ent: op.ent } as Op;
    case 'ent.set':
      return {
        t: 'ent.set',
        c: op.c,
        id: op.id,
        patch: op.prev,
        prev: op.patch,
      } as Op;
    case 'map.set':
      return { t: 'map.set', map: op.prev, prev: op.map };
  }
}

export function invertOps(ops: readonly Op[]): Op[] {
  const out: Op[] = [];
  for (let i = ops.length - 1; i >= 0; i--) out.push(invertOp(ops[i]));
  return out;
}

/**
 * Collapse runs of patches on the same entity into one. A drag emits a `sys.set`
 * per pointermove; without this a single drag would bloat the history (and, on
 * the wire, spam co-editors) with hundreds of ops.
 */
export function compressOps(ops: readonly Op[]): Op[] {
  const out: Op[] = [];
  for (const op of ops) {
    const last = out[out.length - 1];
    if (
      last &&
      op.t === 'sys.set' &&
      last.t === 'sys.set' &&
      last.id === op.id
    ) {
      out[out.length - 1] = {
        t: 'sys.set',
        id: op.id,
        patch: { ...last.patch, ...op.patch },
        // `last` happened first, so its `prev` is the older truth and wins.
        prev: { ...op.prev, ...last.prev },
      };
      continue;
    }
    if (
      last &&
      op.t === 'emp.set' &&
      last.t === 'emp.set' &&
      last.id === op.id
    ) {
      out[out.length - 1] = {
        t: 'emp.set',
        id: op.id,
        patch: { ...last.patch, ...op.patch },
        prev: { ...op.prev, ...last.prev },
      };
      continue;
    }
    if (
      last &&
      op.t === 'ent.set' &&
      last.t === 'ent.set' &&
      last.c === op.c &&
      last.id === op.id
    ) {
      out[out.length - 1] = {
        t: 'ent.set',
        c: op.c,
        id: op.id,
        patch: { ...last.patch, ...op.patch },
        prev: { ...op.prev, ...last.prev },
      } as Op;
      continue;
    }
    if (last && op.t === 'disp.set' && last.t === 'disp.set') {
      out[out.length - 1] = {
        t: 'disp.set',
        patch: { ...last.patch, ...op.patch },
        prev: { ...op.prev, ...last.prev },
      };
      continue;
    }
    out.push(op);
  }
  return out;
}

/** The subset of `obj`'s fields named by `patch`, for an op's `prev`. */
export function prevOf<T extends object>(obj: T, patch: Partial<T>): Partial<T> {
  const prev: Partial<T> = {};
  for (const k of Object.keys(patch) as (keyof T)[]) prev[k] = obj[k];
  return prev;
}
