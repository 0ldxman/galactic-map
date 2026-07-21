import { GalaxyMap } from '../../src/model/types';
import { Op, applyOps } from '../../src/model/ops';
import { readMap, writeMap, getMeta } from './store';

/**
 * A room is one map that somebody currently has open.
 *
 * The server keeps the authoritative copy in memory, applies incoming ops in
 * arrival order and echoes them to everyone else. Because every op names the
 * entity it touches, two people editing different systems never collide; two
 * people editing the *same* field resolve as last-writer-wins, which is what we
 * agreed to accept instead of a full CRDT.
 *
 * Saving is debounced: a busy room writes at most once every few seconds, and
 * always flushes when the last person leaves.
 */

export interface Client {
  id: string;
  userId: string | null;
  name: string;
  canEdit: boolean;
  color: string;
  send: (msg: unknown) => void;
  cursor?: { x: number; y: number };
}

interface Room {
  mapId: string;
  map: GalaxyMap;
  clients: Map<string, Client>;
  saveTimer: NodeJS.Timeout | null;
  dirty: boolean;
}

const rooms = new Map<string, Room>();
const SAVE_DEBOUNCE = 3000;

const PRESENCE_COLORS = [
  '#5a7cff', '#49c26b', '#e0b23d', '#e0483d', '#a34fe0', '#3dd6c2',
];

export function presenceColor(n: number) {
  return PRESENCE_COLORS[n % PRESENCE_COLORS.length];
}

export function openRoom(mapId: string): Room | null {
  const existing = rooms.get(mapId);
  if (existing) return existing;
  if (!getMeta(mapId)) return null;
  const map = readMap(mapId);
  if (!map) return null;
  const room: Room = { mapId, map, clients: new Map(), saveTimer: null, dirty: false };
  rooms.set(mapId, room);
  return room;
}

export function roomMap(mapId: string): GalaxyMap | null {
  return rooms.get(mapId)?.map ?? readMap(mapId);
}

/** Who is on a given board right now — shown on the dashboard's map cards. */
export function activeUsers(mapId: string) {
  const room = rooms.get(mapId);
  if (!room) return [];
  return [...room.clients.values()].map((c) => ({
    name: c.name,
    color: c.color,
    canEdit: c.canEdit,
  }));
}

function scheduleSave(room: Room) {
  room.dirty = true;
  if (room.saveTimer) return;
  room.saveTimer = setTimeout(() => {
    room.saveTimer = null;
    flush(room);
  }, SAVE_DEBOUNCE);
}

function flush(room: Room) {
  if (!room.dirty) return;
  room.dirty = false;
  writeMap(room.mapId, room.map);
}

export function join(room: Room, client: Client) {
  room.clients.set(client.id, client);
  client.send({
    t: 'init',
    mapId: room.mapId,
    map: room.map,
    you: { id: client.id, name: client.name, canEdit: client.canEdit, color: client.color },
    users: peers(room),
  });
  broadcastPresence(room);
}

export function leave(room: Room, clientId: string) {
  room.clients.delete(clientId);
  if (room.clients.size === 0) {
    if (room.saveTimer) {
      clearTimeout(room.saveTimer);
      room.saveTimer = null;
    }
    flush(room);
    rooms.delete(room.mapId);
    return;
  }
  broadcastPresence(room);
}

function peers(room: Room) {
  return [...room.clients.values()].map((c) => ({
    id: c.id,
    name: c.name,
    color: c.color,
    canEdit: c.canEdit,
    cursor: c.cursor,
  }));
}

export function broadcastPresence(room: Room) {
  const users = peers(room);
  for (const c of room.clients.values()) c.send({ t: 'presence', users });
}

/** Apply ops from one client and relay them to the others. */
export function applyFrom(room: Room, from: Client, ops: Op[]) {
  if (!from.canEdit || ops.length === 0) return;
  room.map = applyOps(room.map, ops);
  scheduleSave(room);
  for (const c of room.clients.values()) {
    if (c.id === from.id) continue;
    c.send({ t: 'ops', ops, by: from.id });
  }
}

export function setCursor(room: Room, client: Client, x: number, y: number) {
  client.cursor = { x, y };
  for (const c of room.clients.values()) {
    if (c.id === client.id) continue;
    c.send({ t: 'cursor', id: client.id, x, y });
  }
}

/**
 * Re-decide who may edit, for everyone currently in the room. Without this a
 * user whose access was just revoked would keep editing until they reloaded.
 */
export function updateAccess(
  mapId: string,
  decide: (userId: string | null) => boolean
) {
  const room = rooms.get(mapId);
  if (!room) return;
  for (const c of room.clients.values()) {
    // A guest on the public link is never promoted by an access change.
    const can = c.userId ? decide(c.userId) : false;
    if (can === c.canEdit) continue;
    c.canEdit = can;
    c.send({ t: 'access', canEdit: can });
  }
  broadcastPresence(room);
}

/** Persist every open room — used on shutdown. */
export function flushAll() {
  for (const room of rooms.values()) flush(room);
}
