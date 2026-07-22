import { GalaxyMap, RefImage } from '../model/types';
import { Camera } from './camera';

/**
 * Decoded reference bitmaps, shared by every renderer.
 *
 * The cache is module-level rather than per-`Renderer` on purpose: an export
 * builds its own private renderer, and re-decoding a handful of megabytes for
 * it would be silly when the live view already holds the same images. Keying on
 * the data URI means an image is decoded once however many maps reference it.
 */
const cache = new Map<string, HTMLImageElement>();
const listeners = new Set<() => void>();

/** Called when a bitmap finishes decoding, so the canvas can redraw. */
export function onImageReady(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * The decoded bitmap for `src`, or null while it is still loading. Starts the
 * load on first ask — drawing code can call this every frame without thinking.
 */
export function getImage(src: string): HTMLImageElement | null {
  const hit = cache.get(src);
  if (hit) return hit.complete && hit.naturalWidth > 0 ? hit : null;
  const img = new Image();
  cache.set(src, img);
  img.onload = () => {
    for (const fn of listeners) fn();
  };
  img.onerror = () => {
    // Leave the entry in place; retrying every frame would spin forever.
    for (const fn of listeners) fn();
  };
  img.src = src;
  return null;
}

/**
 * Wait for every reference in the map to be decoded. The live canvas doesn't
 * need this — it redraws when they arrive — but an export renders once into an
 * offscreen canvas and has no second chance.
 */
export function preloadReferences(map: GalaxyMap): Promise<void> {
  const pending = Object.values(map.references ?? {})
    .filter((r) => !getImage(r.src))
    .map(
      (r) =>
        new Promise<void>((resolve) => {
          const img = cache.get(r.src);
          if (!img) return resolve();
          if (img.complete) return resolve();
          img.addEventListener('load', () => resolve(), { once: true });
          img.addEventListener('error', () => resolve(), { once: true });
        })
    );
  return Promise.all(pending).then(() => undefined);
}

/** Draw the references on one layer, oldest first so later ones sit on top. */
export function drawReferences(
  ctx: CanvasRenderingContext2D,
  map: GalaxyMap,
  cam: Camera,
  layer: 'below' | 'above',
  opts: { exportedOnly?: boolean; selectedId?: string | null } = {}
) {
  const list = Object.values(map.references ?? {}).filter(
    (r) => (r.layer ?? 'below') === layer && (!opts.exportedOnly || r.exported)
  );
  if (list.length === 0) return;

  for (const r of list) {
    const img = getImage(r.src);
    if (!img) continue;
    const p = cam.worldToScreen(r.x, r.y);
    const w = r.w * cam.zoom;
    const h = r.h * cam.zoom;
    if (p.x > cam.viewW || p.y > cam.viewH || p.x + w < 0 || p.y + h < 0) continue;
    ctx.globalAlpha = Math.max(0, Math.min(1, r.opacity));
    ctx.drawImage(img, p.x, p.y, w, h);
    ctx.globalAlpha = 1;
  }

  // The frame and its grab handles are editing furniture, so they are drawn
  // only for the picked image and never on an export (which passes no id).
  const sel = opts.selectedId ? map.references?.[opts.selectedId] : null;
  if (!sel || (sel.layer ?? 'below') !== layer) return;
  const p = cam.worldToScreen(sel.x, sel.y);
  const w = sel.w * cam.zoom;
  const h = sel.h * cam.zoom;
  ctx.strokeStyle = sel.locked ? 'rgba(255,210,120,0.9)' : 'rgba(120,160,255,0.95)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash(sel.locked ? [3, 3] : []);
  ctx.strokeRect(p.x + 0.5, p.y + 0.5, w, h);
  ctx.setLineDash([]);
  if (sel.locked) return;
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 1;
  const pts = handlePoints(p.x, p.y, w, h);
  for (let i = 0; i < pts.length; i++) {
    const [cx, cy] = pts[i];
    // Corners are square, edge grips are flattened along the edge they own —
    // the shape is the affordance: this one only moves that side.
    const bw = i < 4 ? HANDLE : i === 5 || i === 7 ? HANDLE * 0.55 : HANDLE * 1.5;
    const bh = i < 4 ? HANDLE : i === 4 || i === 6 ? HANDLE * 0.55 : HANDLE * 1.5;
    ctx.beginPath();
    ctx.rect(cx - bw / 2, cy - bh / 2, bw, bh);
    ctx.fill();
    ctx.stroke();
  }
}

/** Half-width of a corner grab handle, in screen px. */
export const HANDLE = 9;

/**
 * The eight grab points, in a fixed order the resize maths depends on:
 * 0–3 corners TL, TR, BR, BL — then 4–7 edges top, right, bottom, left.
 *
 * The edges are what a game screenshot usually needs: the galaxy is drawn in
 * perspective, so squaring it up means stretching one axis alone rather than
 * scaling the picture.
 */
export function handlePoints(
  x: number,
  y: number,
  w: number,
  h: number
): [number, number][] {
  return [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
    [x + w / 2, y],
    [x + w, y + h / 2],
    [x + w / 2, y + h],
    [x, y + h / 2],
  ];
}

/** True for the four indices that move one side only. */
export function isEdgeHandle(i: number) {
  return i >= 4;
}

/** The mouse cursor a handle should show. */
export const HANDLE_CURSORS = [
  'nwse-resize', 'nesw-resize', 'nwse-resize', 'nesw-resize',
  'ns-resize', 'ew-resize', 'ns-resize', 'ew-resize',
];

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Nothing may be dragged smaller than this, in world units. */
const MIN_SIDE = 4;

/**
 * The rectangle that results from dragging handle `g` of `r0` to the world
 * point (wx, wy).
 *
 * A corner scales the picture, holding its proportions unless `freeAspect`;
 * a side moves that one edge and nails the opposite one down, which is how a
 * screenshot drawn in perspective gets squared up. Either way the geometry the
 * author is not touching stays exactly where it was.
 */
export function resizeRect(
  r0: Rect,
  g: number,
  wx: number,
  wy: number,
  freeAspect = false
): Rect {
  let { x, y, w, h } = r0;

  if (isEdgeHandle(g)) {
    if (g === 4) {
      h = Math.max(MIN_SIDE, r0.y + r0.h - wy);
      y = r0.y + r0.h - h;
    } else if (g === 6) {
      h = Math.max(MIN_SIDE, wy - r0.y);
    } else if (g === 5) {
      w = Math.max(MIN_SIDE, wx - r0.x);
    } else {
      w = Math.max(MIN_SIDE, r0.x + r0.w - wx);
      x = r0.x + r0.w - w;
    }
    return { x, y, w, h };
  }

  // The opposite corner stays put; the dragged one follows the pointer.
  const fx = g === 1 || g === 2 ? r0.x : r0.x + r0.w;
  const fy = g === 2 || g === 3 ? r0.y : r0.y + r0.h;
  w = Math.abs(wx - fx);
  h = Math.abs(wy - fy);
  if (!freeAspect && r0.w > 0 && r0.h > 0) {
    const k = Math.max(w / r0.w, h / r0.h);
    w = r0.w * k;
    h = r0.h * k;
  }
  w = Math.max(MIN_SIDE, w);
  h = Math.max(MIN_SIDE, h);
  x = g === 1 || g === 2 ? fx : fx - w;
  y = g === 2 || g === 3 ? fy : fy - h;
  return { x, y, w, h };
}

/**
 * Which handle is under (sx, sy), or -1. Corners are tested first: they sit at
 * the ends of the edges, and when the two overlap the corner is what a person
 * aiming at the very end of a side meant.
 */
export function hitHandle(
  r: RefImage,
  sx: number,
  sy: number,
  cam: Camera
): number {
  const p = cam.worldToScreen(r.x, r.y);
  const pts = handlePoints(p.x, p.y, r.w * cam.zoom, r.h * cam.zoom);
  for (let i = 0; i < pts.length; i++) {
    const tol = i < 4 ? HANDLE : HANDLE * 0.8;
    if (Math.abs(sx - pts[i][0]) <= tol && Math.abs(sy - pts[i][1]) <= tol) {
      return i;
    }
  }
  return -1;
}
