import { GalaxyMap, STAR_COLORS, System } from '../model/types';
import { Camera } from './camera';
import { TerritoryRenderer } from './territories';
import { mulberry32 } from '../util/rng';

export interface RenderOptions {
  selectedSystemId: string | null;
  connectFromId: string | null;
  /** store revision — lets the territory cache know when to rebuild */
  revision: number;
}

interface BgStar {
  x: number;
  y: number;
  r: number;
  a: number;
  color: string;
}

const EMPIRE_LABEL_FONT = `italic 600 %PXpx Georgia, 'Iowan Old Style', 'Times New Roman', serif`;

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

    // Territory raster (rebuilt only when the map changes; blitted here).
    this.territory.update(systems, map.empires, opts.revision);
    this.territory.draw(ctx, cam);

    // Hyperlanes — thin schematic circuit lines.
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(140,175,220,0.20)';
    ctx.beginPath();
    for (const hl of Object.values(map.hyperlanes)) {
      const a = map.systems[hl.a];
      const b = map.systems[hl.b];
      if (!a || !b) continue;
      const pa = cam.worldToScreen(a.x, a.y);
      const pb = cam.worldToScreen(b.x, b.y);
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
    }
    ctx.stroke();

    // --- Systems: bucket the visible ones and draw each colour in ONE path. ---
    const margin = 30;
    const buckets = new Map<string, System[]>();
    const capitals: { s: System; p: { x: number; y: number } }[] = [];
    const blackholes: System[] = [];
    const onScreen: { s: System; p: { x: number; y: number } }[] = [];

    for (const s of systems) {
      const p = cam.worldToScreen(s.x, s.y);
      if (p.x < -margin || p.x > w + margin || p.y < -margin || p.y > h + margin) continue;
      onScreen.push({ s, p });
      if (s.starType === 'blackhole') { blackholes.push(s); continue; }
      const isCapital = map.empires[s.ownerId ?? '']?.capitalId === s.id;
      if (isCapital) { capitals.push({ s, p }); continue; }
      const arr = buckets.get(s.starType) ?? [];
      arr.push(s);
      buckets.set(s.starType, arr);
    }

    const dotR = 1.9;
    for (const [starType, list] of buckets) {
      ctx.fillStyle = STAR_COLORS[starType as keyof typeof STAR_COLORS];
      ctx.beginPath();
      for (const s of list) {
        const p = cam.worldToScreen(s.x, s.y);
        ctx.moveTo(p.x + dotR, p.y);
        ctx.arc(p.x, p.y, dotR, 0, Math.PI * 2);
      }
      ctx.fill();
    }

    // Capitals: brighter dot + ring.
    for (const { s, p } of capitals) {
      const color = STAR_COLORS[s.starType];
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.stroke();
    }

    for (const s of blackholes) {
      const p = cam.worldToScreen(s.x, s.y);
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

    // --- System name labels: only well zoomed in, faded via opacity. ---
    const sysOp = clamp((cam.zoom - 1.3) / (1.9 - 1.3), 0, 1);
    if (sysOp > 0.02) {
      ctx.font = '10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = `rgba(220,230,245,${0.8 * sysOp})`;
      for (const { s, p } of onScreen) {
        if (s.starType === 'blackhole') continue;
        ctx.fillText(s.name, p.x, p.y - 8);
      }
    }

    // --- Empire labels at region centroids (main territory + each enclave). ---
    this.drawEmpireLabels(ctx, map, cam);
  }

  private drawEmpireLabels(ctx: CanvasRenderingContext2D, map: GalaxyMap, cam: Camera) {
    // Fade out as you zoom IN (they hand off to system labels).
    const zoomFade = clamp((1.7 - cam.zoom) / (1.7 - 1.0), 0, 1);
    if (zoomFade <= 0.02) return;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const anyCtx = ctx as unknown as { letterSpacing: string };
    const prevSpacing = anyCtx.letterSpacing;

    for (const label of this.territory.labels) {
      const emp = map.empires[label.empireId];
      if (!emp) continue;
      const worldR = Math.sqrt(label.area / Math.PI);
      // Size tracks the region (from the borders), NOT the zoom.
      const fontPx = clamp(worldR * 0.14, 11, 42);
      // Hide when the region is too small on screen to hold the label.
      const screenR = worldR * cam.zoom;
      const fit = clamp((screenR - fontPx * 0.55) / (fontPx * 0.55), 0, 1);
      const op = zoomFade * fit;
      if (op <= 0.03) continue;

      const p = cam.worldToScreen(label.x, label.y);
      anyCtx.letterSpacing = `${Math.max(1, fontPx * 0.06)}px`;
      ctx.font = EMPIRE_LABEL_FONT.replace('%PX', String(Math.round(fontPx)));

      ctx.shadowColor = 'rgba(0,0,0,0.85)';
      ctx.shadowBlur = 6;
      ctx.fillStyle = withAlpha(emp.color, op);
      ctx.fillText(emp.name.toUpperCase(), p.x, p.y);
      ctx.shadowBlur = 0;
    }

    anyCtx.letterSpacing = prevSpacing ?? '0px';
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

function withAlpha(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
