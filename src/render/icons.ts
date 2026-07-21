import { ObjectKind } from '../model/types';

/**
 * Object icons are drawn with vector primitives rather than glyphs so they stay
 * sharp at any zoom and in a 16K export, where a font glyph would be resampled.
 * All of them fit inside a circle of radius `r` centred on (x, y).
 */
export function drawObjectIcon(
  ctx: CanvasRenderingContext2D,
  kind: ObjectKind,
  x: number,
  y: number,
  r: number,
  color: string
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1, r * 0.18);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  switch (kind) {
    case 'wormhole': {
      // Funnel: nested ellipses shrinking toward the centre.
      for (let i = 0; i < 3; i++) {
        const k = 1 - i * 0.3;
        ctx.beginPath();
        ctx.ellipse(0, 0, r * k, r * k * 0.62, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    }
    case 'gateway': {
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.75, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2 + Math.PI / 4;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r * 0.75, Math.sin(a) * r * 0.75);
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        ctx.stroke();
      }
      break;
    }
    case 'lgate': {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3 - Math.PI / 2;
        const px = Math.cos(a) * r;
        const py = Math.sin(a) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-r * 0.45, 0);
      ctx.lineTo(r * 0.45, 0);
      ctx.stroke();
      break;
    }
    case 'debris': {
      const pts: [number, number][] = [
        [-0.6, -0.4], [0.3, -0.7], [0.7, 0.1], [-0.2, 0.6], [0.1, -0.1],
      ];
      for (const [px, py] of pts) {
        ctx.beginPath();
        ctx.arc(px * r, py * r, r * 0.16, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'anomaly': {
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.lineTo(r, 0);
      ctx.lineTo(0, r);
      ctx.lineTo(-r, 0);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.22, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'derelict': {
      ctx.beginPath();
      ctx.moveTo(-r * 0.8, -r * 0.5);
      ctx.lineTo(r * 0.3, -r * 0.5);
      ctx.lineTo(r * 0.8, r * 0.1);
      ctx.lineTo(-r * 0.3, r * 0.6);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-r * 0.2, -r * 0.5);
      ctx.lineTo(-r * 0.05, r * 0.55);
      ctx.stroke();
      break;
    }
    case 'station': {
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.45, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-r, 0);
      ctx.lineTo(-r * 0.45, 0);
      ctx.moveTo(r * 0.45, 0);
      ctx.lineTo(r, 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.14, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }
  ctx.restore();
}
