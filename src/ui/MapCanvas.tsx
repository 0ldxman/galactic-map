import { useEffect, useRef } from 'react';
import { useEditor, EntityRef } from '../model/store';
import { Annotation, ID, Point } from '../model/types';
import { liveCamera } from '../render/camera';
import { Renderer, Marquee } from '../render/renderer';
import { makeClip, parseClip, Clip } from '../model/clipboard';
import { useSync, sendCursor } from '../net/sync';
import { pointInPolygon, polygonCentroid, polygonBounds, thinPath } from '../util/geom';
import { hitCorner, onImageReady } from '../render/references';
import { imageFilesFrom } from '../persistence/images';
import { addImageFiles } from './addImage';

const HIT_RADIUS = 11; // screen px
const LINE_HIT = 7; // screen px for hyperlane picking
const HANDLE_HIT = 7; // screen px for annotation vertex handles
/** Fingers are blunter than a mouse pointer; widen every pick for touch. */
const TOUCH_HIT_SCALE = 2.2;

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

/** True when (sx,sy) is within a few screen px of a closed world-space ring. */
function nearRing(
  sx: number,
  sy: number,
  ring: readonly Point[],
  cam: { worldToScreen: (x: number, y: number) => Point }
): boolean {
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = cam.worldToScreen(ring[i].x, ring[i].y);
    const b = cam.worldToScreen(ring[(i + 1) % n].x, ring[(i + 1) % n].y);
    if (distToSegment(sx, sy, a.x, a.y, b.x, b.y) <= 7) return true;
  }
  return false;
}

interface DragState {
  mode:
    | 'none'
    | 'pan'
    | 'move'
    | 'marquee'
    | 'lasso'
    | 'ent-move'
    | 'ent-vertex'
    | 'draw'
    | 'brush'
    | 'region'
    | 'ref-resize';
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
  /** entity being dragged, and which of its vertices (annotations/regions) */
  ent: EntityRef | null;
  vertex: number;
  /** world position of the last painted nebula dab */
  dabX: number;
  dabY: number;
  erasing: boolean;
  /** true when this gesture came from a finger rather than a mouse */
  touch: boolean;
  /** corner being dragged while resizing a reference image, and its start rect */
  corner: number;
  rect: { x: number; y: number; w: number; h: number };
}

/** Last clipboard payload, used when the OS clipboard is unavailable. */
let localClip: Clip | null = null;

