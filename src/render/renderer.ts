import {
  GalaxyMap,
  STAR_COLORS,
  StarType,
  System,
  Annotation,
} from '../model/types';
import { MARKER_BY_ID } from '../model/markers';
import { OBJECT_BY_ID } from '../model/objects';
import { normalizeStars, starBaseOffset, STAR_SIZE_BY_ID } from '../model/stars';
import { DisplaySettings, resolveDisplay } from '../model/display';
import { EntityRef } from '../model/store';
import { Camera } from './camera';
import { TerritoryRenderer } from './territories';
import { NebulaRenderer } from './nebulae';
import { drawObjectIcon } from './icons';
import { mulberry32 } from '../util/rng';

/** Screen-space rectangle of an in-progress rubber-band selection. */
export interface Marquee {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface RenderOptions {
  /** ids of every selected system */
  selection: readonly string[];
  /** the selected nebula / region / object / annotation, if any */
  selectedEntity?: EntityRef | null;
  connectFromId: string | null;
  /** live preview of an annotation being drawn */
  draftAnnotation?: Annotation | null;
  /** brush circle to show while the nebula tool is active */
  brush?: { x: number; y: number; r: number } | null;
  /** other people in the room, at their last reported world position */
  peers?: readonly {
    id: string;
    name: string;
    color: string;
    cursor?: { x: number; y: number };
  }[];
  /** true while dragging a system: skip the (costly) border rebuild until drop */
  deferTerritory?: boolean;
  /** leave the background empty (image export with a transparent backdrop) */
  transparent?: boolean;
  /** live rubber-band rectangle, in screen px */
  marquee?: Marquee | null;
  /** live freehand lasso, in screen px */
  lasso?: readonly { x: number; y: number }[] | null;
  /** region boundary being drawn, in world coordinates */
  draftRegion?: readonly { x: number; y: number }[] | null;
}

interface BgStar {
  x: number;
  y: number;
  r: number;
  a: number;
  color: string;
}

const EMPIRE_LABEL_FONT = `700 %PXpx Tektur, 'Tektur', system-ui, sans-serif`;
const REGION_LABEL_FONT = `400 %PXpx Tektur, 'Tektur', system-ui, sans-serif`;

/** Apply an alpha to a hex colour, for label fades. */
function withAlpha(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(
    h.length === 3 ? h.split('').map((c) => c + c).join('') : h,
    16
  );
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export class Renderer {
  readonly territory = new TerritoryRenderer();
  readonly nebulae = new NebulaRenderer();
  private bgStars: BgStar[] = [];
  // Pre-rendered soft glow sprite per star colour (drawn additively per star).
  private glowSprites: Record<string, HTMLCanvasElement> = {};

  constructor() {
    for (const [type, color] of Object.entries(STAR_COLORS)) {
      if (type === 'blackhole') continue;
      this.glowSprites[type] = makeGlowSprite(color);
    }

    // A cool, sparse starfield in world space (parallaxes with the map).
    const rnd = mulberry32(1234567);
    const span = 4200;
    const tints = ['#dfe8ff', '#cfe0ff', '#ffffff', '#ffffff', '#e8eeff', '#fff4e0'];
    for (let i = 0; i < 1300; i++) {
      const bright = rnd() < 0.05;
      this.bgStars.push({
        x: (rnd() - 0.5) * 2 * span,
        y: (rnd() - 0.5) * 2 * span,
        r: bright ? rnd() * 1.4 + 1.0 : rnd() * 0.9 + 0.3,
        a: bright ? rnd() * 0.4 + 0.5 : rnd() * 0.4 + 0.1,
        color: tints[(rnd() * tints.length) | 0],
      });
    }
  }

  draw(ctx: CanvasRenderingContext2D, map: GalaxyMap, cam: Camera, opts: RenderOptions) {
    const { viewW: w, viewH: h } = cam;
    const dsp = resolveDisplay(map.display);

    if (!opts.transparent) this.drawBackground(ctx, cam, dsp);

    // Nebulae sit under everything political — they are the terrain.
    this.nebulae.update(map.nebulae, opts.deferTerritory, dsp);
    if (dsp.showNebulae) this.nebulae.draw(ctx, cam);

    if (dsp.showGrid) this.drawGrid(ctx, cam);
    if (dsp.showAnnotations) this.drawAnnotations(ctx, map, cam, 'below', opts);

    const systems = Object.values(map.systems);

    // Territory borders (rebuilt only when the map changes; drawn as vectors).
    this.territory.update(map.systems, map.empires, opts.deferTerritory, dsp);
    if (dsp.showTerritories) this.territory.draw(ctx, cam);

    // Region boundaries: chart notation drawn over the political fill, under
    // the stars, so a sector reads as a line on the map rather than terrain.
    if (dsp.showRegions) this.drawRegionAreas(ctx, map, cam, opts);

    // --- Systems: cull to the viewport once, reuse the screen positions. ---
    const margin = 30;
    type SP = { s: System; p: { x: number; y: number } };
    const buckets = new Map<string, SP[]>();
    const capitals: SP[] = [];
    const blackholes: SP[] = [];
    const onScreen: SP[] = [];

    for (const s of systems) {
      const p = cam.worldToScreen(s.x, s.y);
      if (p.x < -margin || p.x > w + margin || p.y < -margin || p.y > h + margin) continue;
      const sp = { s, p };
      onScreen.push(sp);
      if (s.starType === 'blackhole') { blackholes.push(sp); continue; }
      const isCapital = map.empires[s.ownerId ?? '']?.capitalId === s.id;
      if (isCapital) { capitals.push(sp); continue; }
      const arr = buckets.get(s.starType) ?? [];
      arr.push(sp);
      buckets.set(s.starType, arr);
    }

    // Hyperlanes — thin schematic lines, skipping any fully off-screen.
    if (dsp.showHyperlanes) {
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(140,175,220,0.20)';
      ctx.beginPath();
      for (const hl of Object.values(map.hyperlanes)) {
        const a = map.systems[hl.a];
        const b = map.systems[hl.b];
        if (!a || !b) continue;
        const pa = cam.worldToScreen(a.x, a.y);
        const pb = cam.worldToScreen(b.x, b.y);
        if (pa.x < -margin && pb.x < -margin) continue;
        if (pa.x > w + margin && pb.x > w + margin) continue;
        if (pa.y < -margin && pb.y < -margin) continue;
        if (pa.y > h + margin && pb.y > h + margin) continue;
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
      }
      ctx.stroke();
    }

    // Star dots. Each star has its own type (colour) & size. Sizes & the cluster
    // layout live in WORLD units and are scaled by zoom, so stars grow when you
    // move in and shrink into specks when you pull the camera out — like real
    // objects gaining/losing apparent size with distance.
    const bodyBuckets = new Map<StarType, number[]>();
    for (const list of buckets.values()) {
      for (const sp of list) {
        for (const pos of layoutStars(sp, STAR_WORLD_R, cam.zoom)) {
          let arr = bodyBuckets.get(pos.type);
          if (!arr) { arr = []; bodyBuckets.set(pos.type, arr); }
          arr.push(pos.x, pos.y, pos.r);
        }
      }
    }
    // Additive glow halo under the cores (only for stars big enough on screen
    // to warrant it — far-out specks skip it, which keeps this cheap).
    if (dsp.showStarGlow) {
      ctx.globalCompositeOperation = 'lighter';
      for (const [type, flat] of bodyBuckets) {
        const sprite = this.glowSprites[type];
        if (!sprite) continue;
        for (let i = 0; i < flat.length; i += 3) {
          const r = flat[i + 2];
          if (r < GLOW_MIN) continue;
          const gr = r * GLOW_SCALE;
          ctx.drawImage(sprite, flat[i] - gr, flat[i + 1] - gr, gr * 2, gr * 2);
        }
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    // Bright cores, one path per colour.
    for (const [type, flat] of bodyBuckets) {
      ctx.fillStyle = STAR_COLORS[type];
      ctx.beginPath();
      for (let i = 0; i < flat.length; i += 3) {
        const x = flat[i], y = flat[i + 1], r = flat[i + 2];
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, Math.PI * 2);
      }
      ctx.fill();
    }

    // Capitals: their own (brighter) cluster + a ring around the centre.
    for (const sp of capitals) {
      const dots = layoutStars(sp, CAPITAL_WORLD_R, cam.zoom);
      if (dsp.showStarGlow) {
        ctx.globalCompositeOperation = 'lighter';
        for (const d of dots) {
          if (d.r < GLOW_MIN) continue;
          const sprite = this.glowSprites[d.type];
          if (!sprite) continue;
          const gr = d.r * GLOW_SCALE;
          ctx.drawImage(sprite, d.x - gr, d.y - gr, gr * 2, gr * 2);
        }
        ctx.globalCompositeOperation = 'source-over';
      }
      for (const d of dots) {
        ctx.fillStyle = STAR_COLORS[d.type];
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(sp.p.x, sp.p.y, 7, 0, Math.PI * 2);
      ctx.stroke();
    }

    for (const { s, p } of blackholes) {
      this.drawBlackHole(ctx, p.x, p.y, cam.zoom, s.influence === 0);
    }

    // Selection / pending-connection highlight.
    const selected = new Set(opts.selection);
    for (const { s, p } of onScreen) {
      const isSel = selected.has(s.id);
      if (!isSel && s.id !== opts.connectFromId) continue;
      ctx.strokeStyle = s.id === opts.connectFromId ? '#ffe27a' : '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
      ctx.stroke();
    }

    // --- System markers: little icon badges above the star. ---
    const markOp = dsp.showMarkers
      ? clamp((cam.zoom - 0.6) / (1.0 - 0.6), 0, 1)
      : 0;
    if (markOp > 0.02) {
      this.drawMarkers(ctx, onScreen, markOp);
    }

    // --- System name cards: only well zoomed in, faded via opacity. ---
    const z0 = dsp.systemNameZoom;
    const sysOp = dsp.showSystemNames
      ? clamp((cam.zoom - z0) / (z0 * 1.45 - z0), 0, 1)
      : 0;
    if (sysOp > 0.02) {
      this.drawSystemCards(ctx, onScreen, sysOp);
    }

    // --- Objects, annotations and the named regions on top. ---
    if (dsp.showObjects) this.drawObjects(ctx, map, cam, opts);
    if (dsp.showAnnotations) this.drawAnnotations(ctx, map, cam, 'above', opts);

    // --- Empire labels at region centroids (main territory + each enclave). ---
    if (dsp.showEmpireNames) this.drawEmpireLabels(ctx, map, cam, dsp);
    if (dsp.showRegions) this.drawRegionLabels(ctx, map, cam, opts);
    if (dsp.showNebulae) this.drawNebulaLabels(ctx, map, cam);

    if (opts.brush) {
      ctx.strokeStyle = 'rgba(200,215,255,0.7)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(opts.brush.x, opts.brush.y, opts.brush.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (opts.peers?.length) this.drawPeers(ctx, cam, opts.peers);
    if (opts.marquee) this.drawMarquee(ctx, opts.marquee);
    if (opts.lasso && opts.lasso.length > 1) this.drawLasso(ctx, opts.lasso);
  }

  /** Co-editors' pointers, so you can see where everyone is working. */
  private drawPeers(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    peers: NonNullable<RenderOptions['peers']>
  ) {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '11px system-ui, sans-serif';
    for (const p of peers) {
      if (!p.cursor) continue;
      const s = cam.worldToScreen(p.cursor.x, p.cursor.y);
      if (s.x < -50 || s.y < -50 || s.x > cam.viewW + 50 || s.y > cam.viewH + 50) {
        continue;
      }
      ctx.fillStyle = p.color;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x, s.y + 13);
      ctx.lineTo(s.x + 4, s.y + 9.5);
      ctx.lineTo(s.x + 9, s.y + 9);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      const w = ctx.measureText(p.name).width + 10;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.roundRect(s.x + 11, s.y + 4, w, 15, 4);
      ctx.fill();
      ctx.fillStyle = '#0b0e18';
      ctx.fillText(p.name, s.x + 16, s.y + 12);
    }
    ctx.textBaseline = 'alphabetic';
  }

  /** Special objects: link arcs first, then icons, then names. */
  private drawObjects(
    ctx: CanvasRenderingContext2D,
    map: GalaxyMap,
    cam: Camera,
    opts: RenderOptions
  ) {
    const objects = Object.values(map.objects);
    if (objects.length === 0) return;
    const { viewW: w, viewH: h } = cam;
    const sel =
      opts.selectedEntity?.c === 'objects' ? opts.selectedEntity.id : null;

    // Paired links: a bowed dashed arc, clearly not a hyperlane.
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 1.2;
    for (const o of objects) {
      if (!o.linkedId) continue;
      const other = map.objects[o.linkedId];
      // Draw each pair once.
      if (!other || other.id < o.id) continue;
      const a = cam.worldToScreen(o.x, o.y);
      const b = cam.worldToScreen(other.x, other.y);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      // Bow the arc perpendicular to the chord.
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const bow = Math.min(90, len * 0.18);
      const cx = mx - (dy / len) * bow;
      const cy = my + (dx / len) * bow;
      ctx.strokeStyle = (OBJECT_BY_ID[o.kind]?.color ?? '#b58cff') + 'aa';
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(cx, cy, b.x, b.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    const iconR = clamp(7 * Math.sqrt(cam.zoom), 4, 22);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const showNames = cam.zoom > 0.9;
    ctx.font = '10px system-ui, sans-serif';
    for (const o of objects) {
      const p = cam.worldToScreen(o.x, o.y);
      if (p.x < -30 || p.x > w + 30 || p.y < -30 || p.y > h + 30) continue;
      const type = OBJECT_BY_ID[o.kind];
      const color = o.color ?? type?.color ?? '#cfd8ff';
      if (o.id === sel) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, iconR * 1.5, 0, Math.PI * 2);
        ctx.stroke();
      }
      drawObjectIcon(ctx, o.kind, p.x, p.y, iconR, color);
      if (showNames && o.name) {
        ctx.fillStyle = 'rgba(214,224,244,0.8)';
        ctx.fillText(o.name, p.x, p.y + iconR + 8);
      }
    }
    ctx.textBaseline = 'alphabetic';
  }

  /**
   * The outlined kind of region: a drawn boundary with a faint wash inside.
   * Regions that are only a label have no `shape` and are skipped here.
   */
  private drawRegionAreas(
    ctx: CanvasRenderingContext2D,
    map: GalaxyMap,
    cam: Camera,
    opts: RenderOptions
  ) {
    const sel =
      opts.selectedEntity?.c === 'regions' ? opts.selectedEntity.id : null;
    const shapes: { pts: readonly { x: number; y: number }[]; color: string; fill: number; selected: boolean }[] = [];
    for (const r of Object.values(map.regions)) {
      if (!r.shape || r.shape.length < 3) continue;
      shapes.push({
        pts: r.shape,
        color: r.color ?? '#c9d6f2',
        fill: r.fillAlpha ?? 0.1,
        selected: r.id === sel,
      });
    }
    if (opts.draftRegion && opts.draftRegion.length >= 2) {
      shapes.push({ pts: opts.draftRegion, color: '#9fb4ff', fill: 0.08, selected: true });
    }
    if (shapes.length === 0) return;

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const s of shapes) {
      ctx.beginPath();
      for (let i = 0; i < s.pts.length; i++) {
        const p = cam.worldToScreen(s.pts[i].x, s.pts[i].y);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      if (s.fill > 0) {
        ctx.fillStyle = withAlpha(s.color, s.fill);
        ctx.fill();
      }
      ctx.strokeStyle = withAlpha(s.color, s.selected ? 0.95 : 0.5);
      ctx.lineWidth = s.selected ? 2 : 1.2;
      ctx.setLineDash([9, 6]);
      ctx.stroke();
      ctx.setLineDash([]);

      if (s.selected) {
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.lineWidth = 1;
        for (const w of s.pts) {
          const p = cam.worldToScreen(w.x, w.y);
          ctx.beginPath();
          ctx.rect(p.x - 3, p.y - 3, 6, 6);
          ctx.fill();
          ctx.stroke();
        }
      }
    }
  }

  /** Sparse wide labels for named sectors and clusters. */
  private drawRegionLabels(
    ctx: CanvasRenderingContext2D,
    map: GalaxyMap,
    cam: Camera,
    opts: RenderOptions
  ) {
    const regions = Object.values(map.regions);
    if (regions.length === 0) return;
    const sel =
      opts.selectedEntity?.c === 'regions' ? opts.selectedEntity.id : null;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const r of regions) {
      const fontPx = r.size * cam.zoom;
      if (fontPx < 4) continue;
      const p = cam.worldToScreen(r.x, r.y);
      ctx.font = REGION_LABEL_FONT.replace('%PX', fontPx.toFixed(1));
      ctx.letterSpacing = `${(r.spacing ?? 0.35) * fontPx}px`;
      const op = clamp((fontPx - 4) / 6, 0, 1) * 0.75;
      ctx.fillStyle = withAlpha(r.color ?? '#c9d6f2', op);
      ctx.fillText(r.name, p.x, p.y);
      // An outlined region already shows its selection as a highlighted
      // boundary; only a bare label needs a box drawn round the text.
      if (r.id === sel && !r.shape) {
        const wdt = ctx.measureText(r.name).width;
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(p.x - wdt / 2 - 6, p.y - fontPx * 0.75, wdt + 12, fontPx * 1.5);
        ctx.setLineDash([]);
      }
      ctx.letterSpacing = '0px';
    }
    ctx.textBaseline = 'alphabetic';
  }

  private drawNebulaLabels(
    ctx: CanvasRenderingContext2D,
    map: GalaxyMap,
    cam: Camera
  ) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const n of Object.values(map.nebulae)) {
      if (!n.showName || n.blobs.length === 0) continue;
      // Centre of mass of the dabs, weighted by their area.
      let sx = 0, sy = 0, sw = 0, maxR = 0;
      for (const b of n.blobs) {
        const wgt = b.r * b.r;
        sx += b.x * wgt; sy += b.y * wgt; sw += wgt;
        if (b.r > maxR) maxR = b.r;
      }
      if (sw === 0) continue;
      const p = cam.worldToScreen(sx / sw, sy / sw);
      const fontPx = clamp(maxR * 0.5 * cam.zoom, 0, 60);
      if (fontPx < 7) continue;
      ctx.font = REGION_LABEL_FONT.replace('%PX', fontPx.toFixed(1));
      ctx.letterSpacing = `${fontPx * 0.2}px`;
      ctx.fillStyle = withAlpha(n.color, 0.75);
      ctx.fillText(n.name, p.x, p.y);
      ctx.letterSpacing = '0px';
    }
    ctx.textBaseline = 'alphabetic';
  }

  /** Free annotations on the requested layer, plus any in-progress draft. */
  private drawAnnotations(
    ctx: CanvasRenderingContext2D,
    map: GalaxyMap,
    cam: Camera,
    layer: 'above' | 'below',
    opts: RenderOptions
  ) {
    const sel =
      opts.selectedEntity?.c === 'annotations' ? opts.selectedEntity.id : null;
    for (const a of Object.values(map.annotations)) {
      if ((a.layer ?? 'above') !== layer) continue;
      this.drawAnnotation(ctx, a, cam, a.id === sel);
    }
    const draft = opts.draftAnnotation;
    if (draft && (draft.layer ?? 'above') === layer) {
      this.drawAnnotation(ctx, draft, cam, false);
    }
  }

  private drawAnnotation(
    ctx: CanvasRenderingContext2D,
    a: Annotation,
    cam: Camera,
    selected: boolean
  ) {
    const pts = a.points.map((p) => cam.worldToScreen(p.x, p.y));
    if (pts.length === 0) return;
    ctx.strokeStyle = a.color;
    ctx.fillStyle = a.color;
    ctx.lineWidth = a.width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (a.dashed) ctx.setLineDash([7, 5]);

    switch (a.kind) {
      case 'text': {
        const fontPx = (a.fontSize ?? 24) * cam.zoom;
        if (fontPx >= 4) {
          ctx.font = REGION_LABEL_FONT.replace('%PX', fontPx.toFixed(1));
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(a.text ?? '', pts[0].x, pts[0].y);
          ctx.textBaseline = 'alphabetic';
        }
        break;
      }
      case 'line':
      case 'arrow': {
        if (pts.length < 2) break;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
        if (a.kind === 'arrow') {
          const p1 = pts[pts.length - 1];
          const p0 = pts[pts.length - 2];
          const ang = Math.atan2(p1.y - p0.y, p1.x - p0.x);
          const head = Math.max(9, a.width * 4);
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(
            p1.x - Math.cos(ang - 0.4) * head,
            p1.y - Math.sin(ang - 0.4) * head
          );
          ctx.lineTo(
            p1.x - Math.cos(ang + 0.4) * head,
            p1.y - Math.sin(ang + 0.4) * head
          );
          ctx.closePath();
          ctx.fill();
        }
        break;
      }
      case 'polygon': {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.closePath();
        if (a.filled) {
          ctx.globalAlpha = 0.18;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        ctx.stroke();
        break;
      }
      case 'ellipse': {
        if (pts.length < 2) break;
        const cx = (pts[0].x + pts[1].x) / 2;
        const cy = (pts[0].y + pts[1].y) / 2;
        const rx = Math.abs(pts[1].x - pts[0].x) / 2;
        const ry = Math.abs(pts[1].y - pts[0].y) / 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        if (a.filled) {
          ctx.globalAlpha = 0.18;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        ctx.stroke();
        break;
      }
    }
    ctx.setLineDash([]);

    if (selected) {
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 1;
      for (const p of pts) {
        ctx.beginPath();
        ctx.rect(p.x - 3.5, p.y - 3.5, 7, 7);
        ctx.fill();
        ctx.stroke();
      }
    }
  }

  /** Rubber-band selection rectangle. */
  private drawMarquee(ctx: CanvasRenderingContext2D, m: Marquee) {
    const x = Math.min(m.x0, m.x1);
    const y = Math.min(m.y0, m.y1);
    const w = Math.abs(m.x1 - m.x0);
    const h = Math.abs(m.y1 - m.y0);
    ctx.fillStyle = 'rgba(90,124,255,0.12)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(150,180,255,0.85)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    ctx.setLineDash([]);
  }

  /** Freehand selection loop; the closing edge is implied and drawn faint. */
  private drawLasso(
    ctx: CanvasRenderingContext2D,
    pts: readonly { x: number; y: number }[]
  ) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(90,124,255,0.12)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(150,180,255,0.85)';
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.setLineDash([5, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /** Small icon badges below a system's name card for each of its markers. */
  private drawMarkers(
    ctx: CanvasRenderingContext2D,
    onScreen: { s: System; p: { x: number; y: number } }[],
    op: number
  ) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '11px system-ui, sans-serif';
    const gap = 15;
    const badgeR = 7;
    for (const { s, p } of onScreen) {
      const ms = s.markers;
      if (!ms || ms.length === 0) continue;
      // Sit just under where the name card is (card bottom ≈ p.y + 24).
      const y = p.y + 24 + 4 + badgeR;
      const startX = p.x - ((ms.length - 1) * gap) / 2;
      for (let i = 0; i < ms.length; i++) {
        const mk = MARKER_BY_ID[ms[i]];
        if (!mk) continue;
        const x = startX + i * gap;
        ctx.globalAlpha = op * 0.9;
        ctx.fillStyle = 'rgba(8,11,22,0.92)';
        ctx.beginPath();
        ctx.arc(x, y, badgeR, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = op;
        ctx.strokeStyle = mk.color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, badgeR, 0, Math.PI * 2);
        ctx.stroke();
        if (mk.icon) {
          // Gates get the same vector icon as the matching special object, so
          // the two notations agree and neither blurs in a large export.
          drawObjectIcon(ctx, mk.icon, x, y, badgeR * 0.68, mk.color);
        } else {
          ctx.fillStyle = mk.color;
          ctx.fillText(mk.glyph, x, y + 0.5);
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.textBaseline = 'alphabetic';
  }

  /** Stellaris-style name card centred below each star. */
  private drawSystemCards(
    ctx: CanvasRenderingContext2D,
    onScreen: { s: System; p: { x: number; y: number } }[],
    op: number
  ) {
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const padX = 6;
    const boxH = 16;
    for (const { s, p } of onScreen) {
      if (s.starType === 'blackhole') continue;
      const tw = ctx.measureText(s.name).width;
      const boxW = tw + padX * 2;
      const cx = p.x;
      const top = p.y + 8;
      ctx.globalAlpha = op;
      ctx.fillStyle = 'rgba(10,14,26,0.78)';
      ctx.strokeStyle = 'rgba(150,180,230,0.28)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(cx - boxW / 2, top, boxW, boxH, 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(226,234,248,1)';
      ctx.fillText(s.name, cx, top + boxH / 2 + 0.5);
    }
    ctx.globalAlpha = 1;
    ctx.textBaseline = 'alphabetic';
  }

  private drawEmpireLabels(
    ctx: CanvasRenderingContext2D,
    map: GalaxyMap,
    cam: Camera,
    dsp: DisplaySettings
  ) {
    // Fade out as you zoom IN, handing off to the system name cards.
    const hideAt = dsp.systemNameZoom * 1.3;
    const zoomFade = clamp((hideAt - cam.zoom) / (hideAt * 0.42), 0, 1);
    if (zoomFade <= 0.02) return;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const label of this.territory.labels) {
      const emp = map.empires[label.empireId];
      if (!emp) continue;
      // The label has a size in WORLD units set by how much land the region
      // covers — a big realm's name is simply a bigger object on the map. On
      // screen it is that size times the zoom, so it grows as you fly in and
      // shrinks as you pull out, exactly like the stars. Long names shrink
      // sub-linearly so they stay readable instead of collapsing.
      const worldR = Math.sqrt(label.area / Math.PI);
      const nameLen = Math.max(5, emp.name.length);
      const worldFont =
        ((worldR * 3.1) / Math.pow(nameLen, 0.82)) * dsp.empireNameScale;
      const fontPx = worldFont * cam.zoom;
      if (fontPx < 5) continue; // unreadable speck — skip the draw entirely
      // Fade in over the last few px so labels don't pop.
      const sizeFade = clamp((fontPx - 5) / 5, 0, 1);
      const op = zoomFade * sizeFade;
      if (op <= 0.03) continue;

      const p = cam.worldToScreen(label.x, label.y);
      ctx.font = EMPIRE_LABEL_FONT.replace('%PX', fontPx.toFixed(1));
      // White, as-written (no upper-case), no shadow.
      ctx.fillStyle = `rgba(245,248,255,${op})`;
      ctx.fillText(emp.name, p.x, p.y);
    }

    ctx.textBaseline = 'alphabetic';
  }

  /** Accretion disk + event horizon for a black hole. */
  private drawBlackHole(
    ctx: CanvasRenderingContext2D, x: number, y: number, zoom: number, big: boolean
  ) {
    const R = big ? Math.max(11, 30 * zoom) : Math.max(2.4, 4 * zoom);
    const halo = ctx.createRadialGradient(x, y, R * 0.6, x, y, R * 4);
    halo.addColorStop(0, 'rgba(120,80,180,0.28)');
    halo.addColorStop(0.5, 'rgba(90,50,140,0.13)');
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(x, y, R * 4, 0, Math.PI * 2);
    ctx.fill();

    const disk = ctx.createRadialGradient(x, y, R * 0.9, x, y, R * 2.1);
    disk.addColorStop(0, 'rgba(255,236,190,0)');
    disk.addColorStop(0.35, 'rgba(255,214,150,0.85)');
    disk.addColorStop(0.6, 'rgba(255,150,70,0.7)');
    disk.addColorStop(1, 'rgba(120,40,20,0)');
    ctx.fillStyle = disk;
    ctx.beginPath();
    ctx.arc(x, y, R * 2.1, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,244,220,0.9)';
    ctx.lineWidth = Math.max(1.2, R * 0.12);
    ctx.beginPath();
    ctx.arc(x, y, R * 1.02, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.arc(x, y, R, 0, Math.PI * 2);
    ctx.fill();
  }

  /** Faint holographic star-chart grid: concentric rings + radial spokes. */
  private drawGrid(ctx: CanvasRenderingContext2D, cam: Camera) {
    const c = cam.worldToScreen(0, 0);
    ctx.strokeStyle = 'rgba(96,132,190,0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let r = 300; r <= 1900; r += 300) {
      const rr = r * cam.zoom;
      ctx.moveTo(c.x + rr, c.y);
      ctx.arc(c.x, c.y, rr, 0, Math.PI * 2);
    }
    const maxR = 1950 * cam.zoom;
    for (let a = 0; a < 360; a += 30) {
      const rad = (a * Math.PI) / 180;
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(c.x + Math.cos(rad) * maxR, c.y + Math.sin(rad) * maxR);
    }
    ctx.stroke();
  }

  private drawBackground(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    dsp: DisplaySettings
  ) {
    const { viewW: w, viewH: h } = cam;
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#04040a');
    bg.addColorStop(1, '#070510');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    if (dsp.showBgStars) {
      for (const st of this.bgStars) {
        const p = cam.worldToScreen(st.x, st.y);
        if (p.x < 0 || p.x > w || p.y < 0 || p.y > h) continue;
        ctx.globalAlpha = st.a;
        ctx.fillStyle = st.color;
        ctx.fillRect(p.x, p.y, st.r, st.r);
      }
      ctx.globalAlpha = 1;
    }

    // Soft vignette to focus the eye on the map centre.
    if (dsp.showVignette) {
      const vig = ctx.createRadialGradient(
        w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75
      );
      vig.addColorStop(0, 'rgba(0,0,0,0)');
      vig.addColorStop(1, 'rgba(0,0,0,0.45)');
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, w, h);
    }
  }
}

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}

interface StarDot { x: number; y: number; r: number; type: StarType }

// Base star radii in WORLD units (main-sequence). Multiplied by zoom on screen.
const STAR_WORLD_R = 1.85;
const CAPITAL_WORLD_R = 2.5;
// Never let a star vanish completely when zoomed far out.
const STAR_MIN_PX = 0.55;
// Glow: halo radius as a multiple of the core radius; skip tiny far-out stars.
const GLOW_SCALE = 3.4;
const GLOW_MIN = 1.6; // px: skip glow for far-out specks (keeps overview cheap)

/** A soft radial glow sprite tinted by `color`, used additively per star. */
function makeGlowSprite(color: string): HTMLCanvasElement {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const [r, gr, b] = hexToRgb(color);
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, `rgba(${r},${gr},${b},0.85)`);
  grad.addColorStop(0.22, `rgba(${r},${gr},${b},0.42)`);
  grad.addColorStop(0.55, `rgba(${r},${gr},${b},0.12)`);
  grad.addColorStop(1, `rgba(${r},${gr},${b},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  return c;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(
    h.length === 3 ? h.split('').map((ch) => ch + ch).join('') : h,
    16
  );
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Screen positions & radii for a system's stars. Radii and the cluster layout
 * are in world units and multiplied by `zoom`, so stars scale with the camera
 * (nearer = bigger). The cluster spread scales with the largest star present,
 * so a giant/supergiant pushes its neighbours out instead of covering them; the
 * stored per-star jitter is scaled to that spread.
 */
function layoutStars(
  sp: { s: System; p: { x: number; y: number } },
  baseWorldR: number,
  zoom: number
): StarDot[] {
  const bodies = normalizeStars(sp.s);
  const n = bodies.length;
  const radW = bodies.map((b) => baseWorldR * (STAR_SIZE_BY_ID[b.size]?.mult ?? 1));
  let maxRw = 0;
  for (const r of radW) if (r > maxRw) maxRw = r;
  // World-space distance of an offset unit from centre: enough that even two big
  // stars on opposite sides clear each other.
  const spreadW = n <= 1 ? 0 : maxRw * 1.35 + baseWorldR * 0.9;
  const jitW = spreadW * 0.4;
  const out: StarDot[] = [];
  for (let i = 0; i < n; i++) {
    const b = bodies[i];
    const [bx, by] = starBaseOffset(i, n);
    const ox = bx * spreadW + (n > 1 ? b.jx * jitW : 0);
    const oy = by * spreadW + (n > 1 ? b.jy * jitW : 0);
    out.push({
      x: sp.p.x + ox * zoom,
      y: sp.p.y + oy * zoom,
      r: Math.max(STAR_MIN_PX, radW[i] * zoom),
      type: b.type,
    });
  }
  return out;
}
