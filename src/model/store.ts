import { create } from 'zustand';
import {
  GalaxyMap,
  Empire,
  System,
  Hyperlane,
  ID,
  StarType,
  emptyMap,
} from './types';
import { DisplaySettings, resolveDisplay } from './display';
import { Op, applyOps, compressOps, invertOps, prevOf } from './ops';
import { Clip } from './clipboard';
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
  | 'delete';

export type SelectMode = 'replace' | 'toggle' | 'add';

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
  activeEmpireId: ID | null;
  /** first endpoint captured by the "connect" tool */
  connectFromId: ID | null;

  // --- selection / tools ---
  setTool: (t: Tool) => void;
  selectSystem: (id: ID | null, mode?: SelectMode) => void;
  setSelection: (ids: ID[]) => void;
  selectAll: () => void;
  clearSelection: () => void;
  setActiveEmpire: (id: ID | null) => void;
  setConnectFrom: (id: ID | null) => void;

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

  // --- display ---
  setDisplay: (patch: Partial<DisplaySettings>) => void;
}

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
    activeEmpireId: null,
    connectFromId: null,

    setTool: (t) => set({ tool: t, connectFromId: null }),

    selectSystem: (id, mode = 'replace') =>
      set((s) => {
        if (id === null) return { selection: [] };
        if (mode === 'replace') return { selection: [id] };
        const has = s.selection.includes(id);
        if (mode === 'add') return has ? {} : { selection: [...s.selection, id] };
        return has
          ? { selection: s.selection.filter((x) => x !== id) }
          : { selection: [...s.selection, id] };
      }),

    setSelection: (ids) => set({ selection: ids }),
    selectAll: () => set((s) => ({ selection: Object.keys(s.map.systems) })),
    clearSelection: () => set({ selection: [] }),

    setActiveEmpire: (id) => set({ activeEmpireId: id }),
    setConnectFrom: (id) => set({ connectFromId: id }),

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
  };
});
