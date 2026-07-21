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

## Phase B — map content ✅

- Map model **v2** + migration (one version bump for every new entity), with
  `System.bodies` reserved for Phase E so the format isn't bumped twice.
- **System hold status** — core / claimed / occupied / contested /
  demilitarized, drawn with hatch patterns held at a constant screen size.
  Ownership is still solved across all systems first, so borders stay on the
  midpoint between rivals; only inside an empire that actually mixes statuses
  is the field rerun per status subgroup.
- **Nebulae** — painted as brush dabs (`blobs`), melted together and baked into
  a world-space texture, so panning costs one `drawImage`.
- **Named regions / sectors** — sparse wide labels, sized in world units.
- **Special objects** — `SpaceObject { kind, x, y, systemId?, linkedId? }`,
  a separate entity from markers because they have geometry and links. Paired
  wormholes/gates draw a bowed dashed arc. Icons are vector-drawn so they stay
  crisp at any zoom and in a large export.
  (Markers stay "a tag on a system"; objects are "a thing on the map".)
- **Free annotations** — text, arrows, lines, polygons, ellipses, with vertex
  handles, an above/below-territories layer choice and dashed/filled options.
- **Lore in markdown** (marked + DOMPurify) on systems, empires, nebulae,
  regions and objects.

Also done here: render caches are now invalidated by **collection reference**
rather than a global revision counter, so painting a nebula no longer rebuilds
the borders and moving a system no longer rebakes the nebula texture.

## Phase C — export ✅

- `renderMapToCanvas(map, rect, opts)` renders into an offscreen canvas with a
  private `Renderer`, so exporting never disturbs the live view's caches. Every
  mode reduces to "frame this world rectangle at this resolution".
- Three PNG modes: current view · whole galaxy · single empire. The empire mode
  works by handing the renderer a map copy whose other empires are grey —
  the drawing code stays unaware that exports exist.
- Resolutions up to 16384 px, optional transparent background and title.
- **Legend** collected from the entities inside the exported rectangle, so it
  lists only what that particular image shows, and honours the layer toggles.

## Phase D — server ✅

- **One container, one process** (Fastify serves the built app *and* the API),
  replacing the nginx image. Nginx Proxy Manager keeps pointing at the same
  container on port 80; it just needs Websockets Support enabled.
- **Storage is JSON files on a volume**, not SQLite — deliberately. At this
  scale it is enough, a backup is `cp -r`, and it avoids compiling native
  bindings inside an emulated arm64 build. Everything goes through
  `server/src/store.ts`, so a real database later touches only that file.
- **Accounts** with scrypt-hashed passwords (no native crypto dependency),
  session cookies, and registration gated by invite codes — the first code is
  printed to the log on first start, and the account that uses it is the admin.
  Only admins mint further codes (flip this if it ever becomes a nuisance).
- **Per-map access**: the owner picks co-editors from the account list.
  Revoking takes effect on the open socket, not just on the next reload.
- **Live op-sync**: a room per open map holds the authoritative document,
  applies incoming ops with the *same* `applyOps` the browser uses, relays them
  to the other clients and saves debounced. Co-editor cursors included.
- Local undo stays local: remote ops are applied through `applyRemote`, which
  neither records history nor echoes back.
- **Publishing**: `/v/<slug>?t=<token>` boots the app in viewer mode. Read-only
  is enforced on the server — a guest socket may watch but its ops are dropped,
  so nothing can be smuggled past the UI.

## Phase E — later

- **Planets** — `System.bodies: Planet[]`, shown in a separate System View
  overlay (orbits + planets), not on the galaxy map. Field reserved in v2 so
  the format isn't bumped twice.
- **Epochs** — named snapshots of the map on a timeline slider, with a diff
  mode highlighting what each empire gained and lost. Cheap in memory because
  the state is immutable and shares structure.
- **Planet map generator** — its own tab, its own design pass.
