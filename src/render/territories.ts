import { System, Empire } from '../model/types';
import { Camera } from './camera';

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(
    h.length === 3 ? h.split('').map((c) => c + c).join('') : h,
    16
  );
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** A place to draw an empire's name: the centroid of one contiguous region. */
export interface TerritoryLabel {
  empireId: string;
  x: number; // world
  y: number; // world
  area: number; // world units squared (drives label size)
}

/**
 * Renders Stellaris-style political borders — but the expensive part (the
 * per-pixel field, threshold, smoothing, connected-component and border passes)
 * runs in WORLD space and is cached. It is only rebuilt when the map changes
 * (throttled), never on pan/zoom. Every frame we just blit the cached raster
 * through the camera transform, which is cheap.
 *
 * Ownership at each pixel is the argmax of the empires' influence fields, where
 * each empire's field is the pixel-wise MAX (not sum) of its systems' discs — so
 * borders sit on the midpoint between neighbouring systems of different empires,
 * with no speckle from overlapping rims.
 */
export class TerritoryRenderer {
  private raster = document.createElement('canvas');
  private rctx = this.raster.getContext('2d')!;
  private field = document.createElement('canvas');
  private fctx = this.field.getContext('2d', { willReadFrequently: true })!;
  private blur = document.createElement('canvas');
  private bctx = this.blur.getContext('2d', { willReadFrequently: true })!;

  private minX = 0;
  private minY = 0;
  private ppw = 1; // raster pixels per world unit
  private rw = 0;
  private rh = 0;
  private hasContent = false;

  labels: TerritoryLabel[] = [];
  /** True when a newer revision is waiting on the rebuild throttle. */
  pending = false;
  private builtRevision = -1;
  private lastBuild = 0;

  private readonly THRESHOLD = 46;
  private readonly FILL_ALPHA = 0.13;
  private readonly EDGE_ALPHA = 0.9;
  private readonly FRAGMENT_MIN = 28; // px: drop tiny speckle regions
  private readonly LABEL_MIN = 520; // px: only label regions at least this big

  /** Rebuild the cached raster if the map changed (throttled). */
  update(systems: System[], empires: Record<string, Empire>, revision: number) {
    (window as unknown as { __tlog: unknown }).__tlog = { revision, built: this.builtRevision };
    if (revision === this.builtRevision) {
      this.pending = false;
      return;
    }
    (window as unknown as { __tbuilds: number }).__tbuilds =
      ((window as unknown as { __tbuilds: number }).__tbuilds || 0) + 1;
    const now = performance.now();
    if (this.builtRevision !== -1 && now - this.lastBuild < 110) {
      this.pending = true; // too soon — keep the stale raster for now
      return;
    }
    this.pending = false;
    this.lastBuild = now;
    this.builtRevision = revision;
    this.build(systems, empires);
  }