export function MapCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const camRef = useRef(liveCamera);
  const rendererRef = useRef(new Renderer());
  const dirtyRef = useRef(true);
  const marqueeRef = useRef<Marquee | null>(null);
  const lassoRef = useRef<Point[] | null>(null);
  const regionDraftRef = useRef<Point[] | null>(null);
  const draftRef = useRef<Annotation | null>(null);
  const cursorRef = useRef({ x: 0, y: 0, inside: false });
  const lastCursorSent = useRef(0);
  // Live touch points, for pinch-zoom. A mouse only ever puts one in here.
  const pointersRef = useRef(new Map<number, Point>());
  const pinchRef = useRef<{ d: number; x: number; y: number } | null>(null);
  const pinchedRef = useRef(false);
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
    touch: false,
    corner: -1,
    rect: { x: 0, y: 0, w: 0, h: 0 },
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
    // Reference bitmaps decode asynchronously and have no other way in.
    const unref = onImageReady(() => {
      dirtyRef.current = true;
    });
    return () => {
      unsub();
      unref();
    };
  }, []);

  // Render loop + resize handling.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const cam = camRef.current;
    let raf = 0;
    let lastPeers = useSync.getState().peers;
    let lastFocusSeq = 0;

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
    // A phone rotating, or a mobile browser's URL bar sliding away, changes the
    // canvas box without firing `resize` reliably — watch the element itself.
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const loop = () => {
      const st = useEditor.getState();
      const { map, selection, selectedEntity, connectFromId } = st;

      // Someone asked the camera to go somewhere (outliner, search).
      if (st.focusTarget && st.focusTarget.seq !== lastFocusSeq) {
        lastFocusSeq = st.focusTarget.seq;
        cam.x = st.focusTarget.x;
        cam.y = st.focusTarget.y;
        if (cam.zoom < 1.6) cam.zoom = 1.6;
        didFit.current = true;
        dirtyRef.current = true;
      }

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

      // Co-editors' cursors move without any local edit, so their arrival has
      // to mark the canvas dirty on its own.
      const peers = useSync.getState().peers;
      if (peers !== lastPeers) {
        lastPeers = peers;
        dirtyRef.current = true;
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
          lasso: lassoRef.current,
          draftRegion: regionDraftRef.current,
          draftAnnotation: draftRef.current,
          // Only editors have pointers worth showing, and a viewer sees the
          // map alone — no one else's cursor either.
          references: st.readOnly ? false : undefined,
          peers: st.readOnly
            ? []
            : peers.filter(
                (p) => p.canEdit && p.id !== useSync.getState().selfId
              ),
          brush:
            st.tool === 'nebula' && c.inside && !st.readOnly
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
      ro.disconnect();
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
      // Finish a polygon or a region outline that is being clicked out.
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
    // Pasting a picture is the fastest way to get a screenshot in, and it is a
    // different event from the Ctrl+V above, which deals in map fragments.
    const onPaste = (e: ClipboardEvent) => {
      if (editable(e.target)) return;
      const st = useEditor.getState();
      if (st.readOnly) return;
      const files = imageFilesFrom(e.clipboardData);
      if (files.length === 0) return;
      e.preventDefault();
      const c = cursorRef.current;
      const at = c.inside
        ? camRef.current.screenToWorld(c.x, c.y)
        : undefined;
      addImageFiles(files, at);
    };

    window.addEventListener('keydown', onKey);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('paste', onPaste);
    };
  }, []);

  // ---- hit testing ---------------------------------------------------------

  const hitTest = (sx: number, sy: number, scale = 1): string | null => {
    const cam = camRef.current;
    const { map } = useEditor.getState();
    let best: string | null = null;
    let bestD = HIT_RADIUS * scale;
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

  const hitTestObject = (sx: number, sy: number, scale = 1): ID | null => {
    const cam = camRef.current;
    const { map } = useEditor.getState();
    const r = Math.max(9, Math.min(22, 7 * Math.sqrt(cam.zoom)) * 1.6) * scale;
    for (const o of Object.values(map.objects)) {
      const p = cam.worldToScreen(o.x, o.y);
      if (Math.hypot(p.x - sx, p.y - sy) <= r) return o.id;
    }
    return null;
  };

  /**
   * Regions come in two shapes: an outlined area (hit anywhere inside it, and
   * on its vertex handles when selected) or a bare label (hit on the text).
   */
  const hitTestRegion = (
    sx: number,
    sy: number,
    selectedId: ID | null,
    /** count anywhere inside the boundary as a hit, not just the edge */
    interior = false
  ): { id: ID; vertex: number } | null => {
    const cam = camRef.current;
    const { map } = useEditor.getState();

    if (selectedId) {
      const r = map.regions[selectedId];
      if (r?.shape) {
        for (let i = 0; i < r.shape.length; i++) {
          const p = cam.worldToScreen(r.shape[i].x, r.shape[i].y);
          if (Math.hypot(p.x - sx, p.y - sy) <= HANDLE_HIT) {
            return { id: r.id, vertex: i };
          }
        }
      }
    }

    const w = cam.screenToWorld(sx, sy);
    let bestArea = Infinity;
    let best: string | null = null;
    for (const r of Object.values(map.regions)) {
      if (r.shape && r.shape.length >= 3) {
        // A sector can cover half the map, so its interior is only a target
        // once it is the selected one — otherwise dragging a selection box
        // across a sector would grab the sector instead. Before that, aim at
        // the boundary line itself (or at the name).
        const onEdge = nearRing(sx, sy, r.shape, cam);
        const inside =
          (interior || selectedId === r.id) &&
          pointInPolygon(w.x, w.y, r.shape);
        if (!onEdge && !inside) continue;
        // A region inside another region wins — you meant the smaller one.
        const b = polygonBounds(r.shape);
        const area = (b.maxX - b.minX) * (b.maxY - b.minY);
        if (area < bestArea) { bestArea = area; best = r.id; }
        continue;
      }
      const fontPx = r.size * cam.zoom;
      if (fontPx < 4) continue;
      const p = cam.worldToScreen(r.x, r.y);
      // Rough text box: the exact metrics aren't worth a measureText here.
      const halfW = (r.name.length * fontPx * (0.55 + (r.spacing ?? 0.35))) / 2;
      if (Math.abs(sx - p.x) <= halfW + 4 && Math.abs(sy - p.y) <= fontPx * 0.75) {
        return { id: r.id, vertex: -1 };
      }
    }
    return best ? { id: best, vertex: -1 } : null;
  };

  /**
   * The topmost unlocked reference under this point. Locked ones are invisible
   * to the pointer on purpose — that is what locking is for: once a screenshot
   * is lined up you want to draw over it without nudging it.
   */
  const hitTestReference = (sx: number, sy: number): ID | null => {
    const cam = camRef.current;
    const { map } = useEditor.getState();
    const w = cam.screenToWorld(sx, sy);
    const list = Object.values(map.references ?? {});
    for (let i = list.length - 1; i >= 0; i--) {
      const r = list[i];
      if (r.locked) continue;
      if (w.x >= r.x && w.x <= r.x + r.w && w.y >= r.y && w.y <= r.y + r.h) {
        return r.id;
      }
    }
    return null;
  };

  /** The nebula whose gas covers this point, if any. */
  const hitTestNebula = (sx: number, sy: number): ID | null => {
    const cam = camRef.current;
    const { map } = useEditor.getState();
    const w = cam.screenToWorld(sx, sy);
    for (const n of Object.values(map.nebulae)) {
      for (const b of n.blobs) {
        if (Math.hypot(b.x - w.x, b.y - w.y) <= b.r) return n.id;
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

  // ---- pinch to zoom -------------------------------------------------------

  /** Abandon whatever gesture was in progress (a second finger landed). */
  const cancelGesture = () => {
    const drag = dragRef.current;
    if (drag.tx) {
      useEditor.getState().endTx();
      drag.tx = false;
    }
    drag.mode = 'none';
    drag.ent = null;
    drag.collapseTo = null;
    marqueeRef.current = null;
    lassoRef.current = null;
    regionDraftRef.current = null;
    dirtyRef.current = true;
  };

  const pinchState = () => {
    const [a, b] = [...pointersRef.current.values()];
    if (!a || !b) return null;
    return {
      d: Math.hypot(a.x - b.x, a.y - b.y),
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
    };
  };

  // ---- pointer handling ----------------------------------------------------

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    const { x, y } = localPos(e);
    pointersRef.current.set(e.pointerId, { x, y });

    // Two fingers = pinch/pan, whatever tool is selected. Whatever the first
    // finger had begun is rolled back so a zoom never paints or drags.
    if (pointersRef.current.size >= 2) {
      cancelGesture();
      pinchedRef.current = true;
      pinchRef.current = pinchState();
      return;
    }

    const state = useEditor.getState();
    const cam = camRef.current;
    const drag = dragRef.current;
    drag.lastX = x;
    drag.lastY = y;
    drag.moved = false;
    drag.touch = e.pointerType === 'touch';
    const scale = drag.touch ? TOUCH_HIT_SCALE : 1;
    const w = cam.screenToWorld(x, y);

    // Middle or right button always pans, whatever the active tool.
    if (e.button === 1 || e.button === 2) {
      drag.mode = 'pan';
      return;
    }

    const additive = e.shiftKey || e.ctrlKey || e.metaKey;

    // Read-only (a published map opened by a guest): the map is all there is.
    // Left-drag pans; what a tap picked is decided on release, so panning
    // across the galaxy doesn't open a card for every star it crosses.
    if (state.readOnly) {
      drag.mode = 'pan';
      return;
    }

    switch (state.tool) {
      case 'select': {
        // A grab handle on the picked reference beats everything: it is a
        // deliberate 9px target the author just aimed at.
        const pickedRef =
          state.selectedEntity?.c === 'references'
            ? state.map.references[state.selectedEntity.id]
            : null;
        if (pickedRef && !pickedRef.locked) {
          const corner = hitCorner(pickedRef, x, y, cam);
          if (corner >= 0) {
            drag.mode = 'ref-resize';
            drag.ent = { c: 'references', id: pickedRef.id };
            drag.corner = corner;
            drag.rect = {
              x: pickedRef.x,
              y: pickedRef.y,
              w: pickedRef.w,
              h: pickedRef.h,
            };
            break;
          }
        }

        const selEntId =
          state.selectedEntity?.c === 'annotations'
            ? state.selectedEntity.id
            : null;
        const ann = hitTestAnnotation(x, y, selEntId);
        const obj = ann ? null : hitTestObject(x, y, scale);
        const hit = ann || obj ? null : hitTest(x, y, scale);
        const selRegionId =
          state.selectedEntity?.c === 'regions' ? state.selectedEntity.id : null;
        const reg = ann || obj || hit ? null : hitTestRegion(x, y, selRegionId);

        // Completing a link that was armed from the object inspector. Only a
        // matching far end closes it; anything else is an ordinary click.
        if (obj && state.linkFromId && state.linkFromId !== obj) {
          const from = state.map.objects[state.linkFromId];
          if (from && from.kind === state.map.objects[obj]?.kind) {
            state.linkObjects(state.linkFromId, obj);
            state.setToolOptions({ linkFromId: null });
            state.selectEntity({ c: 'objects', id: obj });
            drag.mode = 'none';
            break;
          }
        }

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
          break;
        }
        if (reg) {
          state.selectEntity({ c: 'regions', id: reg.id });
          drag.mode = reg.vertex >= 0 ? 'ent-vertex' : 'ent-move';
          drag.ent = { c: 'regions', id: reg.id };
          drag.vertex = reg.vertex;
          drag.originX = w.x;
          drag.originY = w.y;
          break;
        }
        // Dragging inside the *picked* reference moves it. Only the picked
        // one, because a screenshot can cover the entire working area and
        // grabbing it on every empty-space drag would make box select
        // impossible. Picking one is a plain click, resolved on release.
        if (
          pickedRef &&
          !pickedRef.locked &&
          w.x >= pickedRef.x &&
          w.x <= pickedRef.x + pickedRef.w &&
          w.y >= pickedRef.y &&
          w.y <= pickedRef.y + pickedRef.h
        ) {
          drag.mode = 'ent-move';
          drag.ent = { c: 'references', id: pickedRef.id };
          drag.originX = w.x;
          drag.originY = w.y;
          break;
        }

        if (!additive) state.clearSelection();
        // On a phone a one-finger drag over empty space is panning — the
        // rubber band needs a mouse, or a second finger to zoom out first.
        if (drag.touch) {
          drag.mode = 'pan';
        } else if (state.marqueeMode === 'lasso' || e.altKey) {
          drag.mode = 'lasso';
          lassoRef.current = [{ x, y }];
        } else {
          drag.mode = 'marquee';
          marqueeRef.current = { x0: x, y0: y, x1: x, y1: y };
        }
        break;
      }
      case 'add-system': {
        const hit = hitTest(x, y, scale);
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
        const hit = hitTest(x, y, scale);
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
        const hit = hitTest(x, y, scale);
        state.beginTx();
        drag.tx = true;
        if (hit && state.activeEmpireId) state.setOwner(hit, state.activeEmpireId);
        drag.mode = 'none';
        break;
      }
      case 'delete': {
        const ann = hitTestAnnotation(x, y, null);
        const obj = ann ? null : hitTestObject(x, y, scale);
        const hit = ann || obj ? null : hitTest(x, y, scale);
        if (ann) state.removeEnt('annotations', ann.id);
        else if (obj) state.removeEnt('objects', obj);
        else if (hit) state.removeSystem(hit);
        else {
          const reg = hitTestRegion(x, y, null);
          if (reg) state.removeEnt('regions', reg.id);
          else {
            const hl = hitTestHyperlane(x, y);
            if (hl) state.removeHyperlane(hl);
            else {
              // Last resort, because gas covers a lot of empty space.
              const neb = hitTestNebula(x, y);
              if (neb) state.removeEnt('nebulae', neb);
            }
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
        drag.erasing = state.nebulaErase !== e.altKey;
        drag.dabX = w.x;
        drag.dabY = w.y;
        if (drag.erasing) state.eraseNebula(id, w.x, w.y, state.brushSize);
        else state.paintNebula(id, [{ x: w.x, y: w.y, r: state.brushSize }]);
        break;
      }
      case 'region': {
        if (state.regionMode === 'area') {
          // Drag out the boundary; it is closed and named on release.
          regionDraftRef.current = [{ x: w.x, y: w.y }];
          drag.mode = 'region';
          dirtyRef.current = true;
        } else {
          // Size the new label relative to the current zoom so it reads well
          // right away instead of appearing as a speck or filling the screen.
          state.addRegion(w.x, w.y, { size: Math.max(12, 46 / cam.zoom) });
          drag.mode = 'none';
        }
        break;
      }
      case 'object': {
        const hit = hitTest(x, y, scale);
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
    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, { x, y });
    }

    // Two fingers down: zoom about the midpoint and pan with it.
    if (pointersRef.current.size >= 2) {
      const now = pinchState();
      const prev = pinchRef.current;
      if (now && prev) {
        const cam = camRef.current;
        if (prev.d > 0 && now.d > 0) cam.zoomAt(now.x, now.y, now.d / prev.d);
        cam.panByScreen(now.x - prev.x, now.y - prev.y);
        dirtyRef.current = true;
      }
      pinchRef.current = now;
      return;
    }

    const drag = dragRef.current;
    const dx = x - drag.lastX;
    const dy = y - drag.lastY;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) drag.moved = true;
    const state = useEditor.getState();
    const cam = camRef.current;
    const w = cam.screenToWorld(x, y);
    const wasInside = cursorRef.current.inside;
    cursorRef.current = { x, y, inside: true };
    // Share the pointer with the room, but not at pointermove rate.
    const now = performance.now();
    if (now - lastCursorSent.current > 60) {
      lastCursorSent.current = now;
      sendCursor(w.x, w.y);
    }
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
      if (drag.ent.c === 'annotations') {
        const a = state.map.annotations[drag.ent.id];
        if (a) {
          const points = a.points.map((p, i) =>
            i === drag.vertex ? { x: w.x, y: w.y } : p
          );
          state.updateEnt('annotations', a.id, { points });
        }
      } else if (drag.ent.c === 'regions') {
        const r = state.map.regions[drag.ent.id];
        if (r?.shape) {
          const shape = r.shape.map((p, i) =>
            i === drag.vertex ? { x: w.x, y: w.y } : p
          );
          const c = polygonCentroid(shape);
          state.updateEnt('regions', r.id, { shape, x: c.x, y: c.y });
        }
      }
    } else if (drag.mode === 'ref-resize' && drag.ent) {
      if (!drag.tx) {
        state.beginTx();
        drag.tx = true;
      }
      const r0 = drag.rect;
      // The opposite corner stays put; the dragged one follows the pointer.
      const fx = drag.corner === 1 || drag.corner === 2 ? r0.x : r0.x + r0.w;
      const fy = drag.corner === 2 || drag.corner === 3 ? r0.y : r0.y + r0.h;
      let nw = Math.abs(w.x - fx);
      let nh = Math.abs(w.y - fy);
      // Aspect is held unless Alt is down: a screenshot you are tracing must
      // not be squashed by accident.
      if (!e.altKey && r0.w > 0 && r0.h > 0) {
        const k = Math.max(nw / r0.w, nh / r0.h);
        nw = r0.w * k;
        nh = r0.h * k;
      }
      nw = Math.max(4, nw);
      nh = Math.max(4, nh);
      const nx = drag.corner === 1 || drag.corner === 2 ? fx : fx - nw;
      const ny = drag.corner === 2 || drag.corner === 3 ? fy : fy - nh;
      state.updateEnt('references', drag.ent.id, { x: nx, y: ny, w: nw, h: nh });
    } else if (drag.mode === 'draw' && draftRef.current) {
      const d = draftRef.current;
      d.points[d.points.length - 1] = { x: w.x, y: w.y };
      dirtyRef.current = true;
    } else if (drag.mode === 'lasso' && lassoRef.current) {
      const last = lassoRef.current[lassoRef.current.length - 1];
      if (!last || Math.hypot(x - last.x, y - last.y) > 3) {
        lassoRef.current.push({ x, y });
        dirtyRef.current = true;
      }
    } else if (drag.mode === 'region' && regionDraftRef.current) {
      const pts = regionDraftRef.current;
      const last = pts[pts.length - 1];
      // Thin as we go: one point per pointer event is far more than the shape
      // needs, and every extra vertex is another handle to fight with later.
      if (!last || Math.hypot(w.x - last.x, w.y - last.y) > 12 / cam.zoom) {
        pts.push({ x: w.x, y: w.y });
        dirtyRef.current = true;
      }
    } else if (drag.mode === 'marquee' && marqueeRef.current) {
      marqueeRef.current.x1 = x;
      marqueeRef.current.y1 = y;
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
      const hit = hitTest(x, y, drag.touch ? TOUCH_HIT_SCALE : 1);
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

  /** Shift an entity by a world delta (multi-point shapes move every point). */
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
    } else if (ref.c === 'references') {
      const r = state.map.references[ref.id];
      if (!r || r.locked) return;
      state.updateEnt('references', ref.id, { x: r.x + dx, y: r.y + dy });
    } else if (ref.c === 'regions') {
      const r = state.map.regions[ref.id];
      if (!r) return;
      state.updateEnt('regions', ref.id, {
        x: r.x + dx,
        y: r.y + dy,
        ...(r.shape
          ? { shape: r.shape.map((p) => ({ x: p.x + dx, y: p.y + dy })) }
          : {}),
      });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (pinchedRef.current) {
      // Lifting one finger of a pinch must not be read as a click.
      if (pointersRef.current.size === 0) pinchedRef.current = false;
      return;
    }

    const drag = dragRef.current;
    const state = useEditor.getState();
    const cam = camRef.current;
    const wasMoving = drag.mode === 'move';
    const { x, y } = localPos(e);
    const scale = drag.touch ? TOUCH_HIT_SCALE : 1;

    // A guest's tap: decide now, so a pan doesn't select everything it passes.
    if (state.readOnly) {
      if (!drag.moved) {
        const obj = hitTestObject(x, y, scale);
        const sys = obj ? null : hitTest(x, y, scale);
        if (obj) state.selectEntity({ c: 'objects', id: obj });
        else if (sys) state.selectSystem(sys);
        else {
          // A reader has no selection box to protect, so tapping anywhere in
          // a sector is a fair way to ask about it.
          const reg = hitTestRegion(x, y, null, true);
          if (reg) state.selectEntity({ c: 'regions', id: reg.id });
          else state.clearSelection();
        }
      }
      drag.mode = 'none';
      return;
    }

    if (drag.mode === 'marquee' && marqueeRef.current) {
      const m = marqueeRef.current;
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      // A click without movement just clears; a real box selects what's inside.
      if (Math.abs(m.x1 - m.x0) > 3 || Math.abs(m.y1 - m.y0) > 3) {
        const x0 = Math.min(m.x0, m.x1);
        const x1 = Math.max(m.x0, m.x1);
        const y0 = Math.min(m.y0, m.y1);
        const y1 = Math.max(m.y0, m.y1);
        const inside: string[] = [];
        for (const s of Object.values(state.map.systems)) {
          const p = cam.worldToScreen(s.x, s.y);
          if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) inside.push(s.id);
        }
        commitSelection(inside, additive);
      } else {
        pickBackdrop(x, y);
      }
      marqueeRef.current = null;
      dirtyRef.current = true;
    }

    if (drag.mode === 'lasso' && lassoRef.current) {
      const loop = lassoRef.current;
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      if (loop.length >= 3) {
        const inside: string[] = [];
        for (const s of Object.values(state.map.systems)) {
          const p = cam.worldToScreen(s.x, s.y);
          if (pointInPolygon(p.x, p.y, loop)) inside.push(s.id);
        }
        commitSelection(inside, additive);
      } else {
        pickBackdrop(x, y);
      }
      lassoRef.current = null;
      dirtyRef.current = true;
    }

    if (drag.mode === 'region' && regionDraftRef.current) {
      const pts = thinPath(regionDraftRef.current, 8 / cam.zoom);
      regionDraftRef.current = null;
      if (pts.length >= 3) {
        const b = polygonBounds(pts);
        const c = polygonCentroid(pts);
        // Fit the label to the area it names rather than to the current zoom.
        const span = Math.max(b.maxX - b.minX, b.maxY - b.minY);
        state.addRegion(c.x, c.y, {
          shape: pts,
          size: Math.max(10, span * 0.13),
        });
      }
      dirtyRef.current = true;
    }

    if (drag.mode === 'draw' && draftRef.current) {
      const d = draftRef.current;
      draftRef.current = null;
      const a = d.points[0];
      const b = d.points[1];
      // Ignore an accidental click that produced a zero-size shape.
      if (Math.hypot(b.x - a.x, b.y - a.y) > 1 / cam.zoom) {
        const { id: _id, ...rest } = d;
        state.addAnnotation(rest);
      }
      dirtyRef.current = true;
    }

    // On touch an empty-space drag pans, so a tap never opens a marquee — the
    // backdrop pick has to hang off the pan instead.
    if (drag.mode === 'pan' && drag.touch && !drag.moved && state.tool === 'select') {
      pickBackdrop(x, y);
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
    drag.corner = -1;
    // A finished move deferred its border rebuild — redraw once to apply it.
    if (wasMoving) dirtyRef.current = true;
  };

  /**
   * What a click on apparently empty space actually landed on: a tracing image
   * first, then nebula gas. Both cover large areas and have no outline to aim
   * at, so neither is allowed to intercept a drag — only a click that went
   * nowhere gets to pick them up.
   */
  const pickBackdrop = (x: number, y: number) => {
    const state = useEditor.getState();
    const ref = hitTestReference(x, y);
    if (ref) {
      state.selectEntity({ c: 'references', id: ref });
      return;
    }
    const neb = hitTestNebula(x, y);
    if (neb) state.selectEntity({ c: 'nebulae', id: neb });
  };

  const commitSelection = (ids: string[], additive: boolean) => {
    const state = useEditor.getState();
    state.setSelection(
      additive ? [...new Set([...state.selection, ...ids])] : ids
    );
  };

  const onWheel = (e: React.WheelEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    camRef.current.zoomAt(e.clientX - rect.left, e.clientY - rect.top, factor);
    dirtyRef.current = true;
  };

  const onDrop = (e: React.DragEvent) => {
    const files = imageFilesFrom(e.dataTransfer);
    if (files.length === 0) return;
    e.preventDefault();
    if (useEditor.getState().readOnly) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const at = camRef.current.screenToWorld(
      e.clientX - rect.left,
      e.clientY - rect.top
    );
    addImageFiles(files, at);
  };

  return (
    <div
      className="canvas-wrap"
      onDragOver={(e) => {
        // Only claim the drop when it is actually an image, so a JSON map
        // dropped on the window still reaches the browser's own handling.
        if (e.dataTransfer.types.includes('Files')) e.preventDefault();
      }}
      onDrop={onDrop}
    >
      <canvas
        ref={canvasRef}
        className="map-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
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
