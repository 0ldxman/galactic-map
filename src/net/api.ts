import { GalaxyMap } from '../model/types';

export interface SessionUser {
  id: string;
  name: string;
  admin: boolean;
}

export interface RemoteMap {
  id: string;
  slug: string;
  title: string;
  owner: string;
  ownerId: string;
  /** everyone besides the owner who may edit this map */
  editors: { id: string; name: string }[];
  published: boolean;
  viewToken: string;
  updatedAt: number;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    ...init,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(body?.error ?? `Request failed (${res.status}).`);
  }
  return body as T;
}

export const api = {
  me: () => call<{ user: SessionUser | null }>('/api/me'),

  login: (name: string, password: string) =>
    call<{ user: SessionUser }>('/api/login', {
      method: 'POST',
      body: JSON.stringify({ name, password }),
    }),

  register: (name: string, password: string, invite: string) =>
    call<{ user: SessionUser }>('/api/register', {
      method: 'POST',
      body: JSON.stringify({ name, password, invite }),
    }),

  logout: () => call<{ ok: true }>('/api/logout', { method: 'POST' }),

  listMaps: () => call<{ maps: RemoteMap[] }>('/api/maps'),

  createMap: (title: string, map: GalaxyMap) =>
    call<{ map: RemoteMap }>('/api/maps', {
      method: 'POST',
      body: JSON.stringify({ title, map }),
    }),

  updateMap: (
    id: string,
    patch: { map?: GalaxyMap; title?: string; published?: boolean }
  ) =>
    call<{ map: RemoteMap }>(`/api/maps/${id}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),

  setAccess: (id: string, editors: string[]) =>
    call<{ map: RemoteMap }>(`/api/maps/${id}/access`, {
      method: 'PUT',
      body: JSON.stringify({ editors }),
    }),

  listUsers: () => call<{ users: { id: string; name: string }[] }>('/api/users'),

  deleteMap: (id: string) =>
    call<{ ok: true }>(`/api/maps/${id}`, { method: 'DELETE' }),

  publicMap: (slug: string, token: string) =>
    call<{ map: GalaxyMap; meta: { id: string; title: string; owner: string } }>(
      `/api/public/${encodeURIComponent(slug)}?token=${encodeURIComponent(token)}`
    ),

  createInvite: () => call<{ code: string }>('/api/invites', { method: 'POST' }),

  listInvites: () =>
    call<{ invites: { code: string; used: boolean; usedBy: string | null }[] }>(
      '/api/invites'
    ),
};

/** `/v/<slug>?t=<token>` — the shape of a published map link. */
export function readViewerRoute():
  | { slug: string; token: string }
  | null {
  const m = window.location.pathname.match(/^\/v\/([^/]+)\/?$/);
  if (!m) return null;
  const token = new URLSearchParams(window.location.search).get('t') ?? '';
  return { slug: decodeURIComponent(m[1]), token };
}

export function viewerLink(slug: string, token: string) {
  return `${window.location.origin}/v/${encodeURIComponent(slug)}?t=${encodeURIComponent(token)}`;
}
