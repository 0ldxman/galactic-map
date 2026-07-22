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
- **Publishing**: `/v/<slug>?t=<token>` shows the map full bleed — no tools, no
  panels, a title in the corner and a card only when the guest clicks
  something. Read-only is enforced on the server: a guest socket may watch, but
  its ops are dropped, so nothing can be smuggled past the UI.
  - Viewers are silent: they neither broadcast a cursor nor see anyone else's.
  - The link can be **regenerated**, which is the only way to take back one
    that has leaked; unpublishing and regenerating both **disconnect** the
    guests holding a link that no longer works, instead of leaving them
    watching until they close the tab.

## Phase F — shell & UI ✅

The sidebar had grown into one endless column mixing server administration with
"which star is this". Split by how often you look at a thing and why:

- **Routes**: `/login` · `/` dashboard · `/m/:id` editor · `/v/:slug` viewer ·
  `/local` offline draft. Hand-rolled — four routes don't need a router.
- **Login page** as the entry point, with an explicit *continue without an
  account* escape hatch so the app still works with no backend (and in
  `npm run dev`).
- **Dashboard**: your maps as cards — published/private, copy-link, delete, and
  **who is on each board right now** (the map list reports live presence, the
  page polls it slowly rather than opening a second socket). Creating a map,
  importing JSON and managing access and invite codes all live here.
- **Editor** keeps a thin header (back · title · live chip with co-editor dots ·
  `?`) and a right panel of three tabs:
  - **Properties** — the selection, or the active empire when nothing is picked;
  - **Outliner** — everything on the map by category, each category's
    visibility switch next to the list it hides, plus a search that finally
    makes systems findable by name;
  - **Map** — border/label styling, style layers, export, regenerate.
- **Tool options moved to a strip above the canvas** — they belong to the hand,
  not the document — and the shortcut list moved to a `?` overlay.
- The panel is resizable (240–520 px, remembered) and collapses with `Tab`;
  `F` frames the selection.

## Phase G — the second pass ✅

Everything here came from using the thing rather than from the plan.

- **Unclaimed systems hold their space.** They now project influence like
  anyone else, so a neighbour's border stops at the midpoint instead of
  flowing over an independent system — but nothing is drawn for them, so it
  reads as an empire politely stopping short. Toggle in Map ▸ Borders.
- **Nebulae are gas, not airbrush.** The painted dabs became a *mask*; what
  fills it is two tileable fBm fields (one clumpy, one ridged) multiplied
  together, which is where the filaments and dark lanes come from. Per cloud:
  texture, filament size, a reroll; globally: texture, brightness, and the
  resolution the gas is baked at.
- **Regions grew a boundary.** `MapRegion.shape` is an optional polygon: drag
  a loop with the Region tool and you get a real sector — outline, wash,
  system count, and a legend entry. Regions without a shape are still the
  plain wide label they always were, so nothing on an old map changed.
- **Object links finished.** Only passages (wormhole · gateway · L-Gate) can
  be linked, only to their own kind, from a dropdown or by clicking the far
  end on the map. The outliner shows what each end joins to.
- **Nebulae can be got rid of.** Delete on the row in the outliner, a Delete
  button on the brush strip, an explicit Paint/Erase toggle, and a plain click
  picks up the cloud under the cursor — gas has no outline to aim at.
- **Gate markers** — the single `gate` marker became wormhole · gateway ·
  L-Gate, drawn with the same vector icons the objects use. The old id still
  resolves so existing maps keep their badges.
- **Lasso select** next to box select, and Alt-drag for it either way.
- **Empire border colour** unfolds under the active empire in the outliner.
- **Invite codes moved into their own window.** They are credentials; they
  shouldn't sit open on the dashboard.
- **The viewer's card** dropped the star list (it told a reader nothing) and
  gained the owner's colour, the sector, and the objects in the system.
- **Phones.** Pinch to zoom and one-finger pan everywhere, taps decided on
  release so panning doesn't select what it crosses, wider hit targets for
  fingers, the viewer's card as a bottom sheet, the editor's panel as an
  overlay drawer with the tools on a scrolling strip.

Fixed on the way through: the rubber-band rectangle was never updated during
the drag, so box select had always measured 0×0 and selected nothing.

### Outliner, second try

Stacking five scrolling lists into one column meant everything past the first
was below the fold — including the button that makes a new empire, which was
sitting under a dozen empire rows where nobody would ever find it.

- The tab is now the map's **table of contents**: one card per category with
  its count and its visibility eye. The list itself opens in a dialog, which
  has room for the rows *and* a fixed place for "+ New" and the filter.
- **Making an empire has three doors now**, because being unable to is worse
  than a duplicated button: `+` beside the empire picker on the tool strip
  (where you are when you want one), the Properties panel, and the dialog.
- **Colour picking is ours, not the browser's.** A native `<input type=color>`
  anchors its dialog to the input and runs off the right edge of the screen —
  and the panel is at that edge. `ColorSwatch` opens a palette popover placed
  by us and clamped to the viewport, with a hex field; the OS picker is still
  there one click further in, where it opens from the middle of the screen.

## Phase E — later

- **Planets** — `System.bodies: Planet[]`, shown in a separate System View
  overlay (orbits + planets), not on the galaxy map. Field reserved in v2 so
  the format isn't bumped twice.
- **Epochs** — named snapshots of the map on a timeline slider, with a diff
  mode highlighting what each empire gained and lost. Cheap in memory because
  the state is immutable and shares structure.
- **Planet map generator** — its own tab, its own design pass.
