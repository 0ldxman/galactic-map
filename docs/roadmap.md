# Roadmap

Agreed plan for the galaxy map editor, in build order. Decisions already taken
are recorded here so they don't have to be re-litigated.

## Architectural decisions

- **Every edit is an op.** `src/model/ops.ts` defines a serialisable, invertible
  operation per edit; the store applies ops and keeps them in an undo stack.
  Two consequences that shape everything downstream:
  - undo is a list of ops, not snapshots, so it can become *local* undo (undo
    only your own edits) when several people edit the same map;
  - the same op value can later be sent over a WebSocket to co-editors without
    reworking the model.
- **Collaboration model: live op-sync over WebSocket** (chosen over a simple
  save/lock scheme and over a full Yjs CRDT). Conflicts resolve per entity,
  last writer wins.
- **Access: accounts with login + password**, registration by invite code. A
  published map is read-only *on the server*, not merely in the UI.
- **Display settings live inside the map**, so an exported or published map
  keeps the look its author chose.

## Phase A — editor foundation ✅

1. Undo/redo built on invertible ops, with transactions (a whole drag or paint
   stroke is one undo step) and op compression.
2. Multi-selection: rubber-band box, Shift/Ctrl to add or toggle, Ctrl+A;
   group edits for owner, influence, markers and delete; group drag.
3. Copy / cut / paste / duplicate, via the OS clipboard so it works across
   tabs, with an internal fallback. Pasting lands under the cursor.
4. Separate border colour per empire (`Empire.borderColor`, defaults to a
   lightened fill colour).
5. Display panel: border width/opacity, fill opacity, empire name size, system
   name zoom threshold, and visibility toggles for every layer.
6. Empire labels sized in world units from the region's area, so they scale
   with zoom like the stars while a big realm always reads bigger.

Pan moved to right- or middle-drag; left-drag on empty space is now box select.

## Phase B — map content

- Map model v2 + migration (one version bump for all the new entities below).
- **System ownership status** — core / claimed / occupied / contested /
  demilitarized, drawn with hatch patterns. Borders get traced per
  *(empire, status)* key instead of per empire; same grid, same tracer.
- **Nebulae** — painted as a set of circles (`blobs`), rendered with the same
  metaball technique as territories, cached as a world-space texture.
- **Named regions / sectors** — sparse wide labels, Stellaris cluster style.
  Optional dashed outline later.
- **Special objects** — a separate entity from markers, because they have
  geometry and links: `SpaceObject { kind, x, y, systemId?, linkedId? }`.
  Paired wormholes/gates draw a dashed arc between the two ends. Icons drawn
  vectorially so they stay crisp in 8K exports.
  (Markers stay "a tag on a system"; objects are "a thing on the map".)
- **Free annotations** — text, arrows, lines, polygons, ellipses with handles.
- **Lore in markdown** on systems, empires, objects and regions.

## Phase C — export

- Refactor the renderer into a DOM-independent `renderToCanvas(map, cam, opts)`.
- Three PNG modes: current view · whole galaxy (bbox + chosen resolution) ·
  single empire (that empire in colour, everyone else greyed out).
- **Legend** built from what was actually drawn, so it lists only what is
  visible in that particular export.

## Phase D — server

- Two compose services: `web` (nginx, proxies `/api`) and `api` (Fastify +
  SQLite on a volume). Nginx Proxy Manager keeps pointing at `web`.
- Tables: `users`, `maps(id, slug, title, owner_id, data, public, view_token,
  updated_at)`, `revisions(map_id, seq, op, author, ts)`.
- Live op-sync over WebSocket, co-editor cursors and selections.
- Publishing: `/v/<slug>` boots the app in viewer mode; anonymous sockets are
  receive-only server-side.

## Phase E — later

- **Planets** — `System.bodies: Planet[]`, shown in a separate System View
  overlay (orbits + planets), not on the galaxy map. Field reserved in v2 so
  the format isn't bumped twice.
- **Epochs** — named snapshots of the map on a timeline slider, with a diff
  mode highlighting what each empire gained and lost. Cheap in memory because
  the state is immutable and shares structure.
- **Planet map generator** — its own tab, its own design pass.
