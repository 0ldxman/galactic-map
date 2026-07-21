# Galactic Map — Political Map Editor

A browser tool to **generate, edit and publish** a political map of a galaxy in
the style of Stellaris: star systems linked by hyperlanes, grouped into empires
whose territory is drawn as organic glowing borders — plus nebulae, sectors,
wormholes, annotations and lore.

![overview](docs/overview.png)

## Features

- **Procedural generation** — spiral / elliptical / ring shapes, tunable system
  and empire counts, deterministic from a seed.
- **Vector territory borders** — ownership is solved on a world-space influence
  grid (so borders fall between rival systems), then traced into smoothed vector
  loops and cached, staying crisp at any zoom.
- **Hold status** — core / claimed / occupied / contested / demilitarized, drawn
  as hatch patterns that keep a constant size on screen.
- **Systems** — 1–4 stars each with its own spectral type and size class, name
  cards, icon markers, markdown lore.
- **Nebulae** — painted with a brush and melted into soft clouds.
- **Named regions**, **special objects** (wormholes and gates linked in pairs,
  debris, anomalies, derelicts, stations) and **free annotations** (text,
  arrows, lines, areas, ellipses).
- **Editing** — multi-selection with a rubber band, group edits, copy/paste
  across tabs, and undo/redo built on invertible operations.
- **Display panel** — every layer can be toggled; border width, fill opacity and
  label sizes are per-map settings saved with the map.
- **Image export** — the current view, the whole galaxy, or one empire in colour
  with the rest greyed out; up to 16384 px, optional transparent background and
  a legend built from what that image actually shows.
- **Server** — accounts, maps stored server-side, **live collaborative editing**
  over WebSocket, and publishing a map as a read-only link.

## Getting started

```bash
npm install
npm run dev          # client only, http://localhost:5173
npm run build        # type-check + production bundle into dist/
npm run build:server # compile the API server
npm run server       # serve dist/ + the API (PORT, DATA_DIR, STATIC_DIR)
```

Without a server the app works entirely offline: the map lives in
`localStorage` and can be exported as JSON or PNG.

## Controls

| Action | How |
|---|---|
| Pan | right- or middle-drag |
| Zoom | mouse wheel (toward the cursor) |
| Select | click; **Shift** adds; drag a box over empty space |
| Move | drag any selected system (moves the whole selection) |
| Undo / redo | `Ctrl+Z` / `Ctrl+Shift+Z` |
| Copy / paste / duplicate | `Ctrl+C` / `Ctrl+V` / `Ctrl+D` |
| Tools | `V` select · `A` add · `L` link · `B` paint · `E` erase · `N` nebula · `R` region · `O` object · `T` annotate · `G` generate |

## Deployment

The image runs a single Node process that serves both the built app and the
API, so there is nothing to keep in step between two containers:

```bash
docker compose up -d
```

State lives in the `/data` volume — accounts, invite codes and one JSON file per
map. **Back that volume up.** On first start the server prints an invite code to
its log; registration requires one, so the instance is not open to the world:

```bash
docker compose logs galactic-map | grep invite
```

Behind Nginx Proxy Manager, enable **Websockets Support** on the proxy host —
live collaboration and published maps both use `/api/sync`.

## Architecture

```
src/
  model/        document types, the zustand store, and ops.ts — the invertible,
                serialisable operation each edit is expressed as
  generation/   shapes → poisson sampling → delaunay graph → empire flood-fill
  render/       camera, vector territories, nebulae, icons, legend, renderer
  ui/           React chrome: canvas host, toolbar, panels, dialogs
  net/          REST client and the live-sync WebSocket client
  persistence/  JSON import/export, autosave, image export
server/src/     Fastify API: accounts, map storage, rooms and op broadcast
```

Everything hinges on `src/model/ops.ts`. Each edit becomes an operation that is
both invertible (undo is a list of ops, not snapshots of the document) and
serialisable (the same value is sent to the server and relayed to co-editors),
and the server applies ops with the very same code the browser does.

See [docs/roadmap.md](docs/roadmap.md) for what is built and what is next.
