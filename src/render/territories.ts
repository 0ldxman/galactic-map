import { System, Empire } from '../model/types';
import { DisplaySettings, DEFAULT_DISPLAY } from '../model/display';
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

/** One empire's borders, as smoothed vector loops in WORLD coordinates. */
interface Region {
  path: Path2D; // world-space, evenodd (holes = enclaves of others)
  fill: string;
  glow: string;
  edge: string;
}

interface Pt {
  x: number;
  y: number;
}

/**
 * Stellaris-style political borders.
 *
 * Ownership is first solved on a coarse WORLD-space grid (each pixel = the
 * argmax of the empires' influence fields, so borders fall on the midpoint
 * between rival systems). But instead of blitting that grid as a raster — which
 * looks like blurry soap when magnified — we trace its region boundaries into
 * smoothed vector loops (marching-squares edge tracing + Chaikin) and cache them
 * as `Path2D` in world coordinates. Every frame we fill/stroke those paths under
 * the camera transform with a constant 2px screen-space outline, so borders stay
 * razor-crisp at any zoom while per-frame cost is just a couple of path fills.
 *
 * The whole thing is rebuilt only when the map changes (tracked by `revision`,
 * and skippable while dragging), never on pan/zoom.
 */
export class TerritoryRenderer {
  private field = document.createElement('canvas');
  private fctx = this.field.getContext('2d', { willReadFrequently: true })!;
  private blur = document.createElement('canvas');
  private bctx = this.blur.getContext('2d', { willReadFrequently: true })!;

  private regions: Region[] = [];
  labels: TerritoryLabel[] = [];

  /** True when a newer revision is waiting on the rebuild throttle. */
  pending = false;
  private builtRevision = -1;
  private lastBuild = 0;

  private readonly THRESHOLD = 46;
  private readonly FRAGMENT_MIN = 24; // grid cells: drop tiny speckle regions
  private readonly LABEL_MIN = 300; // grid cells: smallest region that gets a name

  /** Display settings the cached regions were coloured with. */
  private display: DisplaySettings = DEFAULT_DISPLAY;

  /** Rebuild the cached borders if the map changed (throttled; skippable). */
  update(
    systems: System[],
    empires: Record<string, Empire>,
    revision: number,
    defer = false,
    display: DisplaySettings = DEFAULT_DISPLAY
  ) {
    this.display = display;
    if (revision === this.builtRevision) {
      this.pending = false;
      return;
    }
    if (defer) {
      // e.g. while dragging a system — keep the stale borders, rebuild on drop.
      this.pending = true;
      return;
    }
    // Coalesce rapid bursts of edits (e.g. paint-dragging) so we rebuild at most
    // every ~120ms. The threshold must exceed the build time or it never gates.
    const now = performance.now();
    if (this.builtRevision !== -1 && now - this.lastBuild < 120) {
      this.pending = true;
      return;
    }
    this.pending = false;
    this.lastBuild = now;
    this.builtRevision = revision;
    this.build(systems, empires);
  }

