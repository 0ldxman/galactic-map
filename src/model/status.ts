import { OwnStatus } from './types';

export interface StatusType {
  id: OwnStatus;
  label: string;
  /** how the territory is hatched; 'solid' means the plain empire fill */
  pattern: 'solid' | 'diagonal' | 'cross' | 'stripes' | 'dots';
  /** fill opacity multiplier relative to the map's base fill opacity */
  weight: number;
}

export const STATUS_TYPES: StatusType[] = [
  { id: 'core', label: 'Core', pattern: 'solid', weight: 1 },
  { id: 'claimed', label: 'Claimed', pattern: 'dots', weight: 1.6 },
  { id: 'occupied', label: 'Occupied', pattern: 'diagonal', weight: 2.2 },
  { id: 'contested', label: 'Contested', pattern: 'cross', weight: 2.2 },
  { id: 'demilitarized', label: 'Demilitarized', pattern: 'stripes', weight: 1.8 },
];

export const STATUS_BY_ID: Record<string, StatusType> = Object.fromEntries(
  STATUS_TYPES.map((s) => [s.id, s])
);

export const STATUS_INDEX: Record<string, number> = Object.fromEntries(
  STATUS_TYPES.map((s, i) => [s.id, i])
);

export function statusOf(s: { status?: OwnStatus }): OwnStatus {
  return s.status ?? 'core';
}

/**
 * Statuses that mean somebody else is present, and so can name an occupier.
 * The others have nobody to name, and a stale id on one is ignored rather than
 * drawn — changing the status back to Core should not leave a hatch behind.
 */
export const OCCUPIABLE: OwnStatus[] = ['occupied', 'contested'];

export function canHaveOccupier(s: { status?: OwnStatus }): boolean {
  return OCCUPIABLE.includes(statusOf(s));
}

/** The occupier actually in force, or null. */
export function occupierOf(s: {
  status?: OwnStatus;
  occupierId?: string | null;
}): string | null {
  return canHaveOccupier(s) ? s.occupierId ?? null : null;
}

/**
 * A small tile of the given hatch, used as a CanvasPattern over a territory.
 * Tiles are drawn at screen scale; the renderer counteracts the camera zoom so
 * the hatch stays a constant size on screen, like the border width does.
 */
export function makePatternTile(
  pattern: StatusType['pattern'],
  rgb: [number, number, number],
  alpha: number
): HTMLCanvasElement | null {
  if (pattern === 'solid') return null;
  const S = 10;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const stroke = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
  g.strokeStyle = stroke;
  g.fillStyle = stroke;
  g.lineWidth = 1.6;

  switch (pattern) {
    case 'diagonal':
      // Draw the wrap-around copies too so the tile joins seamlessly.
      for (const off of [-S, 0, S]) {
        g.beginPath();
        g.moveTo(off, S);
        g.lineTo(off + S, 0);
        g.stroke();
      }
      break;
    case 'cross':
      for (const off of [-S, 0, S]) {
        g.beginPath();
        g.moveTo(off, S);
        g.lineTo(off + S, 0);
        g.moveTo(off, 0);
        g.lineTo(off + S, S);
        g.stroke();
      }
      break;
    case 'stripes':
      g.fillRect(0, 0, S, S / 2.5);
      break;
    case 'dots':
      g.beginPath();
      g.arc(S / 2, S / 2, 1.5, 0, Math.PI * 2);
      g.fill();
      break;
  }
  return c;
}
