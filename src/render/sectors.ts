import { GalaxyMap, MapRegion, Point, System } from '../model/types';
import { DisplaySettings, DEFAULT_DISPLAY } from '../model/display';
import { sectorSystems } from '../model/sectors';
import { traceMask, ringsArea, ringsCentroid } from '../util/polybool';
import { hexToRgb } from '../util/color';
import { Camera } from './camera';

/**
 * Sector boundaries, derived from membership.
 *
 * A sector is a set of systems, not a drawing, so its outline has to be
 * computed: each member is rasterised as a disc, the discs are merged into one
 * mask, and the mask's boundary is traced into smoothed world-space rings —
 * the same machinery the empire borders use, which is why the two look like
 * they belong on the same map. Islands and holes come out for free, so a
 * sector split across the galaxy simply gets two outlines.
 *
 * The result is cached against the collections it was built from, so panning
 * and zooming cost two path draws and an unrelated edit costs nothing.
 */

/** How far past a member system the boundary reaches, as a fraction of its influence. */
const REACH = 1.15;
/** Minimum reach in world units, so a zero-influence system still counts. */
const MIN_REACH = 26;
/** Cells across the longer side of the working area. */
const GRID = 420;

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

/** Rings enclosing a set of systems, or an empty array for none. */
export function hullOfSystems(list: readonly System[]): Point[][] {
  if (list.length === 0) return [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const reach = (s: System) => Math.max(MIN_REACH, s.influence * REACH);
  for (const s of list) {
    const r = reach(s);
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

  const mask = new Uint8Array(w * h);
  for (const s of list) {
    const r = reach(s);
    const r2 = r * r;
    // Only the cells the disc could possibly touch.
    const gx0 = Math.max(0, Math.floor((s.x - r - ox) / cell));
    const gx1 = Math.min(w - 1, Math.ceil((s.x + r - ox) / cell));
    const gy0 = Math.max(0, Math.floor((s.y - r - oy) / cell));
    const gy1 = Math.min(h - 1, Math.ceil((s.y + r - oy) / cell));
    for (let gy = gy0; gy <= gy1; gy++) {
      const wy = oy + (gy + 0.5) * cell - s.y;
      for (let gx = gx0; gx <= gx1; gx++) {
        const wx = ox + (gx + 0.5) * cell - s.x;
        if (wx * wx + wy * wy <= r2) mask[gy * w + gx] = 1;
      }
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
      const members = sectorSystems(map, r.id);
      if (members.length === 0) continue;
      const rings = hullOfSystems(members);
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
