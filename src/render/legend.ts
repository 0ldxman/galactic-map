import { GalaxyMap, ID } from '../model/types';
import { DisplaySettings } from '../model/display';
import {
  STATUS_BY_ID,
  STATUS_TYPES,
  makePatternTile,
  statusOf,
  occupierOf,
} from '../model/status';
import { OBJECT_BY_ID } from '../model/objects';
import { MARKER_BY_ID } from '../model/markers';
import { sectorSystems } from '../model/sectors';
import { hexToRgb, lighten } from '../util/color';
import { drawObjectIcon } from './icons';

export interface WorldRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

type EntryKind = 'empire' | 'status' | 'object' | 'marker' | 'nebula' | 'region';

/** Which groups the legend may contain, in the order it draws them. */
export type LegendSection =
  | 'empires'
  | 'statuses'
  | 'objects'
  | 'markers'
  | 'sectors'
  | 'nebulae';

export const LEGEND_SECTIONS: { id: LegendSection; label: string }[] = [
  { id: 'empires', label: 'Empires' },
  { id: 'statuses', label: 'Hold status' },
  { id: 'objects', label: 'Objects' },
  { id: 'markers', label: 'Markers' },
  { id: 'sectors', label: 'Sectors' },
  { id: 'nebulae', label: 'Nebulae' },
];

export type LegendCorner = 'bl' | 'br' | 'tl' | 'tr';

/**
 * How the legend is built and drawn.
 *
 * It used to collect whatever happened to be in the shot, which is right by
 * default and wrong the moment you want a clean picture: twelve empires listed
 * because one system of each grazed the frame. So the contents are choosable —
 * which sections, and which empires within them — while the defaults keep the
 * old "just show me what's here" behaviour.
 */
export interface LegendOptions {
  sections: LegendSection[];
  /** empire ids to list; empty = whatever is in the shot */
  empireIds?: readonly ID[];
  /** list every empire on the map, not only those inside the frame */
  allEmpires?: boolean;
  corner: LegendCorner;
  /** panel size multiplier on top of the export's own scaling */
  scale: number;
  /** 0..1 backdrop opacity; 0 draws the text straight onto the map */
  background: number;
  title?: string;
}

export const DEFAULT_LEGEND: LegendOptions = {
  sections: ['empires', 'statuses', 'objects', 'markers', 'sectors', 'nebulae'],
  corner: 'bl',
  scale: 1,
  background: 0.82,
};

export interface LegendEntry {
  kind: EntryKind;
  label: string;
  color: string;
  borderColor?: string;
  /** status id / object kind / marker id, for drawing the swatch */
  key?: string;
}

export interface LegendGroup {
  title: string;
  entries: LegendEntry[];
}

function inside(r: WorldRect, x: number, y: number) {
  return x >= r.minX && x <= r.maxX && y >= r.minY && y <= r.maxY;
}

/**
 * Build the legend from what is actually inside `rect` — so an export of one
 * corner of the galaxy lists only the empires, statuses and objects visible in
 * that corner, and an export focused on a single empire lists just that one.
 */
