import { Rng } from '../util/rng';

export type GalaxyShape = 'spiral' | 'elliptical' | 'ring';

export interface ShapeParams {
  shape: GalaxyShape;
  /** world-space radius of the galaxy */
  radius: number;
  arms?: number;
}

/**
 * Galactic-core geometry (fractions of the galaxy radius). A small dense core
 * cluster sits at the centre, ringed by an empty gap that isolates it from the
 * rest of the galaxy — the supermassive black hole region, Stellaris-style.
 */
export const CORE_OUTER = 0.085; // core cluster reaches out to here
export const GAP_OUTER = 0.185; // empty separating ring ends here
const HOLE_INNER = 0.022; // kept clear right around the black hole itself

/**
 * Density in [0, 1] describing how likely a system is to exist at world
 * position (x, y), with the galaxy centred on the origin. Used as an
 * acceptance probability during Poisson sampling.
 */
export function densityAt(
  x: number,
  y: number,
  p: ShapeParams,
  rng: Rng
): number {
  const R = p.radius;
  const dist = Math.hypot(x, y);
  if (dist > R) return 0;
  const rNorm = dist / R; // 0 at centre, 1 at edge

  // Carve the central core cluster and the empty gap that isolates it.
  if (rNorm < HOLE_INNER) return 0; // black hole's immediate vicinity
  if (rNorm < CORE_OUTER) return 0.7 * (0.85 + rng.float() * 0.3); // core cluster
  if (rNorm < GAP_OUTER) return 0; // separating gap

  switch (p.shape) {
    case 'elliptical': {
      // Dense core fading smoothly outward.
      return Math.pow(1 - rNorm, 1.4);
    }
    case 'ring': {
      // Peak at ~0.6 R, hole in the middle.
      const band = Math.exp(-Math.pow((rNorm - 0.62) / 0.22, 2));
      return band;
    }
    case 'spiral':
    default: {
      const arms = p.arms ?? 3;
      const angle = Math.atan2(y, x);
      // Logarithmic spiral: expected arm angle at this radius.
      const twist = 3.2;
      const armAngle = twist * Math.log(rNorm * 6 + 1);
      // Distance (in angle) to the nearest arm.
      let best = Infinity;
      for (let i = 0; i < arms; i++) {
        const target = armAngle + (i * 2 * Math.PI) / arms;
        let d = ((angle - target) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
        best = Math.min(best, Math.abs(d));
      }
      // Arms get fuzzier toward the edge.
      const armWidth = 0.5 + rNorm * 0.7;
      const arm = Math.exp(-Math.pow(best / armWidth, 2));
      const core = Math.exp(-Math.pow(rNorm / 0.18, 2)) * 0.9; // bright bulge
      const falloff = 1 - rNorm * 0.15;
      // A little noise so arms aren't razor-clean.
      const noise = 0.85 + rng.float() * 0.3;
      return Math.min(1, (arm * falloff + core) * noise);
    }
  }
}
