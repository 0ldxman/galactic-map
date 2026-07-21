import { useEffect, useRef } from 'react';
import { useEditor } from '../model/store';
import { Camera } from '../render/camera';
import { Renderer, Marquee } from '../render/renderer';
import { makeClip, parseClip, Clip } from '../model/clipboard';

const HIT_RADIUS = 11; // screen px
const LINE_HIT = 7; // screen px for hyperlane picking

/** Distance from point (px,py) to the segment (ax,ay)-(bx,by), in screen px. */
function distToSegment(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

interface DragState {
  mode: 'none' | 'pan' | 'move' | 'marquee';
  /** world position of the pointer when a move-drag started */
  originX: number;
  originY: number;
  lastX: number;
  lastY: number;
  moved: boolean;
  /** true while a store transaction is open (one undo step per drag) */
  tx: boolean;
  /**
   * System clicked inside an existing multi-selection. The group is kept so the
   * click can start a group drag; if the pointer never moves it was an ordinary
   * click and the selection collapses to this one system on release.
   */
  collapseTo: string | null;
}

/** Last clipboard payload, used when the OS clipboard is unavailable. */
let localClip: Clip | null = null;

export function MapCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const camRef = useRef(new Camera());
  const rendererRef = useRef(new Renderer());
  const dirtyRef = useRef(true);
  const marqueeRef = useRef<Marquee | null>(null);
  const cursorRef = useRef({ x: 0, y: 0, inside: false });
  const dragRef = useRef<DragState>({
    mode: 'none',
    originX: 0,
    originY: 0,
    lastX: 0,
    lastY: 0,
    moved: false,
    tx: false,
    collapseTo: null,
  });
  const didFit = useRef(false);

  // Redraw whenever the store changes.
  useEffect(() => {
    const unsub = useEditor.subscribe(() => {
      dirtyRef.current = true;
    });
    // Repaint once the Tektur webfont finishes loading so labels pick it up.
    document.fonts?.ready.then(() => {
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
      const { map, revision, selection, connectFromId } = useEditor.getState();

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
          selection,
          connectFromId,
          revision,
          // While dragging a system, keep the stale borders (rebuilding them
          // every frame is what makes dragging lag); they snap back on release.
          deferTerritory: dragRef.current.mode === 'move',
          marquee: marqueeRef.current,
        });
        dirtyRef.current = false;
      }
      // If a map change is waiting on the territory rebuild throttle, keep the
      // loop redrawing until it settles.
      if (rendererRef.current.territory.pending) dirtyRef.current = true;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  // Clipboard shortcuts. They live here because pasting needs the camera and
  // the cursor position, both of which this component owns.
  useEffect(() => {
    const editable = (el: EventTarget | null) => {
      const e = el as HTMLElement | null;
      return (
        !!e &&
        (e.tagName === 'INPUT' ||
          e.tagName === 'SELECT' ||
          e.tagName === 'TEXTAREA' ||
          e.isContentEditable)
      );
    };

    const pasteAtCursor = (clip: Clip) => {
      const cam = camRef.current;
      const c = cursorRef.current;
      const at = c.inside
        ? cam.screenToWorld(c.x, c.y)
        : { x: cam.x, y: cam.y };
      useEditor.getState().insertClip(clip, at.x, at.y);
    };

    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (editable(e.target)) return;
      const st = useEditor.getState();
      const key = e.key.toLowerCase();

      if (key === 'c' || key === 'x') {
        const clip = makeClip(st.map, st.selection);
        if (!clip) return;
        e.preventDefault();
        localClip = clip;
        navigator.clipboard?.writeText(JSON.stringify(clip)).catch(() => {});
        if (key === 'x') st.removeSystems(st.selection);
      } else if (key === 'v') {
        e.preventDefault();
        // Prefer the OS clipboard (works across tabs); fall back to the local
        // one when it is unavailable or the read is denied.
        const read = navigator.clipboard?.readText?.();
        if (read) {
          read
            .then((text) => {
              const clip = parseClip(text) ?? localClip;
              if (clip) pasteAtCursor(clip);
            })
            .catch(() => {
              if (localClip) pasteAtCursor(localClip);
            });
        } else if (localClip) {
          pasteAtCursor(localClip);
        }
      } else if (key === 'd') {
        const clip = makeClip(st.map, st.selection);
        if (!clip) return;
        e.preventDefault();
        // Duplicate in place, nudged so the copy is visible and grabbable.
        const off = 26;
        st.insertClip(clip, clip.cx + off, clip.cy + off);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
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

  const hitTestHyperlane = (sx: number, sy: number): string | null => {
    const cam = camRef.current;
    const { map } = useEditor.getState();
    let best: string | null = null;
    let bestD = LINE_HIT;
    for (const hl of Object.values(map.hyperlanes)) {
      const a = map.systems[hl.a];
      const b = map.systems[hl.b];
      if (!a || !b) continue;
      const pa = cam.worldToScreen(a.x, a.y);
      const pb = cam.worldToScreen(b.x, b.y);
      const d = distToSegment(sx, sy, pa.x, pa.y, pb.x, pb.y);
      if (d < bestD) {
        bestD = d;
        best = hl.id;
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
    const drag = dragRef.current;
    drag.lastX = x;
    drag.lastY = y;
    drag.moved = false;

    // Middle or right button always pans, whatever the active tool.
    if (e.button === 1 || e.button === 2) {
      drag.mode = 'pan';
      return;
    }

    const hit = hitTest(x, y);
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;

    switch (state.tool) {
      case 'select': {
        if (hit) {
          // Clicking an unselected system selects it; with Shift it joins the
          // selection; clicking one that is already selected keeps the group so
          // the whole group can be dragged.
          if (additive) {
            state.selectSystem(hit, 'toggle');
          } else if (!state.selection.includes(hit)) {
            state.selectSystem(hit);
          } else if (state.selection.length > 1) {
            drag.collapseTo = hit;
          }
          const w = cam.screenToWorld(x, y);
          drag.mode = 'move';
          drag.originX = w.x;
          drag.originY = w.y;
          drag.tx = false;
        } else {
          if (!additive) state.clearSelection();
          drag.mode = 'marquee';
          marqueeRef.current = { x0: x, y0: y, x1: x, y1: y };
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
        // Open the transaction even on a miss so dragging on from empty space
        // keeps painting, and the whole stroke is one undo step.
        state.beginTx();
        drag.tx = true;
        if (hit && state.activeEmpireId) state.setOwner(hit, state.activeEmpireId);
        drag.mode = 'none';
        break;
      }
      case 'delete': {
        if (hit) {
          state.removeSystem(hit);
        } else {
          const hl = hitTestHyperlane(x, y);
          if (hl) state.removeHyperlane(hl);
        }
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
    cursorRef.current = { x, y, inside: true };

    if (drag.mode === 'pan') {
      cam.panByScreen(dx, dy);
      dirtyRef.current = true;
    } else if (drag.mode === 'move') {
      const w = cam.screenToWorld(x, y);
      const wdx = w.x - drag.originX;
      const wdy = w.y - drag.originY;
      if (wdx || wdy) {
        // One undo step for the whole drag.
        if (!drag.tx) {
          state.beginTx();
          drag.tx = true;
        }
        state.moveSystemsBy(state.selection, wdx, wdy);
        drag.originX = w.x;
        drag.originY = w.y;
      }
    } else if (drag.mode === 'marquee' && marqueeRef.current) {
      marqueeRef.current.x1 = x;
      marqueeRef.current.y1 = y;
      dirtyRef.current = true;
    } else if (state.tool === 'paint' && drag.tx && e.buttons) {
      const hit = hitTest(x, y);
      if (hit && state.activeEmpireId) state.setOwner(hit, state.activeEmpireId);
    }

    drag.lastX = x;
    drag.lastY = y;
  };

  const onPointerUp = (e: React.PointerEvent) => {
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    const drag = dragRef.current;
    const state = useEditor.getState();
    const wasMoving = drag.mode === 'move';

    if (drag.mode === 'marquee' && marqueeRef.current) {
      const m = marqueeRef.current;
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      // A click without movement just clears; a real box selects what's inside.
      if (Math.abs(m.x1 - m.x0) > 3 || Math.abs(m.y1 - m.y0) > 3) {
        const cam = camRef.current;
        const x0 = Math.min(m.x0, m.x1);
        const x1 = Math.max(m.x0, m.x1);
        const y0 = Math.min(m.y0, m.y1);
        const y1 = Math.max(m.y0, m.y1);
        const inside: string[] = [];
        for (const s of Object.values(state.map.systems)) {
          const p = cam.worldToScreen(s.x, s.y);
          if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) inside.push(s.id);
        }
        const next = additive
          ? [...new Set([...state.selection, ...inside])]
          : inside;
        state.setSelection(next);
      }
      marqueeRef.current = null;
      dirtyRef.current = true;
    }

    if (drag.collapseTo) {
      if (!drag.moved) state.selectSystem(drag.collapseTo);
      drag.collapseTo = null;
    }

    if (drag.tx) {
      state.endTx();
      drag.tx = false;
    }
    drag.mode = 'none';
    // A finished move deferred its border rebuild — redraw once to apply it.
    if (wasMoving) dirtyRef.current = true;
  };

  const onWheel = (e: React.WheelEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    camRef.current.zoomAt(e.clientX - rect.left, e.clientY - rect.top, factor);
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
        onPointerLeave={() => {
          cursorRef.current.inside = false;
        }}
        onContextMenu={(e) => e.preventDefault()}
        onWheel={onWheel}
      />
    </div>
  );
}
