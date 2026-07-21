import { create } from 'zustand';
import { useEditor, subscribeOps } from '../model/store';
import { Op } from '../model/ops';
import { GalaxyMap } from '../model/types';

export interface Peer {
  id: string;
  name: string;
  color: string;
  canEdit: boolean;
  cursor?: { x: number; y: number };
}

export type SyncStatus = 'offline' | 'connecting' | 'live' | 'error';

interface SyncState {
  status: SyncStatus;
  error: string | null;
  /** id of the map this client has open on the server */
  mapId: string | null;
  mapTitle: string | null;
  /** true when the server let us in as a read-only viewer */
  viewer: boolean;
  peers: Peer[];
  selfId: string | null;
}

export const useSync = create<SyncState>(() => ({
  status: 'offline',
  error: null,
  mapId: null,
  mapTitle: null,
  viewer: false,
  peers: [],
  selfId: null,
}));

const set = useSync.setState;

let socket: WebSocket | null = null;
let unsubOps: (() => void) | null = null;
let retry: number | null = null;
let lastQuery: string | null = null;
/** Ops produced locally while the socket was down, replayed on reconnect. */
let outbox: Op[] = [];

function wsUrl(query: string) {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/api/sync?${query}`;
}

function send(msg: unknown) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

/** Open (or re-open) the live connection for a map. */
export function connectMap(opts: { mapId?: string; slug?: string; token?: string }) {
  const params = new URLSearchParams();
  if (opts.mapId) params.set('mapId', opts.mapId);
  if (opts.slug) params.set('slug', opts.slug);
  if (opts.token) params.set('token', opts.token);
  // Leave whatever room was open, or the server keeps us listed there.
  if (retry) {
    window.clearTimeout(retry);
    retry = null;
  }
  const previous = socket;
  socket = null;
  previous?.close();

  lastQuery = params.toString();
  outbox = [];
  set({ peers: [], selfId: null, mapId: null, viewer: false });
  open();
}

export function disconnect() {
  lastQuery = null;
  if (retry) {
    window.clearTimeout(retry);
    retry = null;
  }
  unsubOps?.();
  unsubOps = null;
  socket?.close();
  socket = null;
  useEditor.getState().setReadOnly(false);
  set({
    status: 'offline',
    error: null,
    mapId: null,
    mapTitle: null,
    viewer: false,
    peers: [],
    selfId: null,
  });
}

function open() {
  if (!lastQuery) return;
  set({ status: 'connecting', error: null });
  const ws = new WebSocket(wsUrl(lastQuery));
  socket = ws;

  ws.onopen = () => {
    // Anything edited while offline goes out first, in order.
    if (outbox.length) {
      send({ t: 'ops', ops: outbox });
      outbox = [];
    }
  };

  ws.onmessage = (ev) => {
    let msg: {
      t: string;
      map?: GalaxyMap;
      mapId?: string;
      ops?: Op[];
      users?: Peer[];
      you?: { id: string; canEdit: boolean };
      canEdit?: boolean;
      id?: string;
      x?: number;
      y?: number;
      message?: string;
    };
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }

    switch (msg.t) {
      case 'init': {
        const editor = useEditor.getState();
        // The server's copy is the truth — adopt it and drop local history,
        // which described a document this client no longer has.
        if (msg.map) editor.setMap(msg.map, true);
        editor.setReadOnly(!msg.you?.canEdit);
        set({
          status: 'live',
          error: null,
          mapId: msg.mapId ?? null,
          viewer: !msg.you?.canEdit,
          peers: msg.users ?? [],
          selfId: msg.you?.id ?? null,
        });
        break;
      }
      case 'ops':
        if (msg.ops) useEditor.getState().applyRemote(msg.ops);
        break;
      case 'access':
        // The owner just granted or revoked editing while we were connected.
        useEditor.getState().setReadOnly(!msg.canEdit);
        set({ viewer: !msg.canEdit });
        break;
      case 'presence':
        set({ peers: msg.users ?? [] });
        break;
      case 'cursor':
        set((s) => ({
          peers: s.peers.map((p) =>
            p.id === msg.id ? { ...p, cursor: { x: msg.x!, y: msg.y! } } : p
          ),
        }));
        break;
      case 'error':
        set({ status: 'error', error: msg.message ?? 'Connection refused.' });
        lastQuery = null; // don't retry a refusal — the answer won't change
        break;
    }
  };

  ws.onclose = () => {
    if (socket !== ws) return;
    socket = null;
    if (!lastQuery) return;
    set((s) => (s.status === 'error' ? s : { ...s, status: 'connecting' }));
    // Reconnect after a moment; edits keep working meanwhile and queue up.
    retry = window.setTimeout(open, 1500);
  };

  ws.onerror = () => {
    // onclose follows and handles the retry.
  };

  unsubOps?.();
  unsubOps = subscribeOps((ops) => {
    if (useSync.getState().viewer) return;
    if (socket?.readyState === WebSocket.OPEN) send({ t: 'ops', ops });
    else outbox.push(...ops);
  });
}

/** Tell the room where this user's pointer is (throttled by the caller). */
export function sendCursor(x: number, y: number) {
  const s = useSync.getState();
  // Viewers watch silently; the server ignores their cursors anyway.
  if (s.status !== 'live' || s.viewer) return;
  send({ t: 'cursor', x, y });
}
