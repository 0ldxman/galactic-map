import { Nebula } from '../model/types';
import { DisplaySettings, DEFAULT_DISPLAY } from '../model/display';
import { Camera } from './camera';
import { hexToRgb } from '../util/color';
import { mulberry32 } from '../util/rng';

/**
 * Painted gas clouds.
 *
 * A nebula is stored as a pile of overlapping circles (brush dabs), but a pile
 * of soft circles looks like an airbrush, not like gas. So the dabs are only a
 * *mask*: they say where the cloud is. What fills that mask is fractal noise —
 * two tileable fBm fields (one clumpy, one ridged) multiplied together, which
 * gives the torn filaments and dark lanes real nebulae have. The author's
 * `texture` slider cross-fades between the bare mask and the noisy version.
 *
 * The result is baked into a world-space texture and cached, so panning and
 * zooming cost a single `drawImage` no matter how many dabs were painted.
 */
export class NebulaRenderer {
  private tex = document.createElement('canvas');
  private tctx = this.tex.getContext('2d')!;
  /** where the cloud is (brush dabs, greyscale) */
  private mask = document.createElement('canvas');
  private mctx = this.mask.getContext('2d')!;
  /** what fills it (fractal noise, clipped to the mask) */
  private cloud = document.createElement('canvas');
  private cctx = this.cloud.getContext('2d')!;
  private gas = document.createElement('canvas');
  private gctx = this.gas.getContext('2d')!;

  private minX = 0;
  private minY = 0;
  private worldW = 0;
  private worldH = 0;
  private ready = false;

  pending = false;
  /** References the texture was baked from (see TerritoryRenderer.sysRef). */
  private builtRef: unknown = null;
  private dspRef: unknown = null;
  private built = false;
  private lastBuild = 0;
  private display: DisplaySettings = DEFAULT_DISPLAY;

  update(
    nebulae: Record<string, Nebula>,
    defer = false,
    display: DisplaySettings = DEFAULT_DISPLAY
  ) {
    this.display = display;
    if (nebulae === this.builtRef && display === this.dspRef) {
      this.pending = false;
      return;
    }
    if (defer) {
      this.pending = true;
      return;
    }
    const now = performance.now();
    if (this.built && now - this.lastBuild < 110) {
      this.pending = true;
      return;
    }
    this.pending = false;
    this.lastBuild = now;
    this.builtRef = nebulae;
    this.dspRef = display;
    this.built = true;
    this.build(nebulae);
  }

