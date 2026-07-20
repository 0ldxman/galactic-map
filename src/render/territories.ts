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
 * Renders Stellaris-style political borders.
 *
 * Unlike a naive "paint younger over older" overlay, each pixel is assigned to
 * the empire whose influence field is *strongest* there (an argmax, not a sum
 * across empires). Because two neighbouring systems of different empires have
 * equal-strength fields exactly halfway between them, the border between two
 * nations naturally falls on the midpoint — just like the game. Systems of the
 * *same* empire accumulate additively, so their circles merge into one organic
 * blob with no internal seams.
 *
 * The owner map is computed at reduced resolution; fill is drawn very
 * translucent and every region gets a crisp 2–3px outline where it meets a
 * different empire or open space.
 */
export class TerritoryRenderer {
  private field: HTMLCanvasElement;
  private fctx: CanvasRenderingContext2D;
  private out: HTMLCanvasElement;
  private octx: CanvasRenderingContext2D;
  private scale = 0.75;

  // Field strength (0..255) a pixel needs before it counts as claimed.
  private readonly THRESHOLD = 46;
  // Territory fill opacity — kept low so the map underneath stays readable.
  private readonly FILL_ALPHA = 0.15;
  // Outline opacity.
  private readonly EDGE_ALPHA = 0.95;

  // Reusable buffers (grown as the viewport changes).
  private best = new Float32Array(0);
  private owner = new Int16Array(0);

  constructor() {
    this.field = document.createElement('canvas');
    this.fctx = this.field.getContext('2d', { willReadFrequently: true })!;
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
    const px = w * h;
    if (this.best.length !== px) {
      this.best = new Float32Array(px);
      this.owner = new Int16Array(px);
    }
    this.best.fill(0);
    this.owner.fill(-1);

    // Group owned systems by empire and give each empire a stable index.
    const byEmpire = new Map<string, System[]>();
    for (const s of systems) {
      if (!s.ownerId || !empires[s.ownerId]) continue;
      const arr = byEmpire.get(s.ownerId) ?? [];
      arr.push(s);
      byEmpire.set(s.ownerId, arr);
    }

    const empireIds: string[] = [];
    const empireRgb: [number, number, number][] = [];

    let ei = 0;
    for (const [empireId, owned] of byEmpire) {
      empireIds.push(empireId);
      empireRgb.push(hexToRgb(empires[empireId].color));

      // Accumulate this empire's influence field (additive within the empire).
      this.fctx.clearRect(0, 0, w, h);
      this.fctx.globalCompositeOperation = 'lighter';
      for (const s of owned) {
        const p = cam.worldToScreen(s.x, s.y);
        const cx = p.x * this.scale;
        const cy = p.y * this.scale;
        const r = Math.max(3, s.influence * cam.zoom * this.scale);
        if (cx + r < 0 || cx - r > w || cy + r < 0 || cy - r > h) continue;
        const g = this.fctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        // Fairly linear falloff -> equal-strength midpoint between two systems.
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(0.6, 'rgba(255,255,255,0.45)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        this.fctx.fillStyle = g;
        this.fctx.beginPath();
        this.fctx.arc(cx, cy, r, 0, Math.PI * 2);
        this.fctx.fill();
      }
      this.fctx.globalCompositeOperation = 'source-over';

      // Keep, per pixel, the strongest empire (argmax = nearest / midpoint).
      const fd = this.fctx.getImageData(0, 0, w, h).data;
      const best = this.best;
      const owner = this.owner;
      for (let i = 0, p = 0; p < px; i += 4, p++) {
        const v = fd[i]; // red channel == accumulated field strength
        if (v > best[p]) {
          best[p] = v;
          owner[p] = ei;
        }
      }
      ei++;
    }

    const T = this.THRESHOLD;
    const K = empireIds.length;

    // Discrete ownership per pixel (empire index, or -1 for open space).
    const best = this.best;
    const owner = this.owner;
    const cell = new Int16Array(px);
    for (let p = 0; p < px; p++) cell[p] = best[p] >= T ? owner[p] : -1;

    // One majority-filter pass: replace each pixel with the most common owner in
    // its 3x3 neighbourhood. This dissolves the salt-and-pepper speckle in the
    // sparse neutral buffers between empires and smooths the border contour.
    const smooth = new Int16Array(px);
    const counts = new Int32Array(Math.max(1, K));
    const touched: number[] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let neg = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= h) { neg += 3; continue; }
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= w) { neg++; continue; }
            const lab = cell[ny * w + nx];
            if (lab < 0) neg++;
            else {
              if (counts[lab] === 0) touched.push(lab);
              counts[lab]++;
            }
          }
        }
        let m = -1;
        let cm = 0;
        for (const t of touched) {
          if (counts[t] > cm) { cm = counts[t]; m = t; }
          counts[t] = 0;
        }
        touched.length = 0;
        smooth[y * w + x] = cm > neg ? m : -1;
      }
    }

    // Compose the output: translucent fill + crisp outline at region borders.
    const result = this.octx.createImageData(w, h);
    const rd = result.data;
    const fillA = Math.round(255 * this.FILL_ALPHA);
    const edgeA = Math.round(255 * this.EDGE_ALPHA);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        const o = smooth[p];
        if (o < 0) continue;

        // Border if any 8-neighbour belongs to a different (or no) empire.
        let border = false;
        for (let dy = -1; dy <= 1 && !border; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = x + dx;
            const ny = y + dy;
            const no =
              nx < 0 || ny < 0 || nx >= w || ny >= h
                ? -1
                : smooth[ny * w + nx];
            if (no !== o) {
              border = true;
              break;
            }
          }
        }

        const [er, eg, eb] = empireRgb[o];
        const i = p * 4;
        if (border) {
          // Brighter, saturated outline colour.
          rd[i] = Math.min(255, er + 70);
          rd[i + 1] = Math.min(255, eg + 70);
          rd[i + 2] = Math.min(255, eb + 70);
          rd[i + 3] = edgeA;
        } else {
          rd[i] = er;
          rd[i + 1] = eg;
          rd[i + 2] = eb;
          rd[i + 3] = fillA;
        }
      }
    }

    this.octx.putImageData(result, 0, 0);

    // Upscale onto the map canvas; light smoothing anti-aliases the outline.
    target.imageSmoothingEnabled = true;
    target.imageSmoothingQuality = 'high';
    target.drawImage(this.out, 0, 0, w, h, 0, 0, cam.viewW, cam.viewH);
  }
}
