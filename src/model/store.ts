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
import { makeId, Rng } from '../util/rng';
import { systemName } from '../generation/names';

// Non-deterministic RNG for hand-created systems (auto name / type / star count).
const editorRng = new Rng((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);
const RANDOM_STAR_TYPES: StarType[] = ['yellow', 'red', 'blue', 'white', 'neutron'];
const RANDOM_STAR_WEIGHTS = [30, 34, 12, 14, 6];

/** 1–4 stars, heavily weighted toward single/binary systems. */
function randomStarCount(): number {
  return editorRng.weighted([1, 2, 3, 4], [60, 27, 9, 4]);
}

export type Tool =
  | 'select'
  | 'add-system'
  | 'connect'
  | 'paint'
  | 'delete';

export interface EditorState {
  map: GalaxyMap;
  /** bumped on every mutation so the canvas renderer knows to redraw */
  revision: number;

  tool: Tool;
  selectedSystemId: ID | null;
  activeEmpireId: ID | null;
  /** first endpoint captured by the "connect" tool */
  connectFromId: ID | null;

  // --- selection / tools ---
  setTool: (t: Tool) => void;
  selectSystem: (id: ID | null) => void;
  setActiveEmpire: (id: ID | null) => void;
  setConnectFrom: (id: ID | null) => void;

  // --- whole-map ---
  setMap: (map: GalaxyMap) => void;

  // --- systems ---
  addSystem: (x: number, y: number, opts?: Partial<System>) => ID;
  updateSystem: (id: ID, patch: Partial<System>) => void;
  moveSystem: (id: ID, x: number, y: number) => void;
  removeSystem: (id: ID) => void;
  setOwner: (systemId: ID, ownerId: ID | null) => void;
  toggleMarker: (systemId: ID, markerId: string) => void;

  // --- hyperlanes ---
  toggleHyperlane: (a: ID, b: ID) => void;
  removeHyperlane: (id: ID) => void;

  // --- empires ---
  addEmpire: (opts?: Partial<Empire>) => ID;
  updateEmpire: (id: ID, patch: Partial<Empire>) => void;
  removeEmpire: (id: ID) => void;
}

const EMPIRE_PALETTE = [
  '#e0483d', '#3d8ee0', '#49c26b', '#e0b23d', '#a34fe0',
  '#e0733d', '#3dd6c2', '#e03d94', '#7ac23d', '#5a5fe0',
];

function bump(map: GalaxyMap, revision: number) {
  return { map: { ...map }, revision: revision + 1 };
}

export const useEditor = create<EditorState>((set, get) => ({
  map: emptyMap(),
  revision: 0,

  tool: 'select',
  selectedSystemId: null,
  activeEmpireId: null,
  connectFromId: null,

  setTool: (t) => set({ tool: t, connectFromId: null }),
  selectSystem: (id) => set({ selectedSystemId: id }),
  setActiveEmpire: (id) => set({ activeEmpireId: id }),
  setConnectFrom: (id) => set({ connectFromId: id }),

  setMap: (map) =>
    set((s) => ({
      map,
      revision: s.revision + 1,
      selectedSystemId: null,
      connectFromId: null,
      activeEmpireId: Object.keys(map.empires)[0] ?? null,
    })),

  addSystem: (x, y, opts) => {
    const id = makeId('sys');
    const system: System = {
      id,
      name: opts?.name ?? systemName(editorRng),
      x,
      y,
      starType:
        (opts?.starType as StarType) ??
        editorRng.weighted(RANDOM_STAR_TYPES, RANDOM_STAR_WEIGHTS),
      ownerId: opts?.ownerId ?? null,
      influence: opts?.influence ?? 34,
      markers: opts?.markers ?? [],
      stars: opts?.stars ?? randomStarCount(),
    };
    set((s) => {
      const map = { ...s.map, systems: { ...s.map.systems, [id]: system } };
      return bump(map, s.revision);
    });
    return id;
  },

  updateSystem: (id, patch) =>
    set((s) => {
      const cur = s.map.systems[id];
      if (!cur) return {};
      const map = {
        ...s.map,
        systems: { ...s.map.systems, [id]: { ...cur, ...patch } },
      };
      return bump(map, s.revision);
    }),

  moveSystem: (id, x, y) =>
    set((s) => {
      const cur = s.map.systems[id];
      if (!cur) return {};
      const map = {
        ...s.map,
        systems: { ...s.map.systems, [id]: { ...cur, x, y } },
      };
      return bump(map, s.revision);
    }),

  removeSystem: (id) =>
    set((s) => {
      const systems = { ...s.map.systems };
      delete systems[id];
      const hyperlanes: Record<ID, Hyperlane> = {};
      for (const h of Object.values(s.map.hyperlanes)) {
        if (h.a !== id && h.b !== id) hyperlanes[h.id] = h;
      }
      // Detach as a capital if needed.
      const empires = { ...s.map.empires };
      for (const e of Object.values(empires)) {
        if (e.capitalId === id) empires[e.id] = { ...e, capitalId: null };
      }
      const map = { ...s.map, systems, hyperlanes, empires };
      return {
        ...bump(map, s.revision),
        selectedSystemId:
          s.selectedSystemId === id ? null : s.selectedSystemId,
      };
    }),

  setOwner: (systemId, ownerId) =>
    set((s) => {
      const cur = s.map.systems[systemId];
      if (!cur) return {};
      const map = {
        ...s.map,
        systems: { ...s.map.systems, [systemId]: { ...cur, ownerId } },
      };
      return bump(map, s.revision);
    }),

  toggleMarker: (systemId, markerId) =>
    set((s) => {
      const cur = s.map.systems[systemId];
      if (!cur) return {};
      const have = cur.markers ?? [];
      const markers = have.includes(markerId)
        ? have.filter((m) => m !== markerId)
        : [...have, markerId];
      const map = {
        ...s.map,
        systems: { ...s.map.systems, [systemId]: { ...cur, markers } },
      };
      return bump(map, s.revision);
    }),

  toggleHyperlane: (a, b) =>
    set((s) => {
      if (a === b) return {};
      const existing = Object.values(s.map.hyperlanes).find(
        (h) => (h.a === a && h.b === b) || (h.a === b && h.b === a)
      );
      const hyperlanes = { ...s.map.hyperlanes };
      if (existing) {
        delete hyperlanes[existing.id];
      } else {
        const id = makeId('hl');
        hyperlanes[id] = { id, a, b };
      }
      const map = { ...s.map, hyperlanes };
      return bump(map, s.revision);
    }),

  removeHyperlane: (id) =>
    set((s) => {
      const hyperlanes = { ...s.map.hyperlanes };
      delete hyperlanes[id];
      const map = { ...s.map, hyperlanes };
      return bump(map, s.revision);
    }),

  addEmpire: (opts) => {
    const id = makeId('emp');
    const existing = Object.keys(get().map.empires).length;
    const empire: Empire = {
      id,
      name: opts?.name ?? `Empire ${existing + 1}`,
      color: opts?.color ?? EMPIRE_PALETTE[existing % EMPIRE_PALETTE.length],
      capitalId: opts?.capitalId ?? null,
    };
    set((s) => {
      const map = { ...s.map, empires: { ...s.map.empires, [id]: empire } };
      return { ...bump(map, s.revision), activeEmpireId: id };
    });
    return id;
  },

  updateEmpire: (id, patch) =>
    set((s) => {
      const cur = s.map.empires[id];
      if (!cur) return {};
      const map = {
        ...s.map,
        empires: { ...s.map.empires, [id]: { ...cur, ...patch } },
      };
      return bump(map, s.revision);
    }),

  removeEmpire: (id) =>
    set((s) => {
      const empires = { ...s.map.empires };
      delete empires[id];
      // Un-own systems that belonged to this empire.
      const systems = { ...s.map.systems };
      for (const sys of Object.values(systems)) {
        if (sys.ownerId === id) systems[sys.id] = { ...sys, ownerId: null };
      }
      const map = { ...s.map, systems, empires };
      return {
        ...bump(map, s.revision),
        activeEmpireId:
          s.activeEmpireId === id
            ? Object.keys(empires)[0] ?? null
            : s.activeEmpireId,
      };
    }),
}));