  private build(systems: System[], empires: Record<string, Empire>) {
    this.labels = [];
    this.regions = [];
    const owned = systems.filter(
      (s) => s.ownerId && empires[s.ownerId] && s.influence > 0
    );
    if (owned.length === 0) return;

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

    // Solve ownership on a grid; the vector pass smooths the staircase. Finer
    // cells = smaller steps = smoother borders (at some rebuild cost).
    const ppw = Math.min(1.0, 1100 / Math.max(worldW, worldH));
    const rw = Math.max(1, Math.round(worldW * ppw));
    const rh = Math.max(1, Math.round(worldH * ppw));

    if (this.field.width !== rw || this.field.height !== rh) {
      this.field.width = rw; this.field.height = rh;
      this.blur.width = rw; this.blur.height = rh;
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
    const borderRgb: [number, number, number][] = [];

    let ei = 0;
    for (const [empireId, list] of byEmpire) {
      const emp = empires[empireId];
      const fillRgb = hexToRgb(emp.color);
      empireIds.push(empireId);
      empireRgb.push(fillRgb);
      // An explicit border colour wins; otherwise lighten the fill colour.
      borderRgb.push(
        emp.borderColor
          ? hexToRgb(emp.borderColor)
          : [
              Math.min(255, fillRgb[0] + 90),
              Math.min(255, fillRgb[1] + 90),
              Math.min(255, fillRgb[2] + 90),
            ]
      );

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

    // Trace each empire's cleaned region into smoothed vector loops.
    for (let e = 0; e < K; e++) {
      const path = this.traceRegion(smooth, rw, rh, e, minX, minY, ppw);
      if (!path) continue;
      const [r, g, b] = empireRgb[e];
      const [br, bg, bb] = borderRgb[e];
      this.regions.push({
        path,
        fill: `rgba(${r},${g},${b},${this.display.fillAlpha})`,
        glow: `rgba(${br},${bg},${bb},0.22)`,
        edge: `rgba(${br},${bg},${bb},${this.display.borderAlpha})`,
      });
    }
  }

  /**
   * Marching-squares edge tracing: walk the unit edges between cells of empire
   * `e` and everything else into closed directed loops (inside kept on the
   * right), convert to world coordinates and round the staircase with Chaikin.
   */
  private traceRegion(
    smooth: Int16Array,
    rw: number,
    rh: number,
    e: number,
    minX: number,
    minY: number,
    ppw: number
  ): Path2D | null {
    const RW1 = rw + 1;
    // startVertexId -> list of endVertexIds (a vertex may branch at checkerboard
    // corners, so store all out-edges and consume them by popping).
    const out = new Map<number, number[]>();
    const add = (ax: number, ay: number, bx: number, by: number) => {
      const s = ay * RW1 + ax;
      const arr = out.get(s);
      if (arr) arr.push(by * RW1 + bx);
      else out.set(s, [by * RW1 + bx]);
    };
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        if (smooth[y * rw + x] !== e) continue;
        if (y === 0 || smooth[(y - 1) * rw + x] !== e) add(x, y, x + 1, y); // top
        if (x === rw - 1 || smooth[y * rw + x + 1] !== e) add(x + 1, y, x + 1, y + 1); // right
        if (y === rh - 1 || smooth[(y + 1) * rw + x] !== e) add(x + 1, y + 1, x, y + 1); // bottom
        if (x === 0 || smooth[y * rw + x - 1] !== e) add(x, y + 1, x, y); // left
      }
    }
    if (out.size === 0) return null;

    const path = new Path2D();
    let any = false;
    const invPpw = 1 / ppw;
    for (const [s0, arr0] of out) {
      while (arr0.length) {
        const loop: number[] = [s0];
        let cur = arr0.pop()!;
        loop.push(cur);
        let guard = 0;
        while (cur !== s0 && guard++ < 1_000_000) {
          const nexts = out.get(cur);
          if (!nexts || nexts.length === 0) break;
          cur = nexts.pop()!;
          loop.push(cur);
        }
        // loop[last] === s0; convert (minus the duplicated closing vertex).
        const pts: Pt[] = [];
        for (let i = 0; i < loop.length - 1; i++) {
          const v = loop[i];
          const cx = v % RW1;
          const cy = (v / RW1) | 0;
          pts.push({ x: minX + cx * invPpw, y: minY + cy * invPpw });
        }
        if (pts.length < 2) continue;
        // Collapse the axis-aligned staircase into its corner points first
        // (keeps straights straight), then round the corners with Chaikin.
        const simp = simplifyClosed(pts);
        const sm = simp.length >= 4 ? chaikin(chaikin(chaikin(simp))) : simp;
        path.moveTo(sm[0].x, sm[0].y);
        for (let i = 1; i < sm.length; i++) path.lineTo(sm[i].x, sm[i].y);
        path.closePath();
        any = true;
      }
    }
    return any ? path : null;
  }

  /** Fill + stroke the cached world-space borders under the camera transform. */
  draw(target: CanvasRenderingContext2D, cam: Camera) {
    if (this.regions.length === 0) return;
    const z = cam.zoom;
    target.save();
    target.translate(cam.viewW / 2 - cam.x * z, cam.viewH / 2 - cam.y * z);
    target.scale(z, z);
    target.lineJoin = 'round';
    target.lineCap = 'round';

    // Fill + a single crisp outline (fixed 2px on screen). Kept to two path
    // traversals per region for performance while panning.
    for (const rg of this.regions) {
      target.fillStyle = rg.fill;
      target.fill(rg.path, 'evenodd');
    }
    target.lineWidth = this.display.borderWidth / z;
    for (const rg of this.regions) {
      target.strokeStyle = rg.edge;
      target.stroke(rg.path);
    }
    target.restore();
  }
}

/** One Chaikin corner-cutting pass on a closed polygon. */
function chaikin(pts: Pt[]): Pt[] {
  const n = pts.length;
  const out: Pt[] = new Array(n * 2);
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    out[i * 2] = { x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 };
    out[i * 2 + 1] = { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 };
  }
  return out;
}

/** Drop points that lie on a straight run, keeping only the corners. */
function simplifyClosed(pts: Pt[]): Pt[] {
  const n = pts.length;
  if (n < 3) return pts;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n];
    const b = pts[i];
    const c = pts[(i + 1) % n];
    // Cross product of (b-a) and (c-b): ~0 means b is collinear -> redundant.
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) > 1e-6) out.push(b);
  }
  return out.length >= 3 ? out : pts;
}
