import { create } from 'zustand';
import {
  GalaxyMap,
  Empire,
  System,
  Hyperlane,
  ID,
  StarType,
  Nebula,
  MapRegion,
  SpaceObject,
  Annotation,
  ObjectKind,
  AnnotationKind,
  emptyMap,
} from './types';
import { DisplaySettings, resolveDisplay } from './display';
import { Op, EntColl, EntMap, applyOps, compressOps, invertOps, prevOf } from './ops';
import { Clip } from './clipboard';
import { OBJECT_BY_ID } from './objects';
import { makeId, Rng } from '../util/rng';
import { systemName } from '../generation/names';
import { makeStarCluster } from './stars';

// Non-deterministic RNG for hand-created systems (auto name / stars).
const editorRng = new Rng((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);
const editorRand = () => editorRng.float();

const HISTORY_MAX = 200;

export type Tool =
  | 'select'
  | 'add-system'
  | 'connect'
  | 'paint'
  | 'delete'
  | 'nebula'
  | 'region'
  | 'object'
  | 'annotate';

export type SelectMode = 'replace' | 'toggle' | 'add';

/** A selected non-system entity (these are edited one at a time). */
export interface EntityRef {
  c: EntColl;
  id: ID;
}

export interface EditorState {
  map: GalaxyMap;
  /** bumped on every mutation so the canvas renderer knows to redraw */
  revision: number;

  /** undo / redo stacks of transactions (each a list of ops) */
  past: Op[][];
  future: Op[][];

  tool: Tool;
  /** ids of every selected system */
  selection: ID[];
  /** the selected nebula / region / object / annotation, if any */
  selectedEntity: EntityRef | null;
  activeEmpireId: ID | null;
  /** first endpoint captured by the "connect" tool */
  connectFromId: ID | null;

  // --- tool options (editor state, not part of the map) ---
  activeNebulaId: ID | null;
  brushSize: number;
  objectKind: ObjectKind;
  annotationKind: AnnotationKind;
  annotationColor: string;
  /** object being linked by the "link objects" action */
  linkFromId: ID | null;

  // --- selection / tools ---
  setTool: (t: Tool) => void;
  selectSystem: (id: ID | null, mode?: SelectMode) => void;
  setSelection: (ids: ID[]) => void;
  selectEntity: (ref: EntityRef | null) => void;
  selectAll: () => void;
  clearSelection: () => void;
  setActiveEmpire: (id: ID | null) => void;
  setConnectFrom: (id: ID | null) => void;
  setToolOptions: (
    o: Partial<{
      activeNebulaId: ID | null;
      brushSize: number;
      objectKind: ObjectKind;
      annotationKind: AnnotationKind;
      annotationColor: string;
      linkFromId: ID | null;
    }>
  ) => void;

  // --- history ---
  /** Group everything until `endTx` into a single undo step (e.g. one drag). */
  beginTx: () => void;
  endTx: () => void;
  undo: () => void;
  redo: () => void;

  // --- whole-map ---
  setMap: (map: GalaxyMap, resetHistory?: boolean) => void;

  // --- systems ---
  addSystem: (x: number, y: number, opts?: Partial<System>) => ID;
  updateSystem: (id: ID, patch: Partial<System>) => void;
  updateSystems: (ids: readonly ID[], patch: Partial<System>) => void;
  moveSystem: (id: ID, x: number, y: number) => void;
  moveSystemsBy: (ids: readonly ID[], dx: number, dy: number) => void;
  removeSystem: (id: ID) => void;
  removeSystems: (ids: readonly ID[]) => void;
  setOwner: (systemId: ID, ownerId: ID | null) => void;
  setOwnerMany: (ids: readonly ID[], ownerId: ID | null) => void;
  toggleMarker: (systemId: ID, markerId: string) => void;
  toggleMarkerMany: (ids: readonly ID[], markerId: string) => void;

  // --- clipboard ---
  insertClip: (clip: Clip, atX: number, atY: number) => ID[];

  // --- hyperlanes ---
  toggleHyperlane: (a: ID, b: ID) => void;
  removeHyperlane: (id: ID) => void;

  // --- empires ---
  addEmpire: (opts?: Partial<Empire>) => ID;
  updateEmpire: (id: ID, patch: Partial<Empire>) => void;
  removeEmpire: (id: ID) => void;

  // --- nebulae / regions / objects / annotations ---
  updateEnt: <C extends EntColl>(
    c: C,
    id: ID,
    patch: Partial<EntMap[C]>
  ) => void;
  removeEnt: (c: EntColl, id: ID) => void;
  addNebula: (opts?: Partial<Nebula>) => ID;
  /** Add brush dabs to a nebula (painting). */
  paintNebula: (id: ID, blobs: { x: number; y: number; r: number }[]) => void;
  /** Remove dabs overlapping the brush (erasing). */
  eraseNebula: (id: ID, x: number, y: number, r: number) => void;
  addRegion: (x: number, y: number, opts?: Partial<MapRegion>) => ID;
  addObject: (x: number, y: number, opts?: Partial<SpaceObject>) => ID;
  linkObjects: (a: ID, b: ID) => void;
  addAnnotation: (a: Omit<Annotation, 'id'>) => ID;

  // --- display ---
  setDisplay: (patch: Partial<DisplaySettings>) => void;
}

const NEBULA_PALETTE = [
  '#7a4bd6', '#c2416b', '#2f8fb8', '#b8632f', '#3fa06a',
  '#8f3fa0', '#3f5fa0', '#a0863f',
];

const EMPIRE_PALETTE = [
  '#e0483d', '#3d8ee0', '#49c26b', '#e0b23d', '#a34fe0',
  '#e0733d', '#3dd6c2', '#e03d94', '#7ac23d', '#5a5fe0',
];

/** Ops accumulated by the open transaction, if any (see beginTx/endTx). */
let txOps: Op[] | null = null;

function pushHistory(past: Op[][], ops: Op[]): Op[][] {
  const next = [...past, compressOps(ops)];
  return next.length > HISTORY_MAX ? next.slice(next.length - HISTORY_MAX) : next;
}

export const useEditor = create<EditorState>((set, get) => {
  /** Apply ops to the map and record them for undo (or into the open tx). */
  const commit = (ops: Op[]) => {
    if (ops.length === 0) return;
    if (txOps) {
      txOps.push(...ops);
      set((s) => ({ map: applyOps(s.map, ops), revision: s.revision + 1 }));
      return;
    }
    set((s) => ({
      map: applyOps(s.map, ops),
      revision: s.revision + 1,
      past: pushHistory(s.past, ops),
      future: [],
    }));
  };

  /** Ops that delete a system together with everything referencing it. */
  const deleteSystemOps = (map: GalaxyMap, ids: readonly ID[]): Op[] => {
    const dead = new Set(ids);
    const ops: Op[] = [];
    for (const h of Object.values(map.hyperlanes)) {
      if (dead.has(h.a) || dead.has(h.b)) ops.push({ t: 'lane.del', lane: h });
    }
    for (const e of Object.values(map.empires)) {
      if (e.capitalId && dead.has(e.capitalId)) {
        ops.push({
          t: 'emp.set',
          id: e.id,
          patch: { capitalId: null },
          prev: { capitalId: e.capitalId },
        });
      }
    }
    for (const id of dead) {
      const sys = map.systems[id];
      if (sys) ops.push({ t: 'sys.del', sys });
    }
    return ops;
  };

  const patchSystemsOps = (
    map: GalaxyMap,
    ids: readonly ID[],
    patch: Partial<System>
  ): Op[] => {
    const ops: Op[] = [];
    for (const id of ids) {
      const cur = map.systems[id];
      if (!cur) continue;
      ops.push({ t: 'sys.set', id, patch, prev: prevOf(cur, patch) });
    }
    return ops;
  };

  return {
    map: emptyMap(),
    revision: 0,
    past: [],
    future: [],

    tool: 'select',
    selection: [],
    selectedEntity: null,
    activeEmpireId: null,
    connectFromId: null,

    activeNebulaId: null,
    brushSize: 60,
    objectKind: 'wormhole',
    annotationKind: 'text',
    annotationColor: '#e2eaf8',
    linkFromId: null,

    setTool: (t) => set({ tool: t, connectFromId: null, linkFromId: null }),

    selectSystem: (id, mode = 'replace') =>
      set((s) => {
        if (id === null) return { selection: [], selectedEntity: null };
        if (mode === 'replace') return { selection: [id], selectedEntity: null };
        const has = s.selection.includes(id);
        if (mode === 'add')
          return has ? {} : { selection: [...s.selection, id], selectedEntity: null };
        return has
          ? { selection: s.selection.filter((x) => x !== id) }
          : { selection: [...s.selection, id], selectedEntity: null };
      }),

    setSelection: (ids) => set({ selection: ids, selectedEntity: null }),
    selectEntity: (ref) => set({ selectedEntity: ref, selection: [] }),
    selectAll: () => set((s) => ({ selection: Object.keys(s.map.systems) })),
    clearSelection: () => set({ selection: [], selectedEntity: null }),

    setActiveEmpire: (id) => set({ activeEmpireId: id }),
    setConnectFrom: (id) => set({ connectFromId: id }),
    setToolOptions: (o) => set(o),

    beginTx: () => {
      if (!txOps) txOps = [];
    },
    endTx: () => {
      const ops = txOps;
      txOps = null;
      if (!ops || ops.length === 0) return;
      set((s) => ({ past: pushHistory(s.past, ops), future: [] }));
    },

    undo: () =>
      set((s) => {
        const last = s.past[s.past.length - 1];
        if (!last) return {};
        const map = applyOps(s.map, invertOps(last));
        return {
          map,
          revision: s.revision + 1,
          past: s.past.slice(0, -1),
          future: [...s.future, last],
          selection: s.selection.filter((id) => map.systems[id]),
          connectFromId: null,
        };
      }),

    redo: () =>
      set((s) => {
        const next = s.future[s.future.length - 1];
        if (!next) return {};
        const map = applyOps(s.map, next);
        return {
          map,
          revision: s.revision + 1,
          past: [...s.past, next],
          future: s.future.slice(0, -1),
          selection: s.selection.filter((id) => map.systems[id]),
          connectFromId: null,
        };
      }),

    setMap: (map, resetHistory = false) => {
      const next: GalaxyMap = { ...map, display: resolveDisplay(map.display) };
      if (resetHistory) {
        set((s) => ({
          map: next,
          revision: s.revision + 1,
          past: [],
          future: [],
          selection: [],
          connectFromId: null,
          activeEmpireId: Object.keys(next.empires)[0] ?? null,
        }));
        return;
      }
      // Undoable document replacement (generate / import).
      const prev = get().map;
      commit([{ t: 'map.set', map: next, prev }]);
      set({
        selection: [],
        connectFromId: null,
        activeEmpireId: Object.keys(next.empires)[0] ?? null,
      });
    },

    addSystem: (x, y, opts) => {
      const id = makeId('sys');
      const stars = opts?.stars ?? makeStarCluster(editorRand);
      const system: System = {
        id,
        name: opts?.name ?? systemName(editorRng),
        x,
        y,
        starType: (opts?.starType as StarType) ?? stars[0].type,
        ownerId: opts?.ownerId ?? null,
        influence: opts?.influence ?? 34,
        markers: opts?.markers ?? [],
        stars,
      };
      commit([{ t: 'sys.add', sys: system }]);
      return id;
    },

    updateSystem: (id, patch) => commit(patchSystemsOps(get().map, [id], patch)),
    updateSystems: (ids, patch) => commit(patchSystemsOps(get().map, ids, patch)),

    moveSystem: (id, x, y) => commit(patchSystemsOps(get().map, [id], { x, y })),

    moveSystemsBy: (ids, dx, dy) => {
      const map = get().map;
      const ops: Op[] = [];
      for (const id of ids) {
        const cur = map.systems[id];
        if (!cur) continue;
        ops.push({
          t: 'sys.set',
          id,
          patch: { x: cur.x + dx, y: cur.y + dy },
          prev: { x: cur.x, y: cur.y },
        });
      }
      commit(ops);
    },

    removeSystem: (id) => get().removeSystems([id]),

    removeSystems: (ids) => {
      if (ids.length === 0) return;
      commit(deleteSystemOps(get().map, ids));
      const dead = new Set(ids);
      set((s) => ({ selection: s.selection.filter((id) => !dead.has(id)) }));
    },

    setOwner: (systemId, ownerId) =>
      commit(patchSystemsOps(get().map, [systemId], { ownerId })),
    setOwnerMany: (ids, ownerId) =>
      commit(patchSystemsOps(get().map, ids, { ownerId })),

    toggleMarker: (systemId, markerId) => get().toggleMarkerMany([systemId], markerId),

    toggleMarkerMany: (ids, markerId) => {
      const map = get().map;
      // If any system in the group lacks the marker, add it everywhere;
      // otherwise remove it everywhere.
      const adding = ids.some((id) => !(map.systems[id]?.markers ?? []).includes(markerId));
      const ops: Op[] = [];
      for (const id of ids) {
        const cur = map.systems[id];
        if (!cur) continue;
        const have = cur.markers ?? [];
        if (adding === have.includes(markerId)) continue;
        const markers = adding
          ? [...have, markerId]
          : have.filter((m) => m !== markerId);
        ops.push({ t: 'sys.set', id, patch: { markers }, prev: { markers: have } });
      }
      commit(ops);
    },

    insertClip: (clip, atX, atY) => {
      const dx = atX - clip.cx;
      const dy = atY - clip.cy;
      const ops: Op[] = [];
      const newIds: ID[] = [];
      for (const s of clip.systems) {
        const id = makeId('sys');
        newIds.push(id);
        ops.push({
          t: 'sys.add',
          sys: {
            ...s,
            id,
            x: s.x + dx,
            y: s.y + dy,
            // Capital status belongs to the original, not the copy.
            markers: s.markers ? [...s.markers] : [],
            stars: s.stars ? s.stars.map((b) => ({ ...b })) : undefined,
          },
        });
      }
      for (const [a, b] of clip.lanes) {
        if (!newIds[a] || !newIds[b]) continue;
        ops.push({
          t: 'lane.add',
          lane: { id: makeId('hl'), a: newIds[a], b: newIds[b] },
        });
      }
      commit(ops);
      set({ selection: newIds });
      return newIds;
    },

    toggleHyperlane: (a, b) => {
      if (a === b) return;
      const map = get().map;
      const existing = Object.values(map.hyperlanes).find(
        (h) => (h.a === a && h.b === b) || (h.a === b && h.b === a)
      );
      if (existing) commit([{ t: 'lane.del', lane: existing }]);
      else commit([{ t: 'lane.add', lane: { id: makeId('hl'), a, b } }]);
    },

    removeHyperlane: (id) => {
      const lane: Hyperlane | undefined = get().map.hyperlanes[id];
      if (lane) commit([{ t: 'lane.del', lane }]);
    },

    addEmpire: (opts) => {
      const id = makeId('emp');
      const existing = Object.keys(get().map.empires).length;
      const empire: Empire = {
        id,
        name: opts?.name ?? `Empire ${existing + 1}`,
        color: opts?.color ?? EMPIRE_PALETTE[existing % EMPIRE_PALETTE.length],
        borderColor: opts?.borderColor,
        capitalId: opts?.capitalId ?? null,
      };
      commit([{ t: 'emp.add', emp: empire }]);
      set({ activeEmpireId: id });
      return id;
    },

    updateEmpire: (id, patch) => {
      const cur = get().map.empires[id];
      if (!cur) return;
      commit([{ t: 'emp.set', id, patch, prev: prevOf(cur, patch) }]);
    },

    removeEmpire: (id) => {
      const map = get().map;
      const emp = map.empires[id];
      if (!emp) return;
      const ops: Op[] = [];
      // Un-own systems that belonged to this empire.
      for (const sys of Object.values(map.systems)) {
        if (sys.ownerId === id) {
          ops.push({
            t: 'sys.set',
            id: sys.id,
            patch: { ownerId: null },
            prev: { ownerId: id },
          });
        }
      }
      ops.push({ t: 'emp.del', emp });
      commit(ops);
      set((s) => ({
        activeEmpireId:
          s.activeEmpireId === id
            ? Object.keys(s.map.empires)[0] ?? null
            : s.activeEmpireId,
      }));
    },

    setDisplay: (patch) => {
      const cur = resolveDisplay(get().map.display);
      commit([{ t: 'disp.set', patch, prev: prevOf(cur, patch) }]);
    },

    updateEnt: (c, id, patch) => {
      const cur = get().map[c][id] as EntMap[typeof c] | undefined;
      if (!cur) return;
      commit([{ t: 'ent.set', c, id, patch, prev: prevOf(cur, patch) } as Op]);
    },

    removeEnt: (c, id) => {
      const ent = get().map[c][id];
      if (!ent) return;
      const ops: Op[] = [{ t: 'ent.del', c, ent } as Op];
      // Unlink anything pointing at a deleted object.
      if (c === 'objects') {
        for (const o of Object.values(get().map.objects)) {
          if (o.linkedId === id) {
            ops.push({
              t: 'ent.set',
              c: 'objects',
              id: o.id,
              patch: { linkedId: null },
              prev: { linkedId: id },
            });
          }
        }
      }
      commit(ops);
      set((s) => ({
        selectedEntity:
          s.selectedEntity?.c === c && s.selectedEntity.id === id
            ? null
            : s.selectedEntity,
        activeNebulaId: c === 'nebulae' && s.activeNebulaId === id ? null : s.activeNebulaId,
      }));
    },

    addNebula: (opts) => {
      const id = makeId('neb');
      const n = Object.keys(get().map.nebulae).length;
      const neb: Nebula = {
        id,
        name: opts?.name ?? `Nebula ${n + 1}`,
        color: opts?.color ?? NEBULA_PALETTE[n % NEBULA_PALETTE.length],
        opacity: opts?.opacity ?? 0.5,
        blobs: opts?.blobs ?? [],
        showName: opts?.showName ?? true,
      };
      commit([{ t: 'ent.add', c: 'nebulae', ent: neb }]);
      set({ activeNebulaId: id });
      return id;
    },

    paintNebula: (id, blobs) => {
      const cur = get().map.nebulae[id];
      if (!cur || blobs.length === 0) return;
      commit([
        {
          t: 'ent.set',
          c: 'nebulae',
          id,
          patch: { blobs: [...cur.blobs, ...blobs] },
          prev: { blobs: cur.blobs },
        },
      ]);
    },

    eraseNebula: (id, x, y, r) => {
      const cur = get().map.nebulae[id];
      if (!cur) return;
      const kept = cur.blobs.filter((b) => Math.hypot(b.x - x, b.y - y) > r);
      if (kept.length === cur.blobs.length) return;
      commit([
        {
          t: 'ent.set',
          c: 'nebulae',
          id,
          patch: { blobs: kept },
          prev: { blobs: cur.blobs },
        },
      ]);
    },

    addRegion: (x, y, opts) => {
      const id = makeId('reg');
      const reg: MapRegion = {
        id,
        name: opts?.name ?? 'New Region',
        x,
        y,
        size: opts?.size ?? 70,
        color: opts?.color,
        spacing: opts?.spacing ?? 0.35,
      };
      commit([{ t: 'ent.add', c: 'regions', ent: reg }]);
      set({ selectedEntity: { c: 'regions', id }, selection: [] });
      return id;
    },

    addObject: (x, y, opts) => {
      const id = makeId('obj');
      const kind = opts?.kind ?? get().objectKind;
      const obj: SpaceObject = {
        id,
        kind,
        name: opts?.name ?? OBJECT_BY_ID[kind].label,
        x,
        y,
        systemId: opts?.systemId ?? null,
        linkedId: opts?.linkedId ?? null,
        color: opts?.color,
      };
      commit([{ t: 'ent.add', c: 'objects', ent: obj }]);
      set({ selectedEntity: { c: 'objects', id }, selection: [] });
      return id;
    },

    linkObjects: (a, b) => {
      const map = get().map;
      const oa = map.objects[a];
      const ob = map.objects[b];
      if (!oa || !ob || a === b) return;
      const ops: Op[] = [
        {
          t: 'ent.set',
          c: 'objects',
          id: a,
          patch: { linkedId: b },
          prev: { linkedId: oa.linkedId ?? null },
        },
        {
          t: 'ent.set',
          c: 'objects',
          id: b,
          patch: { linkedId: a },
          prev: { linkedId: ob.linkedId ?? null },
        },
      ];
      // Break whatever those two were linked to before, so links stay pairwise.
      for (const old of [oa.linkedId, ob.linkedId]) {
        if (old && old !== a && old !== b && map.objects[old]) {
          ops.push({
            t: 'ent.set',
            c: 'objects',
            id: old,
            patch: { linkedId: null },
            prev: { linkedId: map.objects[old].linkedId ?? null },
          });
        }
      }
      commit(ops);
    },

    addAnnotation: (a) => {
      const id = makeId('ann');
      commit([{ t: 'ent.add', c: 'annotations', ent: { ...a, id } }]);
      set({ selectedEntity: { c: 'annotations', id }, selection: [] });
      return id;
    },
  };
});
