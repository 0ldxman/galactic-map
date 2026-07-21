import { GalaxyMap, System, Empire, Hyperlane, MAP_VERSION } from '../model/types';
import { makeStarCluster } from '../model/stars';
import { Rng, makeId } from '../util/rng';
import { GalaxyShape, densityAt, CORE_OUTER, GAP_OUTER } from './shapes';
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

  // Cut any hyperlane that would bridge the empty gap, keeping the black-hole
  // core isolated from the rest of the galaxy.
  const gapCut = radius * (CORE_OUTER + GAP_OUTER) / 2;
  const isCore = points.map((p) => Math.hypot(p.x, p.y) < gapCut);
  const rawEdges = buildGraph(points, rng);
  const edges = rawEdges.filter(([a, b]) => isCore[a] === isCore[b]);

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

  const influence = minDist * 1.2;
  const systems: Record<string, System> = {};
  const systemIds: string[] = [];
  for (let i = 0; i < points.length; i++) {
    const id = makeId('sys');
    systemIds.push(id);
    const ownerIdx = owner[i];
    const stars = makeStarCluster(() => rng.float());
    systems[id] = {
      id,
      name: systemName(rng),
      x: points[i].x,
      y: points[i].y,
      starType: stars[0].type,
      ownerId: ownerIdx >= 0 ? empireIds[ownerIdx] : null,
      influence,
      stars,
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

  // The supermassive black hole at the galactic centre. Influence 0 so it never
  // claims territory; it just anchors the core visually.
  const bhId = makeId('sys');
  systems[bhId] = {
    id: bhId,
    name: 'Galactic Core',
    x: 0,
    y: 0,
    starType: 'blackhole',
    ownerId: null,
    influence: 0,
  };

  return {
    version: MAP_VERSION,
    seed,
    systems,
    hyperlanes,
    empires,
  };
}
