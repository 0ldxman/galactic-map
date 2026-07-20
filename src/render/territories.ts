import { System, Empire } from '../model/types';
import { Camera } from './camera';

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(
    h.length === 3
      ? h.split('').map((c) => c + c).join('')
      : h,
    16
  );
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Renders Stellaris-style organic territory blobs using a metaball technique:
 * each owned system contributes a soft radial falloff into a scalar field; the
 * field is thresholded so overlapping systems of one empire merge into a single
 * smooth shape, with a bright rim where the field crosses the threshold.
 *
 * The field is computed at a reduced resolution and upscaled, which is both
 * fast and helpfully blurs the edges.
 */
export class TerritoryRenderer {
  private field: HTMLCanvasElement;
  private fctx: CanvasRenderingContext2D;
  private out: HTMLCanvasElement;
  private octx: CanvasRenderingContext2D;
  private scale = 0.5;

  // Field threshold and rim band (0..255 on the accumulated red channel).
  private readonly THRESHOLD = 96;
  private readonly RIM = 42;
  private readonly FILL_ALPHA = 0.3;

  constructor() {
    this.field = document.createElement('canvas');
    this.fctx = this.field.getContext('2d')!;
    this.out = document.createElement('canvas');
    this.octx = this.out.getContext('2d')!;
  }

  render(
    target: CanvasRenderingContext2D,
    systems: System[],
    empires: Record<string, Empire>,
    cam: Camera
  ) {
    const w = Math.max(1, Math.floor(cam.viewW * this.scale));
    const h = Math.max(1, Math.floor(cam.viewH * this.scale));
    if (this.field.width !== w || this.field.height !== h) {
      this.field.width = w;
      this.field.height = h;
      this.out.width = w;
      this.out.height = h;
    }

    // Group owned systems by empire.
    const byEmpire = new Map<string, System[]>();
    for (const s of systems) {
      if (!s.ownerId || !empires[s.ownerId]) continue;
      const arr = byEmpire.get(s.ownerId) ?? [];
      arr.push(s);
      byEmpire.set(s.ownerId, arr);
    }

    const result = this.octx.createImageData(w, h);
    const rd = result.data;

    for (const [empireId, owned] of byEmpire) {
      const [er, eg, eb] = hexToRgb(empires[empireId].color);

      // 1. Accumulate the influence field with additive blending.
      this.fctx.clearRect(0, 0, w, h);
      this.fctx.globalCompositeOperation = 'lighter';
      for (const s of owned) {
        const p = cam.worldToScreen(s.x, s.y);
        const cx = p.x * this.scale;
        const cy = p.y * this.scale;
        const r = Math.max(4, s.influence * cam.zoom * this.scale);
        if (cx + r < 0 || cx - r > w || cy + r < 0 || cy - r > h) continue;
        const g = this.fctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, 'rgba(255,255,255,0.9)');
        g.addColorStop(0.55, 'rgba(255,255,255,0.28)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        this.fctx.fillStyle = g;
        this.fctx.beginPath();
        this.fctx.arc(cx, cy, r, 0, Math.PI * 2);
        this.fctx.fill();
      }
      this.fctx.globalCompositeOperation = 'source-over';

      // 2. Threshold the field into fill + rim, writing empire colour.
      const fd = this.fctx.getImageData(0, 0, w, h).data;
      for (let i = 0; i < fd.length; i += 4) {
        const v = fd[i]; // accumulated red channel = field strength
        if (v < this.THRESHOLD) continue;
        const rim = v < this.THRESHOLD + this.RIM;
        if (rim) {
          // Bright glowing border.
          rd[i] = Math.min(255, er + 90);
          rd[i + 1] = Math.min(255, eg + 90);
          rd[i + 2] = Math.min(255, eb + 90);
          rd[i + 3] = 235;
        } else {
          // Territory fill (semi-transparent). Don't stomp an existing rim.
          if (rd[i + 3] >= 235) continue;
          rd[i] = er;
          rd[i + 1] = eg;
          rd[i + 2] = eb;
          rd[i + 3] = Math.round(255 * this.FILL_ALPHA);
        }
      }
    }

    this.octx.putImageData(result, 0, 0);

    // 3. Upscale onto the map canvas; smoothing softens the low-res edges.
    target.imageSmoothingEnabled = true;
    target.drawImage(this.out, 0, 0, w, h, 0, 0, cam.viewW, cam.viewH);
  }
}
