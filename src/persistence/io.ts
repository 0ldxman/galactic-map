import { GalaxyMap, MAP_VERSION } from '../model/types';

const STORAGE_KEY = 'galactic-map:autosave';

/**
 * Bring an older map up to the current format. v1 had no nebulae, regions,
 * objects or annotations; everything added since is optional or defaulted, so
 * the migration is just filling in the empty collections.
 */
export function migrate(map: GalaxyMap): GalaxyMap {
  if (map.version >= MAP_VERSION && map.nebulae && map.annotations) return map;
  return {
    ...map,
    version: MAP_VERSION,
    nebulae: map.nebulae ?? {},
    regions: map.regions ?? {},
    objects: map.objects ?? {},
    annotations: map.annotations ?? {},
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
