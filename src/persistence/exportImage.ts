import { GalaxyMap, ID } from '../model/types';
import { resolveDisplay } from '../model/display';
import { Camera } from '../render/camera';
import { Renderer } from '../render/renderer';
import {
  collectLegend,
  drawLegend,
  DEFAULT_LEGEND,
  LegendOptions,
  WorldRect,
} from '../render/legend';
import { preloadReferences } from '../render/references';

export type ExportMode = 'viewport' | 'galaxy' | 'empire';

export interface ImageExportOptions {
  mode: ExportMode;
  /** the empires to keep in colour when mode === 'empire'; the rest go grey */
  empireIds?: readonly ID[];
  /** longest side of the output image, in px */
  maxSize: number;
  transparent?: boolean;
  /** draw the reference images that are marked for export (off by default) */
  references?: boolean;
  legend?: boolean;
  /** how the legend is built and placed; omitted means the defaults */
  legendOptions?: LegendOptions;
  filename?: string;
}

/** Browsers refuse canvases beyond roughly this on a side. */
const CANVAS_LIMIT = 16384;

/** World bounds of everything drawn on the map, or null if it is empty. */
export function mapBounds(
  map: GalaxyMap,
  empireIds?: readonly ID[]
): WorldRect | null {
  const focus = empireIds && empireIds.length > 0 ? new Set(empireIds) : null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = (x: number, y: number, pad = 0) => {
    if (x - pad < minX) minX = x - pad;
    if (y - pad < minY) minY = y - pad;
    if (x + pad > maxX) maxX = x + pad;
    if (y + pad > maxY) maxY = y + pad;
  };

  for (const s of Object.values(map.systems)) {
    // When focusing one empire, frame that empire — everything else is context
    // that may or may not fall inside the shot.
    if (focus && (!s.ownerId || !focus.has(s.ownerId))) continue;
    add(s.x, s.y, s.influence);
  }
  if (!focus) {
    for (const n of Object.values(map.nebulae)) {
      for (const b of n.blobs) add(b.x, b.y, b.r);
    }
    for (const o of Object.values(map.objects)) add(o.x, o.y, 10);
    for (const r of Object.values(map.regions)) add(r.x, r.y, r.size);
    for (const a of Object.values(map.annotations)) {
      for (const p of a.points) add(p.x, p.y, 10);
    }
    // A reference only widens the shot when it is going to be in it.
    for (const r of Object.values(map.references ?? {})) {
      if (!r.exported) continue;
      add(r.x, r.y);
      add(r.x + r.w, r.y + r.h);
    }
  }
  if (!isFinite(minX)) return null;

  // A little air around the content.
  const padX = (maxX - minX) * 0.04 + 30;
  const padY = (maxY - minY) * 0.04 + 30;
  return {
    minX: minX - padX,
    minY: minY - padY,
    maxX: maxX + padX,
    maxY: maxY + padY,
  };
}

/** The world rectangle a camera currently shows. */
export function viewportBounds(cam: Camera): WorldRect {
  const a = cam.screenToWorld(0, 0);
  const b = cam.screenToWorld(cam.viewW, cam.viewH);
  return { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y };
}

/**
 * Recolour every empire outside `focus` in neutral grey, so the chosen ones —
 * one, or an alliance, or the two sides of a war — keep their own fill and
 * border while the rest read as context. Doing it on a copy of the map, rather
 * than teaching the renderer about a "focus" mode, keeps the drawing code
 * unaware that exports exist; it just draws the map it is given.
 */
function greyOthers(map: GalaxyMap, focus: readonly ID[]): GalaxyMap {
  const keep = new Set(focus);
  const empires: GalaxyMap['empires'] = {};
  for (const e of Object.values(map.empires)) {
    empires[e.id] = keep.has(e.id)
      ? e
      : { ...e, color: '#5d6472', borderColor: '#8b93a3' };
  }
  return { ...map, empires };
}

/**
 * Render the map to an offscreen canvas. Shared by every export mode: they only
 * differ in which world rectangle they frame and which map they hand over.
 */
export function renderMapToCanvas(
  map: GalaxyMap,
  rect: WorldRect,
  opts: ImageExportOptions
): HTMLCanvasElement {
  const worldW = Math.max(1, rect.maxX - rect.minX);
  const worldH = Math.max(1, rect.maxY - rect.minY);
  const longest = Math.min(opts.maxSize, CANVAS_LIMIT);
  const scale = longest / Math.max(worldW, worldH);
  const w = Math.max(1, Math.round(worldW * scale));
  const h = Math.max(1, Math.round(worldH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  const drawMap =
    opts.mode === 'empire' && opts.empireIds?.length
      ? greyOthers(map, opts.empireIds)
      : map;

  const cam = new Camera();
  cam.setViewport(w, h);
  cam.fit(rect.minX, rect.minY, rect.maxX, rect.maxY, 1);

  // A private renderer so the export never disturbs the live view's caches.
  const renderer = new Renderer();
  renderer.draw(ctx, drawMap, cam, {
    selection: [],
    selectedEntity: null,
    connectFromId: null,
    transparent: opts.transparent,
    references: opts.references ? 'exported' : false,
  });

  if (opts.legend) {
    const dsp = resolveDisplay(map.display);
    const legendOpts = opts.legendOptions ?? DEFAULT_LEGEND;
    const groups = collectLegend(
      map,
      viewportBounds(cam),
      dsp,
      opts.mode === 'empire' ? opts.empireIds : null,
      legendOpts
    );
    // Keep the panel a sane fraction of the image on huge exports.
    drawLegend(
      ctx,
      groups,
      w,
      h,
      Math.max(1, Math.min(4, longest / 1400)),
      legendOpts
    );
  }

  return canvas;
}

export async function exportMapImage(
  map: GalaxyMap,
  cam: Camera,
  opts: ImageExportOptions
): Promise<void> {
  // The viewport rectangle already carries the screen's aspect ratio, so every
  // mode is just "frame this world rectangle at this resolution".
  const rect: WorldRect | null =
    opts.mode === 'viewport'
      ? viewportBounds(cam)
      : mapBounds(map, opts.mode === 'empire' ? opts.empireIds : undefined);

  if (!rect) throw new Error('Nothing to export.');

  // The offscreen render happens once and synchronously, so anything it needs
  // decoded has to be decoded first — the live canvas gets a second chance by
  // redrawing, an export does not.
  if (opts.references) await preloadReferences(map);

  const canvas = renderMapToCanvas(map, rect, opts);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(
          new Error(
            'The image is too large for the browser to encode — try a smaller resolution.'
          )
        );
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = opts.filename ?? 'galaxy.png';
      a.click();
      URL.revokeObjectURL(url);
      resolve();
    }, 'image/png');
  });
}