export function collectLegend(
  map: GalaxyMap,
  rect: WorldRect,
  dsp: DisplaySettings,
  /** when set, only these empires are listed (a focused export) */
  focusEmpires?: readonly ID[] | null,
  opts: LegendOptions = DEFAULT_LEGEND
): LegendGroup[] {
  // Two filters stack: the export's focus (which empires are in colour) and
  // the legend's own list (which ones get a row).
  const listed =
    opts.empireIds && opts.empireIds.length > 0 ? new Set(opts.empireIds) : null;
  const focused =
    focusEmpires && focusEmpires.length > 0 ? new Set(focusEmpires) : null;
  const focus =
    listed && focused
      ? new Set([...listed].filter((id) => focused.has(id)))
      : listed ?? focused;
  const want = (s: LegendSection) => opts.sections.includes(s);
  const empires = new Map<ID, LegendEntry>();
  const statuses = new Set<string>();
  const objects = new Set<string>();
  const markers = new Set<string>();
  /** "statusId|occupierId" for the occupied zones actually in the shot */
  const occupied = new Set<string>();
  const nebulae: LegendEntry[] = [];
  const regions: LegendEntry[] = [];

  for (const s of Object.values(map.systems)) {
    // `allEmpires` lists the whole map's roster rather than only what the
    // frame happens to contain — useful for a zoomed-in shot that still wants
    // the full key.
    if (!inside(rect, s.x, s.y) && !opts.allEmpires) continue;
    if (s.ownerId && dsp.showTerritories && want('empires')) {
      const emp = map.empires[s.ownerId];
      if (emp && (!focus || focus.has(emp.id))) {
        empires.set(emp.id, {
          kind: 'empire',
          label: emp.name,
          color: emp.color,
          borderColor: emp.borderColor ?? lighten(emp.color),
        });
        const st = statusOf(s);
        if (st !== 'core') statuses.add(st);
        const occ = occupierOf(s);
        if (occ && map.empires[occ]) occupied.add(`${st}|${occ}`);
      }
    }
    if (!inside(rect, s.x, s.y)) continue;
    if (dsp.showMarkers && want('markers')) for (const m of s.markers ?? []) markers.add(m);
  }

  if (dsp.showObjects && want('objects')) {
    for (const o of Object.values(map.objects)) {
      if (inside(rect, o.x, o.y)) objects.add(o.kind);
    }
  }

  if (dsp.showNebulae && want('nebulae')) {
    for (const n of Object.values(map.nebulae)) {
      if (n.blobs.some((b) => inside(rect, b.x, b.y))) {
        nebulae.push({ kind: 'nebula', label: n.name, color: n.color });
      }
    }
  }

  // Only outlined sectors go in: a bare label already reads as its own name
  // on the map and would just repeat itself here.
  if (dsp.showRegions && want('sectors')) {
    for (const r of Object.values(map.regions)) {
      // A sector is in the shot when any of its systems is.
      const members = sectorSystems(map, r.id);
      if (members.length === 0) continue;
      if (members.some((s) => inside(rect, s.x, s.y))) {
        regions.push({ kind: 'region', label: r.name, color: r.color ?? '#c9d6f2' });
      }
    }
  }

  const groups: LegendGroup[] = [];
  if (empires.size) {
    groups.push({
      title: focus && focus.size === 1 ? 'Empire' : 'Empires',
      entries: [...empires.values()].sort((a, b) => a.label.localeCompare(b.label)),
    });
  }
  if (statuses.size && want('statuses')) {
    groups.push({
      title: 'Hold status',
      entries: STATUS_TYPES.filter((s) => statuses.has(s.id)).map((s) => ({
        kind: 'status' as const,
        label: s.label,
        color: '#c8d2e8',
        key: s.id,
      })),
    });
  }
  if (objects.size) {
    groups.push({
      title: 'Objects',
      entries: [...objects].map((k) => ({
        kind: 'object' as const,
        label: OBJECT_BY_ID[k]?.label ?? k,
        color: OBJECT_BY_ID[k]?.color ?? '#cfd8ff',
        key: k,
      })),
    });
  }
  if (markers.size) {
    groups.push({
      title: 'Markers',
      entries: [...markers].map((k) => ({
        kind: 'marker' as const,
        label: MARKER_BY_ID[k]?.label ?? k,
        color: MARKER_BY_ID[k]?.color ?? '#cfd8ff',
        key: k,
      })),
    });
  }
  // Who is sitting on what. The hatch in the swatch is the occupier's colour,
  // matching the territory, so the row explains the pattern on the map.
  if (occupied.size && want('statuses')) {
    groups.push({
      title: 'Occupied by',
      entries: [...occupied].map((key) => {
        const [stId, empId] = key.split('|');
        const emp = map.empires[empId];
        return {
          kind: 'status' as const,
          label: `${emp?.name ?? '—'} (${STATUS_BY_ID[stId]?.label ?? stId})`,
          color: emp?.borderColor ?? emp?.color ?? '#c8d2e8',
          key: stId,
        };
      }),
    });
  }
  if (regions.length) groups.push({ title: 'Sectors', entries: regions });
  if (nebulae.length) groups.push({ title: 'Nebulae', entries: nebulae });
  return groups;
}

const PAD = 16;
const ROW = 22;
const SWATCH = 16;

/**
 * Draw the legend panel. `scale` lets a large export keep the panel readable
 * relative to the image instead of microscopic; the author's own scale is
 * multiplied on top of it.
 */
