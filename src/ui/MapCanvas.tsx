import { useEffect, useRef } from 'react';
import { useEditor } from '../model/store';
import { Camera } from '../render/camera';
import { Renderer } from '../render/renderer';

const HIT_RADIUS = 11; // screen px

interface DragState {
  mode: 'none' | 'pan' | 'move';
  systemId: string | null;
  lastX: number;
  lastY: number;
  moved: boolean;
}

export function MapCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const camRef = useRef(new Camera());
  const rendererRef = useRef(new Renderer());
  const dirtyRef = useRef(true);
  const dragRef = useRef<DragState>({
    mode: 'none',
    systemId: null,
    lastX: 0,
    lastY: 0,
    moved: false,
  });
  const didFit = useRef(false);

  // Redraw whenever the store changes.
  useEffect(() => {
    const unsub = useEditor.subscribe(() => {
      dirtyRef.current = true;
    });
    return unsub;
  }, []);

  // Render loop + resize handling.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const cam = camRef.current;
    let raf = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cam.setViewport(rect.width, rect.height);
      dirtyRef.current = true;
    };
    resize();
    window.addEventListener('resize', resize);

    const loop = () => {
      const { map, selectedSystemId, connectFromId } = useEditor.getState();

      // Auto-fit the first time a non-empty map appears.
      if (!didFit.current) {
        const sys = Object.values(map.systems);
        if (sys.length > 0) {
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (const s of sys) {
            minX = Math.min(minX, s.x); minY = Math.min(minY, s.y);
            maxX = Math.max(maxX, s.x); maxY = Math.max(maxY, s.y);
          }
          cam.fit(minX, minY, maxX, maxY);
          didFit.current = true;
          dirtyRef.current = true;
        }
      }

      if (dirtyRef.current) {
        rendererRef.current.draw(ctx, map, cam, {
          selectedSystemId,
          connectFromId,
        });
        dirtyRef.current = false;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  const hitTest = (sx: number, sy: number): string | null => {
    const cam = camRef.current;
    const { map } = useEditor.getState();
    let best: string | null = null;
    let bestD = HIT_RADIUS;
    for (const s of Object.values(map.systems)) {
      const p = cam.worldToScreen(s.x, s.y);
      const d = Math.hypot(p.x - sx, p.y - sy);
      if (d < bestD) {
        bestD = d;
        best = s.id;
      }
    }
    return best;
  };

  const localPos = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    const { x, y } = localPos(e);
    const state = useEditor.getState();
    const cam = camRef.current;
    const hit = hitTest(x, y);
    const drag = dragRef.current;
    drag.lastX = x;
    drag.lastY = y;
    drag.moved = false;

    // Middle button always pans.
    if (e.button === 1) {
      drag.mode = 'pan';
      drag.systemId = null;
      return;
    }

    switch (state.tool) {
      case 'select': {
        if (hit) {
          state.selectSystem(hit);
          drag.mode = 'move';
          drag.systemId = hit;
        } else {
          state.selectSystem(null);
          drag.mode = 'pan';
          drag.systemId = null;
        }
        break;
      }
      case 'add-system': {
        if (!hit) {
          const w = cam.screenToWorld(x, y);
          const id = state.addSystem(w.x, w.y, {
            ownerId: state.activeEmpireId,
          });
          state.selectSystem(id);
        } else {
          state.selectSystem(hit);
        }
        drag.mode = 'none';
        break;
      }
      case 'connect': {
        if (hit) {
          if (!state.connectFromId) {
            state.setConnectFrom(hit);
          } else {
            state.toggleHyperlane(state.connectFromId, hit);
            state.setConnectFrom(null);
          }
        } else {
          state.setConnectFrom(null);
        }
        drag.mode = 'none';
        break;
      }
      case 'paint': {
        if (hit && state.activeEmpireId) {
          state.setOwner(hit, state.activeEmpireId);
        }
        // Mark a paint-drag so dragging across systems keeps painting.
        drag.mode = 'none';
        drag.systemId = 'paint';
        break;
      }
      case 'delete': {
        if (hit) state.removeSystem(hit);
        drag.mode = 'none';
        break;
      }
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const { x, y } = localPos(e);
    const drag = dragRef.current;
    const dx = x - drag.lastX;
    const dy = y - drag.lastY;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) drag.moved = true;
    const state = useEditor.getState();
    const cam = camRef.current;

    if (drag.mode === 'pan') {
      cam.panByScreen(dx, dy);
      dirtyRef.current = true;
    } else if (drag.mode === 'move' && drag.systemId) {
      const w = cam.screenToWorld(x, y);
      state.moveSystem(drag.systemId, w.x, w.y);
    } else if (state.tool === 'paint' && drag.systemId === 'paint' && e.buttons) {
      const hit = hitTest(x, y);
      if (hit && state.activeEmpireId) state.setOwner(hit, state.activeEmpireId);
    }

    drag.lastX = x;
    drag.lastY = y;
  };

  const onPointerUp = (e: React.PointerEvent) => {
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    dragRef.current.mode = 'none';
    dragRef.current.systemId = null;
  };

  const onWheel = (e: React.WheelEvent) => {
    const { x, y } = { x: e.clientX, y: e.clientY };
    const rect = canvasRef.current!.getBoundingClientRect();
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    camRef.current.zoomAt(x - rect.left, y - rect.top, factor);
    dirtyRef.current = true;
  };

  return (
    <div className="canvas-wrap">
      <canvas
        ref={canvasRef}
        className="map-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
      />
    </div>
  );
}
