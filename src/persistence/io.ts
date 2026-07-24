import { GalaxyMap, MAP_VERSION } from '../model/types';
import { pointInPolygon } from '../util/geom';

const STORAGE_KEY = 'galactic-map:autosave';

/**
 * Bring an older map up to the current format.
 *
 * v1 had no nebulae, regions, objects or annotations; v2 had no reference
 * images; v3 drew sector boundaries by hand, where v4 derives them from which
 * systems belong. Everything added since is optional or defaulted, so most of
 * this is filling in empty collections — the exception is v3's drawn sectors,
 * which are converted rather than dropped.
 */
export function migrate(map: GalaxyMap): GalaxyMap {
  if (
    map.version >= MAP_VERSION &&
    map.nebulae &&
    map.annotations &&
    map.references
  ) {
    return map;
  }

  let systems = map.systems ?? {};

  // Before v4 a black hole was a whole-system type, and its size came from a
  // quirk — influence 0 meant "the galactic core", drawn huge. Now it is a
  // body with a size class like any other, so that quirk is written down
  // properly instead of being re-derived on every draw.
  if ((map.version ?? 0) < 4) {
    const next: GalaxyMap['systems'] = { ...systems };
    let touched = false;
    for (const s of Object.values(next)) {
      if (s.starType !== 'blackhole' || (s.stars && s.stars.length > 0)) continue;
      next[s.id] = {
        ...s,
        stars: [
          {
            type: 'blackhole',
            size: s.influence === 0 ? 'supergiant' : 'dwarf',
            jx: 0,
            jy: 0,
          },
        ],
      };
      touched = true;
    }
    if (touched) systems = next;
  }
  const regions: GalaxyMap['regions'] = { ...(map.regions ?? {}) };

  // A hand-drawn sector becomes a membership list: whatever was inside its
  // outline joins it. The author's intent survives even though the boundary
  // is now derived, and a sector that enclosed nothing keeps its label.
  const drawn = Object.values(regions).filter(
    (r) => Array.isArray(r.shape) && r.shape.length >= 3
  );
  if (drawn.length > 0) {
    const next: GalaxyMap['systems'] = { ...systems };
    for (const r of drawn) {
      for (const s of Object.values(next)) {
        if (!pointInPolygon(s.x, s.y, r.shape!)) continue;
        const have = next[s.id].sectors ?? [];
        if (have.includes(r.id)) continue;
        next[s.id] = { ...next[s.id], sectors: [...have, r.id] };
      }
      const { shape: _drop, ...rest } = r;
      regions[r.id] = {
        ...rest,
        fillAlpha: r.fillAlpha ?? 0.08,
        showFill: r.showFill ?? true,
        showName: r.showName ?? true,
      };
    }
    systems = next;
  }

  return {
    ...map,
    version: MAP_VERSION,
    systems,
    regions,
    nebulae: map.nebulae ?? {},
    objects: map.objects ?? {},
    annotations: map.annotations ?? {},
    references: map.references ?? {},
  };
}

export function isGalaxyMap(v: unknown): v is GalaxyMap {
  if (!v || typeof v !== 'object') return false;
  const m = v as Record<string, unknown>;
  return (
    typeof m.version === 'number' &&
    typeof m.systems === 'object' &&
    typeof m.hyperlanes === 'object' &&
    typeof m.empires === 'object'
  );
}

export function serialize(map: GalaxyMap): string {
  return JSON.stringify(map, null, 2);
}

export function exportToFile(map: GalaxyMap, filename = 'galaxy.json') {
  const blob = new Blob([serialize(map)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function importFromFile(file: File): Promise<GalaxyMap> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!isGalaxyMap(parsed)) {
          reject(new Error('File is not a valid galaxy map.'));
          return;
        }
        if (parsed.version > MAP_VERSION) {
          reject(new Error(`Unsupported map version ${parsed.version}.`));
          return;
        }
        resolve(migrate(parsed));
      } catch (e) {
        reject(e instanceof Error ? e : new Error('Failed to parse file.'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.readAsText(file);
  });
}

export function saveAutosave(map: GalaxyMap) {
  try {
    localStorage.setItem(STORAGE_KEY, serialize(map));
  } catch {
    // Ignore quota / privacy-mode failures.
  }
}

export function loadAutosave(): GalaxyMap | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isGalaxyMap(parsed) ? migrate(parsed) : null;
  } catch {
    return null;
  }
}