export function drawLegend(
  ctx: CanvasRenderingContext2D,
  groups: LegendGroup[],
  viewW: number,
  viewH: number,
  scale = 1,
  opts: LegendOptions = DEFAULT_LEGEND
) {
  const title = opts.title;
  if (groups.length === 0 && !title) return;

  const k = scale * Math.max(0.4, opts.scale);
  ctx.save();
  ctx.scale(k, k);
  const h = viewH / k;
  const w = viewW / k;

  const font = (px: number, weight = 400) =>
    `${weight} ${px}px Tektur, 'Tektur', system-ui, sans-serif`;

  // Measure.
  ctx.font = font(13);
  let boxW = 0;
  let boxH = PAD;
  if (title) boxH += 26;
  for (const g of groups) {
    ctx.font = font(11, 700);
    boxW = Math.max(boxW, ctx.measureText(g.title.toUpperCase()).width + PAD * 2);
    boxH += 18;
    ctx.font = font(13);
    for (const e of g.entries) {
      boxW = Math.max(
        boxW,
        ctx.measureText(e.label).width + SWATCH + PAD * 2 + 10
      );
      boxH += ROW;
    }
    boxH += 6;
  }
  if (title) {
    ctx.font = font(19, 700);
    boxW = Math.max(boxW, ctx.measureText(title).width + PAD * 2);
  }
  boxH += PAD - 6;
  boxW = Math.max(boxW, 150);

  const x = opts.corner === 'br' || opts.corner === 'tr' ? w - boxW - PAD : PAD;
  const y = opts.corner === 'tl' || opts.corner === 'tr' ? PAD : h - boxH - PAD;

  // A transparent backdrop is a real choice, not a bug: over an empty corner
  // of the galaxy the panel frame is just clutter.
  if (opts.background > 0) {
    ctx.fillStyle = `rgba(8,11,20,${opts.background})`;
    ctx.strokeStyle = `rgba(150,180,230,${0.35 * opts.background})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, boxW, boxH, 8);
    ctx.fill();
    ctx.stroke();
  }

  let cy = y + PAD;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  if (title) {
    ctx.font = font(19, 700);
    ctx.fillStyle = '#f0f4ff';
    ctx.fillText(title, x + PAD, cy + 8);
    cy += 26;
  }

  for (const g of groups) {
    ctx.font = font(11, 700);
    ctx.fillStyle = 'rgba(150,170,210,0.9)';
    ctx.letterSpacing = '1px';
    ctx.fillText(g.title.toUpperCase(), x + PAD, cy + 8);
    ctx.letterSpacing = '0px';
    cy += 18;

    for (const e of g.entries) {
      const sx = x + PAD;
      const sy = cy + ROW / 2;
      drawSwatch(ctx, e, sx, sy);
      ctx.font = font(13);
      ctx.fillStyle = '#dde4f4';
      ctx.fillText(e.label, sx + SWATCH + 10, sy + 1);
      cy += ROW;
    }
    cy += 6;
  }

  ctx.textBaseline = 'alphabetic';
  ctx.restore();
}

function drawSwatch(
  ctx: CanvasRenderingContext2D,
  e: LegendEntry,
  cx: number,
  cy: number
) {
  const half = SWATCH / 2;
  switch (e.kind) {
    case 'empire':
    case 'nebula': {
      const [r, g, b] = hexToRgb(e.color);
      ctx.fillStyle = `rgba(${r},${g},${b},${e.kind === 'empire' ? 0.45 : 0.7})`;
      ctx.beginPath();
      ctx.roundRect(cx, cy - half, SWATCH, SWATCH, 3);
      ctx.fill();
      ctx.strokeStyle = e.borderColor ?? e.color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      break;
    }
    case 'status': {
      const st = STATUS_BY_ID[e.key!];
      ctx.fillStyle = 'rgba(200,210,232,0.14)';
      ctx.beginPath();
      ctx.roundRect(cx, cy - half, SWATCH, SWATCH, 3);
      ctx.fill();
      const tile = st ? makePatternTile(st.pattern, hexToRgb(e.color), 0.9) : null;
      if (tile) {
        const pat = ctx.createPattern(tile, 'repeat');
        if (pat) {
          ctx.save();
          ctx.beginPath();
          ctx.roundRect(cx, cy - half, SWATCH, SWATCH, 3);
          ctx.clip();
          ctx.fillStyle = pat;
          ctx.fillRect(cx, cy - half, SWATCH, SWATCH);
          ctx.restore();
        }
      }
      ctx.strokeStyle = 'rgba(200,212,236,0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
      break;
    }
    case 'object':
      drawObjectIcon(ctx, e.key as never, cx + half, cy, half - 1, e.color);
      break;
    case 'region': {
      const [r, g, b] = hexToRgb(e.color);
      ctx.fillStyle = `rgba(${r},${g},${b},0.12)`;
      ctx.strokeStyle = e.color;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.roundRect(cx + 1, cy - half + 2, SWATCH - 2, SWATCH - 4, 3);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      break;
    }
    case 'marker': {
      const mk = MARKER_BY_ID[e.key!];
      ctx.fillStyle = 'rgba(8,11,22,0.92)';
      ctx.beginPath();
      ctx.arc(cx + half, cy, half, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = e.color;
      ctx.lineWidth = 1;
      ctx.stroke();
      // Match what the map drew for this marker — vector icon or glyph.
      if (mk?.icon) {
        drawObjectIcon(ctx, mk.icon, cx + half, cy, half * 0.68, e.color);
      } else {
        ctx.fillStyle = e.color;
        ctx.font = '11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(mk?.glyph ?? '?', cx + half, cy + 0.5);
        ctx.textAlign = 'left';
      }
      break;
    }
  }
}
