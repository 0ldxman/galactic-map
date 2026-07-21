import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { GalaxyMap } from '../../src/model/types';

/**
 * Persistence.
 *
 * Everything is plain JSON on a mounted volume: a handful of index files plus
 * one file per map. At this scale (a worldbuilding group, tens of maps) that is
 * genuinely enough, it survives a `cp -r` backup, and — the deciding factor —
 * it needs no native module, so the arm64 image builds in seconds instead of
 * compiling SQLite bindings under emulation. Everything below is behind these
 * functions, so swapping in a real database later touches only this file.
 */

export const DATA_DIR = process.env.DATA_DIR ?? '/data';
const MAPS_DIR = path.join(DATA_DIR, 'maps');

export interface User {
  id: string;
  name: string;
  /** scrypt(password, salt) */
  hash: string;
  salt: string;
  admin: boolean;
  createdAt: number;
}

export interface MapMeta {
  id: string;
  slug: string;
  title: string;
  ownerId: string;
  /** user ids allowed to edit besides the owner */
  editors: string[];
  /** published for anyone who has the link */
  published: boolean;
  /** unguessable part of the public link */
  viewToken: string;
  updatedAt: number;
}

interface Db {
  users: Record<string, User>;
  invites: Record<string, { code: string; createdBy: string; usedBy: string | null }>;
  maps: Record<string, MapMeta>;
  sessions: Record<string, { userId: string; createdAt: number }>;
}

const db: Db = { users: {}, invites: {}, maps: {}, sessions: {} };

function file(name: string) {
  return path.join(DATA_DIR, `${name}.json`);
}

/** Write through a temp file so a crash can never leave a half-written JSON. */
function writeAtomic(target: string, data: unknown) {
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, target);
}

function load<T>(name: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file(name), 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export function initStore() {
  fs.mkdirSync(MAPS_DIR, { recursive: true });
  db.users = load('users', {});
  db.invites = load('invites', {});
  db.maps = load('maps', {});
  db.sessions = load('sessions', {});

  // First run: mint an invite code so the first account can be created.
  if (Object.keys(db.users).length === 0 && Object.keys(db.invites).length === 0) {
    const code = newId(6).toUpperCase();
    db.invites[code] = { code, createdBy: 'system', usedBy: null };
    save('invites');
    console.log(`\n  First-run invite code: ${code}\n`);
  }
}

function save(what: 'users' | 'invites' | 'maps' | 'sessions') {
  writeAtomic(file(what), db[what]);
}

export function newId(bytes = 12) {
  return randomBytes(bytes).toString('base64url');
}

// ---- users & sessions ------------------------------------------------------

function hashPassword(password: string, salt: string) {
  return scryptSync(password, salt, 64).toString('hex');
}

export function createUser(name: string, password: string, invite: string) {
  const code = invite.trim().toUpperCase();
  const inv = db.invites[code];
  if (!inv || inv.usedBy) throw new Error('That invite code is not valid.');
  const taken = Object.values(db.users).some(
    (u) => u.name.toLowerCase() === name.toLowerCase()
  );
  if (taken) throw new Error('That name is already taken.');
  if (password.length < 8) throw new Error('Use a password of at least 8 characters.');

  const salt = randomBytes(16).toString('hex');
  const user: User = {
    id: newId(),
    name,
    salt,
    hash: hashPassword(password, salt),
    admin: Object.keys(db.users).length === 0,
    createdAt: Date.now(),
  };
  db.users[user.id] = user;
  inv.usedBy = user.id;
  save('users');
  save('invites');
  return user;
}

export function verifyUser(name: string, password: string): User | null {
  const user = Object.values(db.users).find(
    (u) => u.name.toLowerCase() === name.toLowerCase()
  );
  if (!user) return null;
  const got = Buffer.from(hashPassword(password, user.salt), 'hex');
  const want = Buffer.from(user.hash, 'hex');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  return user;
}

export function createSession(userId: string) {
  const sid = newId(24);
  db.sessions[sid] = { userId, createdAt: Date.now() };
  save('sessions');
  return sid;
}

export function userForSession(sid?: string): User | null {
  if (!sid) return null;
  const s = db.sessions[sid];
  if (!s) return null;
  return db.users[s.userId] ?? null;
}

export function dropSession(sid?: string) {
  if (sid && db.sessions[sid]) {
    delete db.sessions[sid];
    save('sessions');
  }
}

export function createInvite(createdBy: string) {
  const code = newId(6).toUpperCase();
  db.invites[code] = { code, createdBy, usedBy: null };
  save('invites');
  return code;
}

export function listInvites() {
  return Object.values(db.invites).map((i) => ({
    code: i.code,
    used: !!i.usedBy,
    usedBy: i.usedBy ? db.users[i.usedBy]?.name ?? null : null,
  }));
}

export function userName(id: string) {
  return db.users[id]?.name ?? 'unknown';
}

export function getUser(id: string | null): User | null {
  return id ? db.users[id] ?? null : null;
}

/** Everyone with an account — used to pick co-editors for a map. */
export function listUsers() {
  return Object.values(db.users)
    .map((u) => ({ id: u.id, name: u.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function userExists(id: string) {
  return !!db.users[id];
}

// ---- maps ------------------------------------------------------------------

function slugify(title: string) {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'map';
  let slug = base;
  let n = 2;
  while (Object.values(db.maps).some((m) => m.slug === slug)) slug = `${base}-${n++}`;
  return slug;
}

export function canEdit(meta: MapMeta, user: User | null) {
  if (!user) return false;
  return meta.ownerId === user.id || meta.editors.includes(user.id) || user.admin;
}

export function listMapsFor(user: User): MapMeta[] {
  return Object.values(db.maps)
    .filter((m) => canEdit(m, user))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getMeta(id: string): MapMeta | null {
  return db.maps[id] ?? null;
}

export function metaBySlug(slug: string): MapMeta | null {
  return Object.values(db.maps).find((m) => m.slug === slug) ?? null;
}

export function createMap(user: User, title: string, map: GalaxyMap): MapMeta {
  const meta: MapMeta = {
    id: newId(),
    slug: slugify(title),
    title,
    ownerId: user.id,
    editors: [],
    published: false,
    viewToken: newId(9),
    updatedAt: Date.now(),
  };
  db.maps[meta.id] = meta;
  save('maps');
  writeMap(meta.id, map);
  return meta;
}

export function updateMeta(id: string, patch: Partial<MapMeta>) {
  const meta = db.maps[id];
  if (!meta) return null;
  Object.assign(meta, patch, { id: meta.id, updatedAt: Date.now() });
  save('maps');
  return meta;
}

export function deleteMap(id: string) {
  delete db.maps[id];
  save('maps');
  try {
    fs.unlinkSync(path.join(MAPS_DIR, `${id}.json`));
  } catch {
    // Already gone — nothing to do.
  }
}

export function readMap(id: string): GalaxyMap | null {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(MAPS_DIR, `${id}.json`), 'utf8')
    ) as GalaxyMap;
  } catch {
    return null;
  }
}

export function writeMap(id: string, map: GalaxyMap) {
  writeAtomic(path.join(MAPS_DIR, `${id}.json`), map);
  const meta = db.maps[id];
  if (meta) {
    meta.updatedAt = Date.now();
    save('maps');
  }
}
