import { useEffect, useRef } from 'react';
import { useEditor, EntityRef } from '../model/store';
import { Annotation, ID } from '../model/types';
import { Camera } from '../render/camera';
import { Renderer, Marquee } from '../render/renderer';
import { makeClip, parseClip, Clip } from '../model/clipboard';

const HIT_RADIUS = 11; // screen px
const LINE_HIT = 7; // screen px for hyperlane picking
const HANDLE_HIT = 7; // screen px for annotation vertex handles

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
  mode:
    | 'none'
    | 'pan'
    | 'move'
    | 'marquee'
    | 'ent-move'
    | 'ent-vertex'
    | 'draw'
    | 'brush';
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
  /** entity being dragged, and which of its vertices (annotations only) */
  ent: EntityRef | null;
  vertex: number;
  /** world position of the last painted nebula dab */
  dabX: number;
  dabY: number;
  erasing: boolean;
}

/** Last clipboard payload, used when the OS clipboard is unavailable. */
let localClip: Clip | null = null;

export function MapCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const camRef = useRef(new Camera());
  const rendererRef = useRef(new Renderer());
  const dirtyRef = useRef(true);
  const marqueeRef = useRef<Marquee | null>(null);
  const draftRef = useRef<Annotation | null>(null);
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
    ent: null,
    vertex: -1,
    dabX: 0,
    dabY: 0,
    erasing: false,
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
      const st = useEditor.getState();
      const { map, selection, selectedEntity, connectFromId } = st;

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
        const c = cursorRef.current;
        rendererRef.current.draw(ctx, map, cam, {
          selection,
          selectedEntity,
          connectFromId,
          // While dragging a system, keep the stale borders (rebuilding them
          // every frame is what makes dragging lag); they snap back on release.
          deferTerritory: dragRef.current.mode === 'move',
          marquee: marqueeRef.current,
          draftAnnotation: draftRef.current,
          brush:
            st.tool === 'nebula' && c.inside
              ? { x: c.x, y: c.y, r: st.brushSize * cam.zoom }
              : null,
        });
        dirtyRef.current = false;
      }
      // If a map change is waiting on a rebuild throttle, keep the loop
      // redrawing until it settles.
      const r = rendererRef.current;
      if (r.territory.pending || r.nebulae.pending) dirtyRef.current = true;
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
      if (editable(e.target)) return;
      // Finish a polygon that is being clicked out.
      if (!e.ctrlKey && !e.metaKey && draftRef.current) {
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault();
          const draft = draftRef.current;
          draftRef.current = null;
          if (e.key === 'Enter' && draft.points.length >= 3) {
            const { id: _id, ...rest } = draft;
            useEditor.getState().addAnnotation(rest);
          }
          dirtyRef.current = true;
          return;
        }
      }
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
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

  // ---- hit testing ---------------------------------------------------------

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

  const hitTestObject = (sx: number, sy: number): ID | null => {
    const cam = camRef.current;
    const { map } = useEditor.getState();
    const r = Math.max(9, Math.min(22, 7 * Math.sqrt(cam.zoom)) * 1.6);
    for (const o of Object.values(map.objects)) {
      const p = cam.worldToScreen(o.x, o.y);
      if (Math.hypot(p.x - sx, p.y - sy) <= r) return o.id;
    }
    return null;
  };

  const hitTestRegion = (sx: number, sy: number): ID | null => {
    const cam = camRef.current;
    const { map } = useEditor.getState();
    for (const rg of Object.values(map.regions)) {
      const fontPx = rg.size * cam.zoom;
      if (fontPx < 4) continue;
      const p = cam.worldToScreen(rg.x, rg.y);
      // Rough text box: the exact metrics aren't worth a measureText here.
      const halfW = (rg.name.length * fontPx * (0.55 + (rg.spacing ?? 0.35))) / 2;
      if (
        Math.abs(sx - p.x) <= halfW + 4 &&
        Math.abs(sy - p.y) <= fontPx * 0.75
      ) {
        return rg.id;
      }
    }
    return null;
  };

  /** Returns the annotation under the cursor and, if grabbed, its vertex. */
  const hitTestAnnotation = (
    sx: number,
    sy: number,
    selectedId: ID | null
  ): { id: ID; vertex: number } | null => {
    const cam = camRef.current;
    const { map } = useEditor.getState();
    const anns = Object.values(map.annotations);

    // Vertex handles of the selected annotation win over everything else.
    if (selectedId) {
      const a = map.annotations[selectedId];
      if (a) {
        for (let i = 0; i < a.points.length; i++) {
          const p = cam.worldToScreen(a.points[i].x, a.points[i].y);
          if (Math.hypot(p.x - sx, p.y - sy) <= HANDLE_HIT) {
            return { id: a.id, vertex: i };
          }
        }
      }
    }

    for (const a of anns) {
      const pts = a.points.map((p) => cam.worldToScreen(p.x, p.y));
      if (pts.length === 0) continue;
      const tol = Math.max(6, a.width + 4);
      if (a.kind === 'text') {
        const fontPx = (a.fontSize ?? 24) * cam.zoom;
        const halfW = ((a.text ?? '').length * fontPx * 0.5) / 2;
        if (
          Math.abs(sx - pts[0].x) <= halfW + 5 &&
          Math.abs(sy - pts[0].y) <= fontPx * 0.7
        ) {
          return { id: a.id, vertex: -1 };
        }
        continue;
      }
      if (a.kind === 'ellipse' && pts.length >= 2) {
        const cx = (pts[0].x + pts[1].x) / 2;
        const cy = (pts[0].y + pts[1].y) / 2;
        const rx = Math.abs(pts[1].x - pts[0].x) / 2 || 1;
        const ry = Math.abs(pts[1].y - pts[0].y) / 2 || 1;
        const k = ((sx - cx) / rx) ** 2 + ((sy - cy) / ry) ** 2;
        // Near the ring, or anywhere inside a filled ellipse.
        if ((k > 0.75 && k < 1.35) || (a.filled && k <= 1)) {
          return { id: a.id, vertex: -1 };
        }
        continue;
      }
      const closed = a.kind === 'polygon';
      const n = pts.length;
      for (let i = 0; i + 1 < n || (closed && i < n); i++) {
        const p0 = pts[i % n];
        const p1 = pts[(i + 1) % n];
        if (distToSegment(sx, sy, p0.x, p0.y, p1.x, p1.y) <= tol) {
          return { id: a.id, vertex: -1 };
        }
      }
    }
    return null;
  };

  const localPos = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  // ---- pointer handling ----------------------------------------------------

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    const { x, y } = localPos(e);
    const state = useEditor.getState();
    const cam = camRef.current;
    const drag = dragRef.current;
    drag.lastX = x;
    drag.lastY = y;
    drag.moved = false;
    const w = cam.screenToWorld(x, y);

    // Middle or right button always pans, whatever the active tool.
    if (e.button === 1 || e.button === 2) {
      drag.mode = 'pan';
      return;
    }

    const additive = e.shiftKey || e.ctrlKey || e.metaKey;

    switch (state.tool) {
      case 'select': {
        const selEntId =
          state.selectedEntity?.c === 'annotations'
            ? state.selectedEntity.id
            : null;
        const ann = hitTestAnnotation(x, y, selEntId);
        const obj = ann ? null : hitTestObject(x, y);
        const hit = ann || obj ? null : hitTest(x, y);
        const reg = ann || obj || hit ? null : hitTestRegion(x, y);

        if (ann) {
          state.selectEntity({ c: 'annotations', id: ann.id });
          drag.mode = ann.vertex >= 0 ? 'ent-vertex' : 'ent-move';
          drag.ent = { c: 'annotations', id: ann.id };
          drag.vertex = ann.vertex;
          drag.originX = w.x;
          drag.originY = w.y;
          break;
        }
        if (obj) {
          state.selectEntity({ c: 'objects', id: obj });
          drag.mode = 'ent-move';
          drag.ent = { c: 'objects', id: obj };
          drag.originX = w.x;
          drag.originY = w.y;
          break;
        }
        if (reg) {
          state.selectEntity({ c: 'regions', id: reg });
          drag.mode = 'ent-move';
          drag.ent = { c: 'regions', id: reg };
          drag.originX = w.x;
          drag.originY = w.y;
          break;
        }
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
        const hit = hitTest(x, y);
        if (!hit) {
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
        const hit = hitTest(x, y);
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
        const hit = hitTest(x, y);
        state.beginTx();
        drag.tx = true;
        if (hit && state.activeEmpireId) state.setOwner(hit, state.activeEmpireId);
        drag.mode = 'none';
        break;
      }
      case 'delete': {
        const ann = hitTestAnnotation(x, y, null);
        const obj = ann ? null : hitTestObject(x, y);
        const hit = ann || obj ? null : hitTest(x, y);
        if (ann) state.removeEnt('annotations', ann.id);
        else if (obj) state.removeEnt('objects', obj);
        else if (hit) state.removeSystem(hit);
        else {
          const reg = hitTestRegion(x, y);
          if (reg) state.removeEnt('regions', reg);
          else {
            const hl = hitTestHyperlane(x, y);
            if (hl) state.removeHyperlane(hl);
          }
        }
        drag.mode = 'none';
        break;
      }
      case 'nebula': {
        let id = state.activeNebulaId;
        if (!id || !state.map.nebulae[id]) id = state.addNebula();
        state.beginTx();
        drag.tx = true;
        drag.mode = 'brush';
        drag.erasing = e.altKey;
        drag.dabX = w.x;
        drag.dabY = w.y;
        if (drag.erasing) state.eraseNebula(id, w.x, w.y, state.brushSize);
        else state.paintNebula(id, [{ x: w.x, y: w.y, r: state.brushSize }]);
        break;
      }
      case 'region': {
        // Size the new label relative to the current zoom so it reads well
        // right away instead of appearing as a speck or filling the screen.
        state.addRegion(w.x, w.y, { size: Math.max(12, 46 / cam.zoom) });
        drag.mode = 'none';
        break;
      }
      case 'object': {
        const hit = hitTest(x, y);
        const sys = hit ? state.map.systems[hit] : null;
        state.addObject(
          sys ? sys.x + 22 / cam.zoom : w.x,
          sys ? sys.y : w.y,
          { systemId: sys?.id ?? null }
        );
        drag.mode = 'none';
        break;
      }
      case 'annotate': {
        const kind = state.annotationKind;
        if (kind === 'text') {
          state.addAnnotation({
            kind: 'text',
            points: [{ x: w.x, y: w.y }],
            text: 'Text',
            color: state.annotationColor,
            width: 2,
            fontSize: Math.max(8, 30 / cam.zoom),
            layer: 'above',
          });
          drag.mode = 'none';
        } else if (kind === 'polygon') {
          // Click out the vertices; Enter finishes, Escape discards.
          const d = draftRef.current;
          if (d) d.points.push({ x: w.x, y: w.y });
          else
            draftRef.current = {
              id: 'draft',
              kind: 'polygon',
              points: [{ x: w.x, y: w.y }, { x: w.x, y: w.y }],
              color: state.annotationColor,
              width: 2,
              layer: 'above',
              filled: true,
            };
          drag.mode = 'none';
          dirtyRef.current = true;
        } else {
          draftRef.current = {
            id: 'draft',
            kind,
            points: [{ x: w.x, y: w.y }, { x: w.x, y: w.y }],
            color: state.annotationColor,
            width: 2,
            layer: 'above',
            filled: kind === 'ellipse',
          };
          drag.mode = 'draw';
        }
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
    const w = cam.screenToWorld(x, y);
    const wasInside = cursorRef.current.inside;
    cursorRef.current = { x, y, inside: true };
    // The brush preview and the polygon rubber-band follow the cursor.
    if (state.tool === 'nebula' || draftRef.current || !wasInside) {
      dirtyRef.current = true;
    }

    if (drag.mode === 'pan') {
      cam.panByScreen(dx, dy);
      dirtyRef.current = true;
    } else if (drag.mode === 'move') {
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
    } else if (drag.mode === 'ent-move' && drag.ent) {
      const wdx = w.x - drag.originX;
      const wdy = w.y - drag.originY;
      if (wdx || wdy) {
        if (!drag.tx) {
          state.beginTx();
          drag.tx = true;
        }
        moveEntity(drag.ent, wdx, wdy);
        drag.originX = w.x;
        drag.originY = w.y;
      }
    } else if (drag.mode === 'ent-vertex' && drag.ent && drag.vertex >= 0) {
      if (!drag.tx) {
        state.beginTx();
        drag.tx = true;
      }
      const a = state.map.annotations[drag.ent.id];
      if (a) {
        const points = a.points.map((p, i) =>
          i === drag.vertex ? { x: w.x, y: w.y } : p
        );
        state.updateEnt('annotations', a.id, { points });
      }
    } else if (drag.mode === 'draw' && draftRef.current) {
      const d = draftRef.current;
      d.points[d.points.length - 1] = { x: w.x, y: w.y };
      dirtyRef.current = true;
    } else if (drag.mode === 'brush' && state.activeNebulaId) {
      // Space the dabs out so a slow drag doesn't pile up thousands of them.
      const step = state.brushSize * 0.35;
      if (Math.hypot(w.x - drag.dabX, w.y - drag.dabY) >= step) {
        drag.dabX = w.x;
        drag.dabY = w.y;
        if (drag.erasing)
          state.eraseNebula(state.activeNebulaId, w.x, w.y, state.brushSize);
        else
          state.paintNebula(state.activeNebulaId, [
            { x: w.x, y: w.y, r: state.brushSize },
          ]);
      }
    } else if (state.tool === 'paint' && drag.tx && e.buttons) {
      const hit = hitTest(x, y);
      if (hit && state.activeEmpireId) state.setOwner(hit, state.activeEmpireId);
    } else if (draftRef.current && draftRef.current.kind === 'polygon') {
      // Rubber-band the next polygon vertex to the cursor.
      const d = draftRef.current;
      d.points[d.points.length - 1] = { x: w.x, y: w.y };
      dirtyRef.current = true;
    }

    drag.lastX = x;
    drag.lastY = y;
  };

  /** Shift an entity by a world delta (annotations move all their points). */
  const moveEntity = (ref: EntityRef, dx: number, dy: number) => {
    const state = useEditor.getState();
    if (ref.c === 'annotations') {
      const a = state.map.annotations[ref.id];
      if (!a) return;
      state.updateEnt('annotations', ref.id, {
        points: a.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
      });
    } else if (ref.c === 'objects') {
      const o = state.map.objects[ref.id];
      if (!o) return;
      // Dragging an object away from its system detaches it.
      state.updateEnt('objects', ref.id, { x: o.x + dx, y: o.y + dy });
    } else if (ref.c === 'regions') {
      const r = state.map.regions[ref.id];
      if (!r) return;
      state.updateEnt('regions', ref.id, { x: r.x + dx, y: r.y + dy });
    }
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

    if (drag.mode === 'draw' && draftRef.current) {
      const d = draftRef.current;
      draftRef.current = null;
      const a = d.points[0];
      const b = d.points[1];
      // Ignore an accidental click that produced a zero-size shape.
      if (Math.hypot(b.x - a.x, b.y - a.y) > 1 / camRef.current.zoom) {
        const { id: _id, ...rest } = d;
        state.addAnnotation(rest);
      }
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
    drag.ent = null;
    drag.vertex = -1;
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
          dirtyRef.current = true;
        }}
        onContextMenu={(e) => e.preventDefault()}
        onWheel={onWheel}
      />
    </div>
  );
}
