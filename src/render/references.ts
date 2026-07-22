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
  for (const [cx, cy] of cornerPoints(p.x, p.y, w, h)) {
    ctx.beginPath();
    ctx.rect(cx - HANDLE / 2, cy - HANDLE / 2, HANDLE, HANDLE);
    ctx.fill();
    ctx.stroke();
  }
}

/** Half-width of a corner grab handle, in screen px. */
export const HANDLE = 9;

/** The four corners in a fixed order: TL, TR, BR, BL. */
export function cornerPoints(
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
  ];
}

/** Which corner handle is under (sx, sy), or -1. */
export function hitCorner(
  r: RefImage,
  sx: number,
  sy: number,
  cam: Camera
): number {
  const p = cam.worldToScreen(r.x, r.y);
  const corners = cornerPoints(p.x, p.y, r.w * cam.zoom, r.h * cam.zoom);
  for (let i = 0; i < corners.length; i++) {
    if (
      Math.abs(sx - corners[i][0]) <= HANDLE &&
      Math.abs(sy - corners[i][1]) <= HANDLE
    ) {
      return i;
    }
  }
  return -1;
}