  private build(nebulae: Record<string, Nebula>) {
    this.ready = false;
    const list = Object.values(nebulae).filter((n) => n.blobs.length > 0);
    if (list.length === 0) return;
    const dsp = this.display;

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

    // Texture pixels per world unit. Fine enough that the filaments read, but
    // capped so a galaxy-wide cloud doesn't allocate a bitmap the size of a
    // wall — the Detail slider moves this within those bounds.
    const detail = clamp(dsp.nebulaDetail, 0.4, 2.5);
    // Two ceilings, both needed: the texture never exceeds `span` px on its
    // long side (so a galaxy-wide cloud can't allocate a bitmap the size of a
    // wall), and never more than 1.4 px per world unit (so a small cloud isn't
    // baked at a pointlessly fine scale).
    const span = Math.min(2600, 1400 * detail);
    const ppw = Math.min(1.4, span / Math.max(worldW, worldH));
    const rw = Math.max(1, Math.round(worldW * ppw));
    const rh = Math.max(1, Math.round(worldH * ppw));

    for (const c of [this.tex, this.mask, this.cloud, this.gas]) {
      if (c.width !== rw || c.height !== rh) { c.width = rw; c.height = rh; }
    }
    this.tctx.clearRect(0, 0, rw, rh);

    const clumps = noiseTile('clump');
    const strands = noiseTile('ridged');

    for (const n of list) {
      // 1. The mask: where the author painted. Dabs accumulate additively, so
      //    overlapping strokes melt into one body instead of stacking edges.
      reset(this.mctx, rw, rh);
      this.mctx.globalCompositeOperation = 'lighter';
      for (const b of n.blobs) {
        const cx = (b.x - minX) * ppw;
        const cy = (b.y - minY) * ppw;
        const r = Math.max(1, b.r * ppw);
        const g = this.mctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, 'rgba(255,255,255,0.50)');
        g.addColorStop(0.45, 'rgba(255,255,255,0.26)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        this.mctx.fillStyle = g;
        this.mctx.beginPath();
        this.mctx.arc(cx, cy, r, 0, Math.PI * 2);
        this.mctx.fill();
      }
      this.mctx.globalCompositeOperation = 'source-over';

      const t = clamp((n.texture ?? 0.75) * dsp.nebulaTexture, 0, 1);

      if (t > 0.01) {
        // 2. The gas: two fractal fields multiplied. `destination-in` keeps the
        //    first layer's pixels weighted by the second's alpha, which is a
        //    multiply on the alpha channel — clumps punched through by strands.
        const seed = n.seed ?? 1;
        const feature = Math.max(20, n.detail ?? 320) * ppw;
        reset(this.gctx, rw, rh);
        paintNoise(this.gctx, clumps, rw, rh, feature, seed, 1);
        this.gctx.globalCompositeOperation = 'destination-in';
        paintNoise(this.gctx, strands, rw, rh, feature * 0.44, seed * 7 + 13, 1);
        // 3. Clip the gas to where the cloud actually is.
        paintCanvas(this.gctx, this.mask, rw, rh);
        this.gctx.globalCompositeOperation = 'source-over';
      }

      // 4. Cross-fade mask and gas: at texture 0 this is exactly the old soft
      //    cloud, at 1 it is all structure.
      reset(this.cctx, rw, rh);
      this.cctx.globalAlpha = 1 - t * 0.85;
      this.cctx.drawImage(this.mask, 0, 0);
      if (t > 0.01) {
        this.cctx.globalCompositeOperation = 'lighter';
        // The multiplied noise is much darker than the mask on average, so it
        // is pushed back up — otherwise raising Texture only dims the cloud.
        this.cctx.globalAlpha = Math.min(1, t * 2.3);
        this.cctx.drawImage(this.gas, 0, 0);
        this.cctx.drawImage(this.gas, 0, 0);
      }
      this.cctx.globalAlpha = 1;

      // 5. Tint the density with the cloud's colour, keeping its alpha.
      const [r, g, b] = hexToRgb(n.color);
      this.cctx.globalCompositeOperation = 'source-in';
      this.cctx.fillStyle = `rgb(${r},${g},${b})`;
      this.cctx.fillRect(0, 0, rw, rh);
      this.cctx.globalCompositeOperation = 'source-over';

      // 6. Add the cloud to the shared texture. A touch of blur softens the
      //    noise lattice without dissolving the filaments.
      this.tctx.globalAlpha = clamp(n.opacity * dsp.nebulaBrightness, 0, 1);
      this.tctx.globalCompositeOperation = 'lighter';
      this.tctx.filter = t > 0.01 ? 'blur(1.2px)' : 'blur(3px)';
      this.tctx.drawImage(this.cloud, 0, 0);
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

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}

function reset(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, w, h);
}

/** drawImage under the caller's current composite mode, without disturbing it. */
function paintCanvas(
  ctx: CanvasRenderingContext2D,
  src: HTMLCanvasElement,
  w: number,
  h: number
) {
  ctx.drawImage(src, 0, 0, w, h);
}

/**
 * Fill the target with one noise tile, scaled so its largest features span
 * `feature` pixels and phase-shifted by `seed` so no two clouds line up.
 */
function paintNoise(
  ctx: CanvasRenderingContext2D,
  tile: HTMLCanvasElement,
  w: number,
  h: number,
  feature: number,
  seed: number,
  alpha: number
) {
  const pat = ctx.createPattern(tile, 'repeat');
  if (!pat) return;
  const k = Math.max(0.02, feature / tile.width);
  const rnd = mulberry32(seed >>> 0);
  const ox = rnd() * tile.width * k;
  const oy = rnd() * tile.width * k;
  pat.setTransform(new DOMMatrix([k, 0, 0, k, ox, oy]));
  ctx.globalAlpha = alpha;
  ctx.fillStyle = pat;
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 1;
}

const TILE_SIZE = 512;
const tiles: Record<string, HTMLCanvasElement> = {};

/**
 * A tileable fractal-noise field, white with the noise in the alpha channel so
 * it can be multiplied into other layers with plain composite operations.
 *
 * `clump` is ordinary fBm — soft blobs at several scales. `ridged` folds each
 * octave around its midpoint, which turns the smooth hills into creases; that
 * is what gives a nebula its stringy, torn look. Both are built once and reused
 * by every cloud (each cloud varies them by scale and phase instead).
 */
function noiseTile(kind: 'clump' | 'ridged'): HTMLCanvasElement {
  const cached = tiles[kind];
  if (cached) return cached;

  const S = TILE_SIZE;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(S, S);
  const acc = new Float32Array(S * S);

  const octaves =
    kind === 'clump'
      ? [{ l: 3, a: 0.52 }, { l: 6, a: 0.26 }, { l: 12, a: 0.14 }, { l: 24, a: 0.08 }]
      : [{ l: 4, a: 0.5 }, { l: 8, a: 0.28 }, { l: 16, a: 0.14 }, { l: 32, a: 0.08 }];

  let seed = kind === 'clump' ? 0x51ed : 0x9e37;
  for (const o of octaves) {
    const rnd = mulberry32(seed++);
    const lat = new Float32Array(o.l * o.l);
    for (let i = 0; i < lat.length; i++) lat[i] = rnd();
    const step = S / o.l;
    for (let y = 0; y < S; y++) {
      const fy = y / step;
      const iy = Math.floor(fy);
      const ty = smoothstep(fy - iy);
      const y0 = (iy % o.l) * o.l;
      const y1 = ((iy + 1) % o.l) * o.l;
      for (let x = 0; x < S; x++) {
        const fx = x / step;
        const ix = Math.floor(fx);
        const tx = smoothstep(fx - ix);
        const x0 = ix % o.l;
        const x1 = (ix + 1) % o.l;
        const top = lat[y0 + x0] * (1 - tx) + lat[y0 + x1] * tx;
        const bot = lat[y1 + x0] * (1 - tx) + lat[y1 + x1] * tx;
        let v = top * (1 - ty) + bot * ty;
        // Ridged: crease each octave instead of letting it hump.
        if (kind === 'ridged') v = 1 - Math.abs(v * 2 - 1);
        acc[y * S + x] += v * o.a;
      }
    }
  }

  // Remap to alpha with a contrast curve: gas is mostly thin with bright
  // knots, not an even grey.
  const lo = kind === 'clump' ? 0.3 : 0.35;
  const hi = kind === 'clump' ? 0.78 : 0.92;
  for (let p = 0, i = 0; p < acc.length; p++, i += 4) {
    const v = clamp((acc[p] - lo) / (hi - lo), 0, 1);
    img.data[i] = 255;
    img.data[i + 1] = 255;
    img.data[i + 2] = 255;
    img.data[i + 3] = Math.round(255 * (v * v * (3 - 2 * v)));
  }
  ctx.putImageData(img, 0, 0);
  tiles[kind] = c;
  return c;
}

function smoothstep(t: number) {
  return t * t * (3 - 2 * t);
}
