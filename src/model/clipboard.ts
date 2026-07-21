import { GalaxyMap, System, ID } from './types';

export const CLIP_KIND = 'galactic-map/clip@1';

/**
 * A detached copy of part of the map. Hyperlanes are stored as index pairs into
 * `systems` so the clip stays valid after ids are remapped on paste.
 */
export interface Clip {
  kind: typeof CLIP_KIND;
  systems: System[];
  lanes: [number, number][];
  /** centre of the copied systems, used to place the paste under the cursor */
  cx: number;
  cy: number;
}

export function makeClip(map: GalaxyMap, ids: readonly ID[]): Clip | null {
  const systems = ids.map((id) => map.systems[id]).filter(Boolean) as System[];
  if (systems.length === 0) return null;

  const index = new Map<ID, number>();
  systems.forEach((s, i) => index.set(s.id, i));

  const lanes: [number, number][] = [];
  for (const h of Object.values(map.hyperlanes)) {
    const a = index.get(h.a);
    const b = index.get(h.b);
    if (a !== undefined && b !== undefined) lanes.push([a, b]);
  }

  let cx = 0;
  let cy = 0;
  for (const s of systems) {
    cx += s.x;
    cy += s.y;
  }
  return {
    kind: CLIP_KIND,
    // Deep-ish copy so later edits to the map don't mutate the clip.
    systems: systems.map((s) => ({
      ...s,
      markers: s.markers ? [...s.markers] : [],
      stars: s.stars ? s.stars.map((b) => ({ ...b })) : undefined,
    })),
    lanes,
    cx: cx / systems.length,
    cy: cy / systems.length,
  };
}

export function parseClip(text: string): Clip | null {
  try {
    const v = JSON.parse(text);
    if (
      v &&
      v.kind === CLIP_KIND &&
      Array.isArray(v.systems) &&
      v.systems.length > 0 &&
      Array.isArray(v.lanes)
    ) {
      return v as Clip;
    }
  } catch {
    // Not our clipboard payload — ignore.
  }
  return null;
}
