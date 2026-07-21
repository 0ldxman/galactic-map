import path from 'node:path';
import fs from 'node:fs';
import Fastify, { FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { emptyMap, GalaxyMap } from '../../src/model/types';
import { Op } from '../../src/model/ops';
import {
  initStore,
  createUser,
  verifyUser,
  createSession,
  userForSession,
  dropSession,
  createInvite,
  listInvites,
  listMapsFor,
  createMap,
  getMeta,
  metaBySlug,
  updateMeta,
  deleteMap,
  readMap,
  writeMap,
  canEdit,
  userName,
  newId,
  User,
  MapMeta,
} from './store';
import {
  openRoom,
  join,
  leave,
  applyFrom,
  setCursor,
  presenceColor,
  flushAll,
  Client,
} from './rooms';

const PORT = Number(process.env.PORT ?? 80);
const HOST = process.env.HOST ?? '0.0.0.0';
const STATIC_DIR = process.env.STATIC_DIR ?? path.resolve(process.cwd(), 'dist');
const SESSION_COOKIE = 'gm_sid';
const COOKIE_OPTS = {
  path: '/',
  httpOnly: true,
  sameSite: 'lax',
  maxAge: 60 * 60 * 24 * 365,
} as const;

function me(req: FastifyRequest): User | null {
  return userForSession(req.cookies[SESSION_COOKIE]);
}

function publicUser(u: User) {
  return { id: u.id, name: u.name, admin: u.admin };
}

function publicMeta(m: MapMeta) {
  return {
    id: m.id,
    slug: m.slug,
    title: m.title,
    owner: userName(m.ownerId),
    ownerId: m.ownerId,
    published: m.published,
    viewToken: m.viewToken,
    updatedAt: m.updatedAt,
  };
}

async function main() {
  initStore();

  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'warn' } });
  await app.register(cookie);
  await app.register(websocket);

  // ---- auth ----------------------------------------------------------------

  app.post('/api/register', async (req, reply) => {
    const { name, password, invite } = req.body as Record<string, string>;
    if (!name || !password || !invite) {
      return reply
        .code(400)
        .send({ error: 'Name, password and invite code are required.' });
    }
    try {
      const user = createUser(name.trim(), password, invite);
      reply.setCookie(SESSION_COOKIE, createSession(user.id), COOKIE_OPTS);
      return { user: publicUser(user) };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.post('/api/login', async (req, reply) => {
    const { name, password } = req.body as Record<string, string>;
    const user = verifyUser(name ?? '', password ?? '');
    if (!user) return reply.code(401).send({ error: 'Wrong name or password.' });
    reply.setCookie(SESSION_COOKIE, createSession(user.id), COOKIE_OPTS);
    return { user: publicUser(user) };
  });

  app.post('/api/logout', async (req, reply) => {
    dropSession(req.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/me', async (req) => {
    const user = me(req);
    return { user: user ? publicUser(user) : null };
  });

  app.get('/api/invites', async (req, reply) => {
    const user = me(req);
    if (!user?.admin) return reply.code(403).send({ error: 'Admins only.' });
    return { invites: listInvites() };
  });

  app.post('/api/invites', async (req, reply) => {
    const user = me(req);
    if (!user?.admin) return reply.code(403).send({ error: 'Admins only.' });
    return { code: createInvite(user.id) };
  });

  // ---- maps ----------------------------------------------------------------

  app.get('/api/maps', async (req, reply) => {
    const user = me(req);
    if (!user) return reply.code(401).send({ error: 'Sign in first.' });
    return { maps: listMapsFor(user).map(publicMeta) };
  });

  app.post('/api/maps', async (req, reply) => {
    const user = me(req);
    if (!user) return reply.code(401).send({ error: 'Sign in first.' });
    const { title, map } = req.body as { title?: string; map?: GalaxyMap };
    const meta = createMap(
      user,
      (title ?? 'Untitled galaxy').trim() || 'Untitled galaxy',
      map ?? emptyMap(0)
    );
    return { map: publicMeta(meta) };
  });

  app.get('/api/maps/:id', async (req, reply) => {
    const user = me(req);
    const { id } = req.params as { id: string };
    const meta = getMeta(id);
    if (!meta) return reply.code(404).send({ error: 'No such map.' });
    if (!canEdit(meta, user)) {
      return reply.code(403).send({ error: 'You cannot open this map.' });
    }
    return { map: readMap(id), meta: publicMeta(meta) };
  });

  app.put('/api/maps/:id', async (req, reply) => {
    const user = me(req);
    const { id } = req.params as { id: string };
    const meta = getMeta(id);
    if (!meta) return reply.code(404).send({ error: 'No such map.' });
    if (!canEdit(meta, user)) {
      return reply.code(403).send({ error: 'Read-only for you.' });
    }
    const { map, title, published } = req.body as {
      map?: GalaxyMap;
      title?: string;
      published?: boolean;
    };
    if (map) writeMap(id, map);
    if (title !== undefined || published !== undefined) {
      updateMeta(id, {
        ...(title !== undefined ? { title } : {}),
        ...(published !== undefined ? { published } : {}),
      });
    }
    return { map: publicMeta(getMeta(id)!) };
  });

  app.delete('/api/maps/:id', async (req, reply) => {
    const user = me(req);
    const { id } = req.params as { id: string };
    const meta = getMeta(id);
    if (!meta) return reply.code(404).send({ error: 'No such map.' });
    if (meta.ownerId !== user?.id && !user?.admin) {
      return reply.code(403).send({ error: 'Only the owner can delete a map.' });
    }
    deleteMap(id);
    return { ok: true };
  });

  /** Read-only access to a published map, by slug + token. */
  app.get('/api/public/:slug', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const { token } = req.query as { token?: string };
    const meta = metaBySlug(slug);
    if (!meta || !meta.published) {
      return reply.code(404).send({ error: 'No such map.' });
    }
    if (meta.viewToken !== token) {
      return reply.code(403).send({ error: 'Bad link.' });
    }
    return {
      map: readMap(meta.id),
      meta: { id: meta.id, title: meta.title, owner: userName(meta.ownerId) },
    };
  });

  // ---- live sync -----------------------------------------------------------

  app.get('/api/sync', { websocket: true }, (socket, req) => {
    const user = me(req);
    const { mapId, slug, token } = req.query as {
      mapId?: string;
      slug?: string;
      token?: string;
    };
    const send = (msg: unknown) => {
      if (socket.readyState === 1) socket.send(JSON.stringify(msg));
    };
    const fail = (message: string) => {
      send({ t: 'error', message });
      socket.close();
    };

    const meta = mapId ? getMeta(mapId) : slug ? metaBySlug(slug) : null;
    if (!meta) return fail('No such map.');

    const editor = canEdit(meta, user);
    // A published map lets anyone watch, but only over the exact link and never
    // with edit rights. Enforced here rather than in the UI, so a viewer cannot
    // simply call the editing code from the console.
    const viewer = meta.published && meta.viewToken === token;
    if (!editor && !viewer) return fail('You cannot open this map.');

    const room = openRoom(meta.id);
    if (!room) return fail('Failed to open the map.');

    const client: Client = {
      id: newId(6),
      userId: user?.id ?? null,
      name: user?.name ?? 'Guest',
      canEdit: editor,
      color: presenceColor(room.clients.size),
      send,
    };
    join(room, client);

    socket.on('message', (raw: Buffer) => {
      let msg: { t?: string; ops?: Op[]; x?: number; y?: number };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.t === 'ops' && Array.isArray(msg.ops)) {
        applyFrom(room, client, msg.ops);
      } else if (
        msg.t === 'cursor' &&
        typeof msg.x === 'number' &&
        typeof msg.y === 'number'
      ) {
        setCursor(room, client, msg.x, msg.y);
      }
    });

    socket.on('close', () => leave(room, client.id));
  });

  // ---- static app ----------------------------------------------------------

  if (fs.existsSync(STATIC_DIR)) {
    // `/` serves index.html through the plugin's own index handling; every
    // other non-API path falls through to the not-found handler below.
    await app.register(fastifyStatic, { root: STATIC_DIR, maxAge: '1y' });
    // Single-page app: every non-API path serves index.html.
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) {
        return reply.code(404).send({ error: 'Not found.' });
      }
      return reply.sendFile('index.html');
    });
  } else {
    app.log.warn(`No static build at ${STATIC_DIR} — serving the API only.`);
  }

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      flushAll();
      app.close().then(() => process.exit(0));
    });
  }

  await app.listen({ port: PORT, host: HOST });
  console.log(`galactic-map server listening on ${HOST}:${PORT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