  private build(systems: System[], empires: Record<string, Empire>) {
    this.labels = [];
    const owned = systems.filter(
      (s) => s.ownerId && empires[s.ownerId] && s.influence > 0
    );
    if (owned.length === 0) {
      this.hasContent = false;
      return;
    }

    // World bounds of all territory, padded by the largest influence radius.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let maxInf = 0;
    for (const s of owned) {
      if (s.x < minX) minX = s.x;
      if (s.y < minY) minY = s.y;
      if (s.x > maxX) maxX = s.x;
      if (s.y > maxY) maxY = s.y;
      if (s.influence > maxInf) maxInf = s.influence;
    }
    const pad = maxInf * 1.15;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    const worldW = maxX - minX;
    const worldH = maxY - minY;

    // Resolution: cap the longest side so rebuild cost stays bounded.
    const ppw = Math.min(1.2, 1200 / Math.max(worldW, worldH));
    const rw = Math.max(1, Math.round(worldW * ppw));
    const rh = Math.max(1, Math.round(worldH * ppw));
    this.minX = minX; this.minY = minY; this.ppw = ppw; this.rw = rw; this.rh = rh;

    if (this.field.width !== rw || this.field.height !== rh) {
      this.field.width = rw; this.field.height = rh;
      this.blur.width = rw; this.blur.height = rh;
      this.raster.width = rw; this.raster.height = rh;
    }
    const px = rw * rh;
    const best = new Float32Array(px);
    const owner = new Int16Array(px).fill(-1);

    // Group owned systems by empire.
    const byEmpire = new Map<string, System[]>();
    for (const s of owned) {
      const arr = byEmpire.get(s.ownerId!) ?? [];
      arr.push(s);
      byEmpire.set(s.ownerId!, arr);
    }
    const empireIds: string[] = [];
    const empireRgb: [number, number, number][] = [];

    let ei = 0;
    for (const [empireId, list] of byEmpire) {
      empireIds.push(empireId);
      empireRgb.push(hexToRgb(empires[empireId].color));

      // Empire field = pixel-wise MAX of its systems' discs (nearest-system).
      this.fctx.globalCompositeOperation = 'source-over';
      this.fctx.fillStyle = '#000';
      this.fctx.fillRect(0, 0, rw, rh);
      this.fctx.globalCompositeOperation = 'lighten';
      for (const s of list) {
        const cx = (s.x - minX) * ppw;
        const cy = (s.y - minY) * ppw;
        const r = Math.max(3, s.influence * ppw);
        const g = this.fctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(0.7, '#e0e0e0');
        g.addColorStop(0.9, '#525252');
        g.addColorStop(1, '#000000');
        this.fctx.fillStyle = g;
        this.fctx.beginPath();
        this.fctx.arc(cx, cy, r, 0, Math.PI * 2);
        this.fctx.fill();
      }
      this.fctx.globalCompositeOperation = 'source-over';

      // Light blur so the threshold contour is smooth.
      this.bctx.clearRect(0, 0, rw, rh);
      this.bctx.filter = 'blur(2px)';
      this.bctx.drawImage(this.field, 0, 0);
      this.bctx.filter = 'none';

      const fd = this.bctx.getImageData(0, 0, rw, rh).data;
      for (let i = 0, p = 0; p < px; i += 4, p++) {
        const v = fd[i];
        if (v > best[p]) { best[p] = v; owner[p] = ei; }
      }
      ei++;
    }

    const T = this.THRESHOLD;
    const K = empireIds.length;

    // Discrete ownership.
    const cell = new Int16Array(px);
    for (let p = 0; p < px; p++) cell[p] = best[p] >= T ? owner[p] : -1;

    // Majority filter (smooths the contour, kills stray pixels).
    const smooth = new Int16Array(px);
    const counts = new Int32Array(Math.max(1, K));
    const touched: number[] = [];
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        let neg = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= rh) { neg += 3; continue; }
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= rw) { neg++; continue; }
            const lab = cell[ny * rw + nx];
            if (lab < 0) neg++;
            else { if (counts[lab] === 0) touched.push(lab); counts[lab]++; }
          }
        }
        let m = -1, cm = 0;
        for (const t of touched) { if (counts[t] > cm) { cm = counts[t]; m = t; } counts[t] = 0; }
        touched.length = 0;
        smooth[y * rw + x] = cm > neg ? m : -1;
      }
    }

    // Connected components: drop fragments, collect label anchors (centroids).
    const visited = new Uint8Array(px);
    const stack: number[] = [];
    const comp: number[] = [];
    for (let s = 0; s < px; s++) {
      if (visited[s] || smooth[s] < 0) continue;
      const o = smooth[s];
      comp.length = 0; stack.length = 0;
      stack.push(s); visited[s] = 1;
      let sx = 0, sy = 0;
      while (stack.length) {
        const p = stack.pop()!;
        comp.push(p);
        const x = p % rw, y = (p / rw) | 0;
        sx += x; sy += y;
        if (x > 0 && !visited[p - 1] && smooth[p - 1] === o) { visited[p - 1] = 1; stack.push(p - 1); }
        if (x < rw - 1 && !visited[p + 1] && smooth[p + 1] === o) { visited[p + 1] = 1; stack.push(p + 1); }
        if (y > 0 && !visited[p - rw] && smooth[p - rw] === o) { visited[p - rw] = 1; stack.push(p - rw); }
        if (y < rh - 1 && !visited[p + rw] && smooth[p + rw] === o) { visited[p + rw] = 1; stack.push(p + rw); }
      }
      if (comp.length < this.FRAGMENT_MIN) {
        for (const p of comp) smooth[p] = -1;
      } else if (comp.length >= this.LABEL_MIN) {
        const n = comp.length;
        this.labels.push({
          empireId: empireIds[o],
          x: minX + sx / n / ppw,
          y: minY + sy / n / ppw,
          area: n / (ppw * ppw),
        });
      }
    }

    // Compose raster: translucent fill + crisp outline at region borders.
    const result = this.rctx.createImageData(rw, rh);
    const rd = result.data;
    const fillA = Math.round(255 * this.FILL_ALPHA);
    const edgeA = Math.round(255 * this.EDGE_ALPHA);
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        const p = y * rw + x;
        const o = smooth[p];
        if (o < 0) continue;
        let border = false;
        for (let dy = -1; dy <= 1 && !border; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = x + dx, ny = y + dy;
            const no = nx < 0 || ny < 0 || nx >= rw || ny >= rh ? -1 : smooth[ny * rw + nx];
            if (no !== o) { border = true; break; }
          }
        }
        const [er, eg, eb] = empireRgb[o];
        const i = p * 4;
        if (border) {
          rd[i] = Math.min(255, er + 70);
          rd[i + 1] = Math.min(255, eg + 70);
          rd[i + 2] = Math.min(255, eb + 70);
          rd[i + 3] = edgeA;
        } else {
          rd[i] = er; rd[i + 1] = eg; rd[i + 2] = eb; rd[i + 3] = fillA;
        }
      }
    }
    this.rctx.putImageData(result, 0, 0);
    this.hasContent = true;
  }

  /** Blit the cached world-space raster through the camera. Cheap per frame. */
  draw(target: CanvasRenderingContext2D, cam: Camera) {
    if (!this.hasContent) return;
    const p0 = cam.worldToScreen(this.minX, this.minY);
    const w = (this.rw / this.ppw) * cam.zoom;
    const h = (this.rh / this.ppw) * cam.zoom;
    if (p0.x + w < 0 || p0.x > cam.viewW || p0.y + h < 0 || p0.y > cam.viewH) return;
    target.imageSmoothingEnabled = true;
    target.imageSmoothingQuality = 'high';
    target.drawImage(this.raster, 0, 0, this.rw, this.rh, p0.x, p0.y, w, h);
  }
}
