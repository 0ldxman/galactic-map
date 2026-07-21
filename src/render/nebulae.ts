import { Nebula } from '../model/types';
import { Camera } from './camera';
import { hexToRgb } from '../util/color';

/**
 * Painted gas clouds.
 *
 * A nebula is stored as a pile of overlapping circles (brush dabs). They are
 * melted into one soft cloud the same way territories are: draw each dab as a
 * radial falloff, accumulate them, then tint the accumulated density. The
 * result is baked into a world-space texture and cached, so panning and zooming
 * cost a single `drawImage` no matter how many dabs the author painted.
 */
export class NebulaRenderer {
  private tex = document.createElement('canvas');
  private tctx = this.tex.getContext('2d')!;
  private scratch = document.createElement('canvas');
  private sctx = this.scratch.getContext('2d')!;

  private minX = 0;
  private minY = 0;
  private worldW = 0;
  private worldH = 0;
  private ready = false;

  pending = false;
  /** Reference the texture was baked from (see TerritoryRenderer.sysRef). */
  private builtRef: unknown = null;
  private built = false;
  private lastBuild = 0;

  update(nebulae: Record<string, Nebula>, defer = false) {
    if (nebulae === this.builtRef) {
      this.pending = false;
      return;
    }
    if (defer) {
      this.pending = true;
      return;
    }
    const now = performance.now();
    if (this.built && now - this.lastBuild < 90) {
      this.pending = true;
      return;
    }
    this.pending = false;
    this.lastBuild = now;
    this.builtRef = nebulae;
    this.built = true;
    this.build(nebulae);
  }

  private build(nebulae: Record<string, Nebula>) {
    this.ready = false;
    const list = Object.values(nebulae).filter((n) => n.blobs.length > 0);
    if (list.length === 0) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of list) {
      for (const b of n.blobs) {
        if (b.x - b.r < minX) minX = b.x - b.r;
        if (b.y - b.r < minY) minY = b.y - b.r;
        if (b.x + b.r > maxX) maxX = b.x + b.r;
        if (b.y + b.r > maxY) maxY = b.y + b.r;
      }
    }
    const pad = 40;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    const worldW = maxX - minX;
    const worldH = maxY - minY;

    // Clouds are soft by nature, so a coarse texture is plenty — and it keeps
    // repainting cheap while the brush is being dragged.
    const ppw = Math.min(0.8, 1000 / Math.max(worldW, worldH));
    const rw = Math.max(1, Math.round(worldW * ppw));
    const rh = Math.max(1, Math.round(worldH * ppw));

    if (this.tex.width !== rw || this.tex.height !== rh) {
      this.tex.width = rw; this.tex.height = rh;
      this.scratch.width = rw; this.scratch.height = rh;
    }
    this.tctx.clearRect(0, 0, rw, rh);

    for (const n of list) {
      // 1. Accumulate dab density in greyscale.
      this.sctx.globalCompositeOperation = 'source-over';
      this.sctx.clearRect(0, 0, rw, rh);
      this.sctx.globalCompositeOperation = 'lighter';
      for (const b of n.blobs) {
        const cx = (b.x - minX) * ppw;
        const cy = (b.y - minY) * ppw;
        const r = Math.max(1, b.r * ppw);
        const g = this.sctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, 'rgba(255,255,255,0.42)');
        g.addColorStop(0.45, 'rgba(255,255,255,0.20)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        this.sctx.fillStyle = g;
        this.sctx.beginPath();
        this.sctx.arc(cx, cy, r, 0, Math.PI * 2);
        this.sctx.fill();
      }
      // 2. Tint that density with the nebula's colour, keeping its alpha.
      const [r, g, b] = hexToRgb(n.color);
      this.sctx.globalCompositeOperation = 'source-in';
      this.sctx.fillStyle = `rgb(${r},${g},${b})`;
      this.sctx.fillRect(0, 0, rw, rh);
      this.sctx.globalCompositeOperation = 'source-over';

      // 3. Blur away the circles and add the cloud to the shared texture.
      this.tctx.globalAlpha = n.opacity;
      this.tctx.globalCompositeOperation = 'lighter';
      this.tctx.filter = 'blur(3px)';
      this.tctx.drawImage(this.scratch, 0, 0);
      this.tctx.filter = 'none';
    }
    this.tctx.globalAlpha = 1;
    this.tctx.globalCompositeOperation = 'source-over';

    this.minX = minX;
    this.minY = minY;
    this.worldW = worldW;
    this.worldH = worldH;
    this.ready = true;
  }

  draw(ctx: CanvasRenderingContext2D, cam: Camera) {
    if (!this.ready) return;
    const z = cam.zoom;
    ctx.save();
    ctx.translate(cam.viewW / 2 - cam.x * z, cam.viewH / 2 - cam.y * z);
    ctx.scale(z, z);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.tex, this.minX, this.minY, this.worldW, this.worldH);
    ctx.restore();
  }
}
