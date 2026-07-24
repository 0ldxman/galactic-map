import { GalaxyMap, MapRegion, Point, System } from '../model/types';
import { DisplaySettings, DEFAULT_DISPLAY } from '../model/display';
import { sectorPartition } from '../model/sectors';
import { traceMask, ringsArea, ringsCentroid } from '../util/polybool';
import { hexToRgb } from '../util/color';
import { Camera } from './camera';

/**
 * Sector boundaries, derived from membership.
 *
 * A sector is a set of systems, not a drawing, so its outline has to be
 * computed. Each member claims the space around it out to its influence, the
 * claims are merged, and the boundary of what is left is traced into smoothed
 * world-space rings — the same machinery the empire borders use, which is why
 * the two look like they belong on the same map. Islands and holes come out for
 * free, so a sector split across the galaxy simply gets two outlines.
 *
 * Crucially, systems *outside* the sector compete for that space too, exactly
 * as unclaimed systems compete with the empires: a non-member wins the cells
 * nearest to itself, and nothing is ever drawn for it. The boundary therefore
 * falls between a member and its nearest outside neighbour rather than washing
 * over it, which is what keeps a sector from swallowing half the map because
 * one of its systems has a wide influence.
 *
 * The result is cached against the collections it was built from, so panning
 * and zooming cost two path draws and an unrelated edit costs nothing.
 */

/** How far past a system the boundary reaches, as a fraction of its influence. */
const REACH = 1.15;
/** Minimum reach in world units, so a zero-influence system still counts. */
const MIN_REACH = 26;
/** Cells across the longer side of the working area. */
const GRID = 420;

/** How far one system's claim carries, in world units. */
function reachOf(s: System): number {
  return Math.max(MIN_REACH, s.influence * REACH);
}

export interface SectorShape {
  id: string;
  rings: Point[][];
  path: Path2D;
  /** area centroid — where the name goes */
  cx: number;
  cy: number;
  /** enclosed area in world units squared, which drives the label size */
  area: number;
  members: number;
}

/**
 * Rings enclosing a set of systems, or an empty array for none.
 *
 * `others` are the systems that must be kept outside: they take the cells they
 * are nearest to (measured in the same falloff, so a bigger neighbour takes
 * more), and the rings are traced around what the members are left holding. At
 * a system's own position its claim is 1 — the maximum — so a member can never
 * be argued out of its own cell, however large the neighbour.
 */
export function hullOfSystems(
  list: readonly System[],
  others: readonly System[] = []
): Point[][] {
  if (list.length === 0) return [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of list) {
    const r = reachOf(s);
    if (s.x - r < minX) minX = s.x - r;
    if (s.y - r < minY) minY = s.y - r;
    if (s.x + r > maxX) maxX = s.x + r;
    if (s.y + r > maxY) maxY = s.y + r;
  }
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const cell = Math.max(spanX, spanY) / GRID || 1;
  const pad = 2;
  const ox = minX - pad * cell;
  const oy = minY - pad * cell;
  const w = Math.ceil(spanX / cell) + pad * 2 + 1;
  const h = Math.ceil(spanY / cell) + pad * 2 + 1;
  if (w * h > 4_000_000) return [];

  /** Strongest claim on each cell, written only where it beats what is there. */
  const paint = (src: readonly System[], out: Float32Array) => {
    for (const s of src) {
      const r = reachOf(s);
      // Only the cells this system could possibly reach.
      const gx0 = Math.max(0, Math.floor((s.x - r - ox) / cell));
      const gx1 = Math.min(w - 1, Math.ceil((s.x + r - ox) / cell));
      const gy0 = Math.max(0, Math.floor((s.y - r - oy) / cell));
      const gy1 = Math.min(h - 1, Math.ceil((s.y + r - oy) / cell));
      for (let gy = gy0; gy <= gy1; gy++) {
        const wy = oy + (gy + 0.5) * cell - s.y;
        for (let gx = gx0; gx <= gx1; gx++) {
          const wx = ox + (gx + 0.5) * cell - s.x;
          const d = Math.sqrt(wx * wx + wy * wy);
          if (d >= r) continue;
          const v = 1 - d / r;
          const p = gy * w + gx;
          if (v > out[p]) out[p] = v;
        }
      }
    }
  };

  const mine = new Float32Array(w * h);
  paint(list, mine);

  const mask = new Uint8Array(w * h);
  if (others.length === 0) {
    for (let p = 0; p < mask.length; p++) mask[p] = mine[p] > 0 ? 1 : 0;
  } else {
    const rival = new Float32Array(w * h);
    // Only outsiders that can reach the working area are worth painting.
    paint(
      others.filter((s) => {
        const r = reachOf(s);
        return (
          s.x + r > ox && s.x - r < ox + w * cell &&
          s.y + r > oy && s.y - r < oy + h * cell
        );
      }),
      rival
    );
    // A tie goes to the member: two systems of equal influence split the gap
    // between them down the middle, which is where the eye expects the line.
    for (let p = 0; p < mask.length; p++) {
      mask[p] = mine[p] > 0 && mine[p] >= rival[p] ? 1 : 0;
    }
  }
  return traceMask(mask, w, h, ox, oy, cell, 4);
}

