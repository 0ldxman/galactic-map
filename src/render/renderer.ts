import { GalaxyMap, STAR_COLORS, System } from '../model/types';
import { MARKER_BY_ID } from '../model/markers';
import { Camera } from './camera';
import { TerritoryRenderer } from './territories';
import { mulberry32 } from '../util/rng';

export interface RenderOptions {
  selectedSystemId: string | null;
  connectFromId: string | null;
  /** store revision — lets the territory cache know when to rebuild */
  revision: number;
  /** true while dragging a system: skip the (costly) border rebuild until drop */
  deferTerritory?: boolean;
}

interface BgStar {
  x: number;
  y: number;
  r: number;
  a: number;
  color: string;
}

const EMPIRE_LABEL_FONT = `700 %PXpx Tektur, 'Tektur', system-ui, sans-serif`;

export class Renderer {
  readonly territory = new TerritoryRenderer();
  private bgStars: BgStar[] = [];

  constructor() {
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

    this.drawBackground(ctx, cam);
    this.drawGrid(ctx, cam);

    const systems = Object.values(map.systems);

    // Territory borders (rebuilt only when the map changes; drawn as vectors).
    this.territory.update(systems, map.empires, opts.revision, opts.deferTerritory);
    this.territory.draw(ctx, cam);

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

    // Star dots, one path per colour. Multi-star systems draw a little cluster.
    const dotR = 1.9;
    for (const [starType, list] of buckets) {
      ctx.fillStyle = STAR_COLORS[starType as keyof typeof STAR_COLORS];
      ctx.beginPath();
      for (const { s, p } of list) {
        addStarCluster(ctx, p.x, p.y, s.stars ?? 1, dotR);
      }
      ctx.fill();
    }

    // Capitals: brighter cluster + ring.
    for (const { s, p } of capitals) {
      ctx.fillStyle = STAR_COLORS[s.starType];
      ctx.beginPath();
      addStarCluster(ctx, p.x, p.y, s.stars ?? 1, 2.6);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.stroke();
    }

    for (const { s, p } of blackholes) {
      this.drawBlackHole(ctx, p.x, p.y, cam.zoom, s.influence === 0);
    }

    // Selection / pending-connection highlight.
    for (const { s, p } of onScreen) {
      if (s.id !== opts.selectedSystemId && s.id !== opts.connectFromId) continue;
      ctx.strokeStyle = s.id === opts.connectFromId ? '#ffe27a' : '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
      ctx.stroke();
    }

    // --- System markers: little icon badges above the star. ---
    const markOp = clamp((cam.zoom - 0.6) / (1.0 - 0.6), 0, 1);
    if (markOp > 0.02) {
      this.drawMarkers(ctx, onScreen, markOp);
    }

    // --- System name cards: only well zoomed in, faded via opacity. ---
    const sysOp = clamp((cam.zoom - 1.3) / (1.9 - 1.3), 0, 1);
    if (sysOp > 0.02) {
      this.drawSystemCards(ctx, onScreen, sysOp);
    }

    // --- Empire labels at region centroids (main territory + each enclave). ---
    this.drawEmpireLabels(ctx, map, cam);
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
        ctx.fillStyle = mk.color;
        ctx.fillText(mk.glyph, x, y + 0.5);
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

  private drawEmpireLabels(ctx: CanvasRenderingContext2D, map: GalaxyMap, cam: Camera) {
    // Fade out as you zoom IN (they hand off to system labels).
    const zoomFade = clamp((1.7 - cam.zoom) / (1.7 - 1.0), 0, 1);
    if (zoomFade <= 0.02) return;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const label of this.territory.labels) {
      const emp = map.empires[label.empireId];
      if (!emp) continue;
      const worldR = Math.sqrt(label.area / Math.PI);
      // Size tracks the region's on-screen size so the name keeps filling its
      // territory as you zoom (it must not shrink relative to the land). Each
      // region/enclave is sized from its own area; longer names get a smaller
      // font so they still fit.
      const screenR = worldR * cam.zoom;
      const nameLen = Math.max(6, emp.name.length);
      const fontPx = clamp((screenR * 2.4) / nameLen, 11, 96);
      // Hide when the region is too small on screen to hold the label.
      const fit = clamp((screenR - fontPx * 0.55) / (fontPx * 0.55), 0, 1);
      const op = zoomFade * fit;
      if (op <= 0.03) continue;

      const p = cam.worldToScreen(label.x, label.y);
      ctx.font = EMPIRE_LABEL_FONT.replace('%PX', String(Math.round(fontPx)));
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

  private drawBackground(ctx: CanvasRenderingContext2D, cam: Camera) {
    const { viewW: w, viewH: h } = cam;
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#04040a');
    bg.addColorStop(1, '#070510');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    for (const st of this.bgStars) {
      const p = cam.worldToScreen(st.x, st.y);
      if (p.x < 0 || p.x > w || p.y < 0 || p.y > h) continue;
      ctx.globalAlpha = st.a;
      ctx.fillStyle = st.color;
      ctx.fillRect(p.x, p.y, st.r, st.r);
    }
    ctx.globalAlpha = 1;

    // Soft vignette to focus the eye on the map centre.
    const vig = ctx.createRadialGradient(
      w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75
    );
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, w, h);
  }
}

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Add `n` (1–4) star dots as a small cluster to the current path. */
function addStarCluster(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  n: number,
  r: number
) {
  const count = n <= 1 ? 1 : Math.min(4, n);
  if (count === 1) {
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, Math.PI * 2);
    return;
  }
  const d = r * 1.5; // cluster spread
  const rr = r * 0.85; // slightly smaller dots when clustered
  const offs =
    count === 2
      ? [[-d, 0], [d, 0]]
      : count === 3
        ? [[0, -d], [-d, d * 0.8], [d, d * 0.8]]
        : [[-d, -d], [d, -d], [-d, d], [d, d]];
  for (const [ox, oy] of offs) {
    ctx.moveTo(x + ox + rr, y + oy);
    ctx.arc(x + ox, y + oy, rr, 0, Math.PI * 2);
  }
}
