import { GalaxyMap, STAR_COLORS } from '../model/types';
import { Camera } from './camera';
import { TerritoryRenderer } from './territories';
import { mulberry32 } from '../util/rng';

export interface RenderOptions {
  selectedSystemId: string | null;
  connectFromId: string | null;
}

interface BgStar {
  x: number;
  y: number;
  r: number;
  a: number;
  color: string;
}

interface Nebula {
  x: number;
  y: number;
  r: number;
  color: string;
}

export class Renderer {
  private territory = new TerritoryRenderer();
  private bgStars: BgStar[] = [];
  private nebulae: Nebula[] = [];

  constructor() {
    const rnd = mulberry32(1234567);
    const span = 4200;

    // A dense, cool-to-warm starfield. Mostly faint white with occasional
    // coloured stars, plus a handful of bright "hero" stars.
    const starTints = [
      '#ffffff', '#ffffff', '#ffffff', '#dfe8ff',
      '#fff2cc', '#ffd9b3', '#cfe0ff', '#ffe0e6',
    ];
    for (let i = 0; i < 2600; i++) {
      const bright = rnd() < 0.04;
      this.bgStars.push({
        x: (rnd() - 0.5) * 2 * span,
        y: (rnd() - 0.5) * 2 * span,
        r: bright ? rnd() * 1.6 + 1.1 : rnd() * 1.0 + 0.25,
        a: bright ? rnd() * 0.4 + 0.6 : rnd() * 0.45 + 0.12,
        color: starTints[(rnd() * starTints.length) | 0],
      });
    }

    // Soft coloured nebula clouds scattered through the galaxy (world space,
    // so they parallax with the map). Muted, varied hues — not a flat blue wash.
    const nebColors = [
      'rgba(120,60,150,0.16)', // violet
      'rgba(40,110,140,0.14)', // teal
      'rgba(150,60,90,0.12)', // magenta
      'rgba(60,80,160,0.13)', // indigo
      'rgba(140,90,50,0.10)', // amber dust
    ];
    for (let i = 0; i < 22; i++) {
      const ang = rnd() * Math.PI * 2;
      const rad = Math.pow(rnd(), 0.7) * 1500;
      this.nebulae.push({
        x: Math.cos(ang) * rad,
        y: Math.sin(ang) * rad,
        r: rnd() * 700 + 350,
        color: nebColors[(rnd() * nebColors.length) | 0],
      });
    }
  }

  draw(
    ctx: CanvasRenderingContext2D,
    map: GalaxyMap,
    cam: Camera,
    opts: RenderOptions
  ) {
    const { viewW: w, viewH: h } = cam;

    this.drawBackground(ctx, cam);

    const systems = Object.values(map.systems);

    // Territory blobs beneath everything else.
    this.territory.render(ctx, systems, map.empires, cam);

    // Hyperlanes.
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(150,180,220,0.22)';
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

    // Systems.
    const showLabels = cam.zoom > 0.55;
    for (const s of systems) {
      const p = cam.worldToScreen(s.x, s.y);
      if (p.x < -40 || p.x > w + 40 || p.y < -40 || p.y > h + 40) continue;

      if (s.starType === 'blackhole') {
        // The central supermassive core (influence 0) gets the big accretion
        // disk; ordinary black-hole stars are rendered small.
        this.drawBlackHole(ctx, p.x, p.y, cam.zoom, s.influence === 0);
        // Selection ring still applies.
        if (s.id === opts.selectedSystemId || s.id === opts.connectFromId) {
          ctx.strokeStyle = s.id === opts.connectFromId ? '#ffe27a' : '#ffffff';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 16, 0, Math.PI * 2);
          ctx.stroke();
        }
        continue;
      }

      const color = STAR_COLORS[s.starType];
      const isCapital = map.empires[s.ownerId ?? '']?.capitalId === s.id;
      const baseR = isCapital ? 4.5 : 2.8;

      // Glow.
      const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, baseR * 3.5);
      glow.addColorStop(0, color);
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow;
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.arc(p.x, p.y, baseR * 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      // Core.
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, baseR, 0, Math.PI * 2);
      ctx.fill();