export class SectorRenderer {
  private shapes: SectorShape[] = [];
  private sysRef: unknown = null;
  private regRef: unknown = null;
  private built = false;
  private lastBuild = 0;
  pending = false;

  /** Rebuild the cached outlines if the map changed (throttled; skippable). */
  update(map: GalaxyMap, defer = false) {
    if (map.systems === this.sysRef && map.regions === this.regRef) {
      this.pending = false;
      return;
    }
    if (defer) {
      this.pending = true;
      return;
    }
    const now = performance.now();
    if (this.built && now - this.lastBuild < 120) {
      this.pending = true;
      return;
    }
    this.pending = false;
    this.lastBuild = now;
    this.sysRef = map.systems;
    this.regRef = map.regions;
    this.built = true;
    this.build(map);
  }

  private build(map: GalaxyMap) {
    this.shapes = [];
    for (const r of Object.values(map.regions)) {
      const { members, others } = sectorPartition(map, r.id);
      if (members.length === 0) continue;
      const rings = hullOfSystems(members, others);
      if (rings.length === 0) continue;
      const path = new Path2D();
      for (const ring of rings) {
        path.moveTo(ring[0].x, ring[0].y);
        for (let i = 1; i < ring.length; i++) path.lineTo(ring[i].x, ring[i].y);
        path.closePath();
      }
      const c = ringsCentroid(rings);
      this.shapes.push({
        id: r.id,
        rings,
        path,
        cx: c.x,
        cy: c.y,
        area: ringsArea(rings),
        members: members.length,
      });
    }
    // Biggest first, so a small sector drawn inside a large one stays on top.
    this.shapes.sort((a, b) => b.area - a.area);
  }

  /** The cached shape of a sector, if it currently has one. */
  shapeOf(id: string): SectorShape | undefined {
    return this.shapes.find((s) => s.id === id);
  }

  get all(): readonly SectorShape[] {
    return this.shapes;
  }

  /** Fill and outline the sectors under the camera transform. */
  draw(
    ctx: CanvasRenderingContext2D,
    map: GalaxyMap,
    cam: Camera,
    selectedId?: string | null,
    dsp: DisplaySettings = DEFAULT_DISPLAY
  ) {
    if (this.shapes.length === 0) return;
    const z = cam.zoom;
    ctx.save();
    ctx.translate(cam.viewW / 2 - cam.x * z, cam.viewH / 2 - cam.y * z);
    ctx.scale(z, z);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    for (const sh of this.shapes) {
      const r = map.regions[sh.id];
      if (!r) continue;
      const [cr, cg, cb] = hexToRgb(r.color ?? '#c9d6f2');
      const fill = r.showFill === false ? 0 : r.fillAlpha ?? 0.08;
      if (fill > 0) {
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${fill})`;
        ctx.fill(sh.path, 'evenodd');
      }
      const on = sh.id === selectedId;
      ctx.strokeStyle = `rgba(${cr},${cg},${cb},${on ? 0.95 : 0.55})`;
      // Dashed, and held at a constant size on screen: a sector boundary is
      // chart notation, like the empire border width, not a thing in space.
      ctx.lineWidth = ((on ? 2.2 : 1.4) * dsp.borderWidth) / 2 / z;
      ctx.setLineDash([9 / z, 6 / z]);
      ctx.stroke(sh.path);
      ctx.setLineDash([]);
    }
    ctx.restore();
  }
}

/**
 * Where a sector's name goes and how big it is, in world units.
 *
 * With members, the label sits at the centre of the derived area and is sized
 * from it — exactly how empire labels work, so the two fade together as you
 * zoom and a big sector always reads bigger. Without members the sector is
 * just a label at its stored position and its stored size.
 */
export function sectorLabel(
  r: MapRegion,
  shape: SectorShape | undefined
): { x: number; y: number; size: number } {
  if (!shape) return { x: r.x, y: r.y, size: r.size };
  const worldR = Math.sqrt(shape.area / Math.PI);
  const nameLen = Math.max(5, r.name.length);
  // The same falloff the empire labels use, scaled by the author's size knob
  // (which is stored as a world height, so it is normalised against 70).
  const derived = ((worldR * 2.4) / Math.pow(nameLen, 0.82)) * (r.size / 70);
  return { x: shape.cx, y: shape.cy, size: Math.max(4, derived) };
}

/**
 * The sector shapes the on-screen map is drawn with. Shared, like `liveCamera`,
 * so a panel can ask "where is this sector" without owning a renderer or
 * recomputing a hull the canvas has already built this frame.
 */
export const sectorRenderer = new SectorRenderer();
