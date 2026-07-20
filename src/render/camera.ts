export interface Point {
  x: number;
  y: number;
}

/** Maps between world coordinates and screen pixels with pan + zoom. */
export class Camera {
  /** world position at the centre of the viewport */
  x = 0;
  y = 0;
  /** screen pixels per world unit */
  zoom = 0.4;

  viewW = 0;
  viewH = 0;

  setViewport(w: number, h: number) {
    this.viewW = w;
    this.viewH = h;
  }

  worldToScreen(wx: number, wy: number): Point {
    return {
      x: (wx - this.x) * this.zoom + this.viewW / 2,
      y: (wy - this.y) * this.zoom + this.viewH / 2,
    };
  }

  screenToWorld(sx: number, sy: number): Point {
    return {
      x: (sx - this.viewW / 2) / this.zoom + this.x,
      y: (sy - this.viewH / 2) / this.zoom + this.y,
    };
  }

  /** Pan by a screen-space delta (e.g. mouse drag in pixels). */
  panByScreen(dx: number, dy: number) {
    this.x -= dx / this.zoom;
    this.y -= dy / this.zoom;
  }

  /** Zoom keeping the world point under (sx, sy) fixed on screen. */
  zoomAt(sx: number, sy: number, factor: number) {
    const before = this.screenToWorld(sx, sy);
    this.zoom = Math.min(4, Math.max(0.05, this.zoom * factor));
    const after = this.screenToWorld(sx, sy);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
  }

  /** Frame the given world bounds within the viewport. */
  fit(minX: number, minY: number, maxX: number, maxY: number, pad = 1.1) {
    const w = Math.max(1, maxX - minX);
    const h = Math.max(1, maxY - minY);
    this.x = (minX + maxX) / 2;
    this.y = (minY + maxY) / 2;
    const zx = this.viewW / (w * pad);
    const zy = this.viewH / (h * pad);
    this.zoom = Math.min(4, Math.max(0.05, Math.min(zx, zy)));
  }
}