      if (isCapital) {
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, baseR + 2.5, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Highlight selection / pending connection endpoint.
      if (s.id === opts.selectedSystemId || s.id === opts.connectFromId) {
        ctx.strokeStyle =
          s.id === opts.connectFromId ? '#ffe27a' : '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, baseR + 6, 0, Math.PI * 2);
        ctx.stroke();
      }

      if (showLabels) {
        ctx.fillStyle = 'rgba(220,230,245,0.75)';
        ctx.font = '10px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(s.name, p.x, p.y - baseR - 5);
      }
    }

    // Empire capital labels (always visible, larger).
    ctx.textAlign = 'center';
    for (const e of Object.values(map.empires)) {
      if (!e.capitalId) continue;
      const cap = map.systems[e.capitalId];
      if (!cap) continue;
      const p = cam.worldToScreen(cap.x, cap.y);
      ctx.fillStyle = e.color;
      ctx.font = 'bold 13px system-ui, sans-serif';
      ctx.shadowColor = 'rgba(0,0,0,0.9)';
      ctx.shadowBlur = 4;
      ctx.fillText(e.name.toUpperCase(), p.x, p.y - 14);
      ctx.shadowBlur = 0;
    }
  }

  /** Accretion disk + event horizon for a black hole. */
  private drawBlackHole(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    zoom: number,
    big: boolean
  ) {
    const R = big ? Math.max(11, 30 * zoom) : Math.max(2.4, 4 * zoom);

    // Wide reddish gravitational glow.
    const halo = ctx.createRadialGradient(x, y, R * 0.6, x, y, R * 4);
    halo.addColorStop(0, 'rgba(120,80,180,0.30)');
    halo.addColorStop(0.5, 'rgba(90,50,140,0.14)');
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(x, y, R * 4, 0, Math.PI * 2);
    ctx.fill();

    // Accretion disk: hot ring fading inward and outward.
    const disk = ctx.createRadialGradient(x, y, R * 0.9, x, y, R * 2.1);
    disk.addColorStop(0, 'rgba(255,236,190,0)');
    disk.addColorStop(0.35, 'rgba(255,214,150,0.85)');
    disk.addColorStop(0.6, 'rgba(255,150,70,0.7)');
    disk.addColorStop(1, 'rgba(120,40,20,0)');
    ctx.fillStyle = disk;
    ctx.beginPath();
    ctx.arc(x, y, R * 2.1, 0, Math.PI * 2);
    ctx.fill();

    // Bright inner photon rim.
    ctx.strokeStyle = 'rgba(255,244,220,0.9)';
    ctx.lineWidth = Math.max(1.2, R * 0.12);
    ctx.beginPath();
    ctx.arc(x, y, R * 1.02, 0, Math.PI * 2);
    ctx.stroke();

    // Event horizon (pure black).
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.arc(x, y, R, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawBackground(ctx: CanvasRenderingContext2D, cam: Camera) {
    const { viewW: w, viewH: h } = cam;

    // Near-black deep-space base with a faint vertical warm/cool shift.
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#04040a');
    bg.addColorStop(1, '#070510');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // Coloured nebula clouds (world space -> parallax).
    for (const n of this.nebulae) {
      const p = cam.worldToScreen(n.x, n.y);
      const r = n.r * cam.zoom;
      if (p.x + r < 0 || p.x - r > w || p.y + r < 0 || p.y - r > h) continue;
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      g.addColorStop(0, n.color);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Faint warm glow near the galactic core.
    const c = cam.worldToScreen(0, 0);
    const core = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, 520 * cam.zoom);
    core.addColorStop(0, 'rgba(90,70,140,0.18)');
    core.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = core;
    ctx.fillRect(0, 0, w, h);

    // Parallax starfield.
    for (const st of this.bgStars) {
      const p = cam.worldToScreen(st.x, st.y);
      if (p.x < 0 || p.x > w || p.y < 0 || p.y > h) continue;
      ctx.globalAlpha = st.a;
      ctx.fillStyle = st.color;
      ctx.fillRect(p.x, p.y, st.r, st.r);
    }
    ctx.globalAlpha = 1;
  }
}
