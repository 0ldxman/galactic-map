import { GalaxyMap, System, Empire, Hyperlane, StarType, MAP_VERSION } from '../model/types';
import { Rng, makeId } from '../util/rng';
import { GalaxyShape, densityAt } from './shapes';
import { poissonDisk } from './poisson';
import { buildGraph } from './graph';
import { assignEmpires } from './empires';
import { systemName, empireName } from './names';

export interface GenerateParams {
  seed: number;
  shape: GalaxyShape;
  systemCount: number;
  empireCount: number;
  arms?: number;
  radius?: number;
}

const STAR_TYPES: StarType[] = ['yellow', 'red', 'blue', 'white', 'neutron', 'blackhole'];
const STAR_WEIGHTS = [30, 34, 12, 14, 6, 4];

export function generateGalaxy(params: GenerateParams): GalaxyMap {
  const {
    seed,
    shape,
    systemCount,
    empireCount,
    arms = 3,
    radius = 1000,
  } = params;

  const rng = new Rng(seed);
  const shapeParams = { shape: shape as GalaxyShape, radius, arms };

  // Spacing chosen so `systemCount` points roughly fill the galaxy disc.
  const minDist = Math.max(18, (radius * 1.7) / Math.sqrt(systemCount));
  const points = poissonDisk(
    radius,
    minDist,
    (x, y) => densityAt(x, y, shapeParams, rng),
    rng,
    systemCount
  );

  const edges = buildGraph(points, rng);
  const { capitals, owner } = assignEmpires(points, edges, empireCount, rng);

  // Build empires first so systems can reference them.
  const empires: Record<string, Empire> = {};
  const empireIds: string[] = [];
  const EMPIRE_PALETTE = [
    '#e0483d', '#3d8ee0', '#49c26b', '#e0b23d', '#a34fe0',
    '#e0733d', '#3dd6c2', '#e03d94', '#7ac23d', '#5a5fe0',
  ];
  for (let e = 0; e < capitals.length; e++) {
    const id = makeId('emp');
    empireIds.push(id);
    empires[id] = {
      id,
      name: empireName(rng),
      color: EMPIRE_PALETTE[e % EMPIRE_PALETTE.length],
      capitalId: null, // filled after systems exist
    };
  }

  const influence = minDist * 1.45;
  const systems: Record<string, System> = {};
  const systemIds: string[] = [];
  for (let i = 0; i < points.length; i++) {
    const id = makeId('sys');
    systemIds.push(id);
    const ownerIdx = owner[i];
    systems[id] = {
      id,
      name: systemName(rng),
      x: points[i].x,
      y: points[i].y,
      starType: rng.weighted(STAR_TYPES, STAR_WEIGHTS),
      ownerId: ownerIdx >= 0 ? empireIds[ownerIdx] : null,
      influence,
    };
  }

  // Link capitals now that system ids exist.
  for (let e = 0; e < capitals.length; e++) {
    empires[empireIds[e]].capitalId = systemIds[capitals[e]];
  }

  const hyperlanes: Record<string, Hyperlane> = {};
  for (const [a, b] of edges) {
    const id = makeId('hl');
    hyperlanes[id] = { id, a: systemIds[a], b: systemIds[b] };
  }

  return {
    version: MAP_VERSION,
    seed,
    systems,
    hyperlanes,
    empires,
  };
}
