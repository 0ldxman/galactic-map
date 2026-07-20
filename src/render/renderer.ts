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
}

export class Renderer {
  private territory = new TerritoryRenderer();
  private bgStars: BgStar[] = [];

  constructor() {
    // Static starfield in world space so it parallaxes with the map.
    const rnd = mulberry32(1234567);
    const span = 3000;
    for (let i = 0; i < 700; i++) {
      this.bgStars.push({
        x: (rnd() - 0.5) * 2 * span,
        y: (rnd() - 0.5) * 2 * span,
        r: rnd() * 1.2 + 0.2,
        a: rnd() * 0.5 + 0.1,
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
    ctx.strokeStyle = 'rgba(150,180,220,0.28)';
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
      if (p.x < -20 || p.x > w + 20 || p.y < -20 || p.y > h + 20) continue;
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

  private drawBackground(ctx: CanvasRenderingContext2D, cam: Camera) {
    const { viewW: w, viewH: h } = cam;
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#05060f');
    bg.addColorStop(1, '#0a0a18');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // Faint central nebula tint around the galaxy origin.
    const c = cam.worldToScreen(0, 0);
    const neb = ctx.createRadialGradient(
      c.x,
      c.y,
      0,
      c.x,
      c.y,
      900 * cam.zoom
    );
    neb.addColorStop(0, 'rgba(60,50,110,0.22)');
    neb.addColorStop(0.5, 'rgba(40,30,80,0.10)');
    neb.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = neb;
    ctx.fillRect(0, 0, w, h);

    // Parallax starfield.
    for (const st of this.bgStars) {
      const p = cam.worldToScreen(st.x, st.y);
      if (p.x < 0 || p.x > w || p.y < 0 || p.y > h) continue;
      ctx.globalAlpha = st.a;
      ctx.fillStyle = '#cfe0ff';
      ctx.fillRect(p.x, p.y, st.r, st.r);
    }
    ctx.globalAlpha = 1;
  }
}
