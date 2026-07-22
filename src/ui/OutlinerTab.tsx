import { useMemo, useState } from 'react';
import { useEditor } from '../model/store';
import { EntColl } from '../model/ops';
import { DisplaySettings, resolveDisplay } from '../model/display';
import { OBJECT_BY_ID } from '../model/objects';
import { lighten } from '../util/color';

interface Row {
  id: string;
  label: string;
  sub?: string;
  color?: string;
  x: number;
  y: number;
  select: () => void;
}

/**
 * Everything on the map, by category, with the visibility switch for each
 * category sitting right next to the things it hides. Without this an
 * annotation or a nebula could only be found by stumbling across it on canvas.
 */
export function OutlinerTab() {
  const map = useEditor((s) => s.map);
  const selection = useEditor((s) => s.selection);
  const selectedEntity = useEditor((s) => s.selectedEntity);
  const selectSystem = useEditor((s) => s.selectSystem);
  const selectEntity = useEditor((s) => s.selectEntity);
  const setActiveEmpire = useEditor((s) => s.setActiveEmpire);
  const activeEmpireId = useEditor((s) => s.activeEmpireId);
  const addEmpire = useEditor((s) => s.addEmpire);
  const removeEmpire = useEditor((s) => s.removeEmpire);
  const updateEmpire = useEditor((s) => s.updateEmpire);
  const removeEnt = useEditor((s) => s.removeEnt);
  const setDisplay = useEditor((s) => s.setDisplay);
  const focusOn = useEditor((s) => s.focusOn);
  const display = resolveDisplay(map.display);

  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({
    empires: true,
    nebulae: true,
    regions: true,
    objects: true,
    annotations: true,
  });

  const goTo = (x: number, y: number) => focusOn(x, y);

  // --- search across everything with a name -------------------------------
  const hits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return null;
    const out: Row[] = [];
    for (const s of Object.values(map.systems)) {
      if (!s.name.toLowerCase().includes(q)) continue;
      out.push({
        id: s.id,
        label: s.name,
        sub: s.ownerId ? map.empires[s.ownerId]?.name : 'neutral',
        x: s.x,
        y: s.y,
        select: () => selectSystem(s.id),
      });
      if (out.length > 60) break;
    }
    const ents: [EntColl, { id: string; name: string; x: number; y: number }[]][] = [
      ['regions', Object.values(map.regions)],
      ['objects', Object.values(map.objects)],
      [
        'nebulae',
        Object.values(map.nebulae).map((n) => ({
          id: n.id,
          name: n.name,
          x: n.blobs[0]?.x ?? 0,
          y: n.blobs[0]?.y ?? 0,
        })),
      ],
    ];
    for (const [coll, list] of ents) {
      for (const e of list) {
        if (!e.name.toLowerCase().includes(q)) continue;
        out.push({
          id: e.id,
          label: e.name,
          sub: coll.slice(0, -1),
          x: e.x,
          y: e.y,
          select: () => selectEntity({ c: coll, id: e.id }),
        });
      }
    }
    return out;
  }, [query, map, selectSystem, selectEntity]);

  const section = (
    key: string,
    title: string,
    count: number,
    visKey: keyof DisplaySettings,
    body: React.ReactNode
  ) => (
    <div className="out-section" key={key}>
      <div className="out-head">
        <button
          className="out-toggle"
          onClick={() => setOpen((o) => ({ ...o, [key]: !o[key] }))}
        >
          {open[key] ? '▾' : '▸'} {title}
        </button>
        <span className="out-count">{count}</span>
        <button
          className={`eye${display[visKey] ? '' : ' off'}`}
          title={display[visKey] ? 'Hide this layer' : 'Show this layer'}
          onClick={() => setDisplay({ [visKey]: !display[visKey] })}
        >
          {display[visKey] ? '👁' : '⃠'}
        </button>
      </div>
      {open[key] && body}
    </div>
  );

  /**
   * A list of entities with a delete button on every row. Nebulae in
   * particular have no outline of their own to click on the map, so the
   * outliner is where they get selected and thrown away.
   */
  const entRows = (
    coll: EntColl,
    list: { id: string; name: string }[],
    go: (id: string) => void,
    swatch?: (id: string) => string | undefined,
    sub?: (id: string) => string | undefined
  ) => (
    <div className="out-list">
      {list.length === 0 && <div className="empty-hint">None yet.</div>}
      {list.map((e) => (
        <div
          key={e.id}
          className={`out-row${
            selectedEntity?.c === coll && selectedEntity.id === e.id ? ' active' : ''
          }`}
          onClick={() => {
            selectEntity({ c: coll, id: e.id });
            go(e.id);
          }}
        >
          {swatch && (
            <span className="peer-dot" style={{ background: swatch(e.id) }} />
          )}
          <span className="out-name">{e.name}</span>
          {sub && <span className="out-sub">{sub(e.id)}</span>}
          <button
            className="chip-x"
            title="Delete"
            onClick={(ev) => {
              ev.stopPropagation();
              removeEnt(coll, e.id);
            }}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );

  if (hits) {
    return (
      <>
        <input
          className="out-search"
          placeholder="Search systems, regions, objects…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="out-list">
          {hits.length === 0 && <div className="empty-hint">Nothing matches.</div>}
          {hits.map((r) => (
            <button
              key={r.id}
              className={`out-row${selection.includes(r.id) ? ' active' : ''}`}
              onClick={() => {
                r.select();
                goTo(r.x, r.y);
              }}
            >
              <span className="out-name">{r.label}</span>
              <span className="out-sub">{r.sub}</span>
            </button>
          ))}
        </div>
      </>
    );
  }

  const empires = Object.values(map.empires);
  const counts = new Map<string, number>();
  for (const s of Object.values(map.systems)) {
    if (s.ownerId) counts.set(s.ownerId, (counts.get(s.ownerId) ?? 0) + 1);
  }

  return (
    <>
      <input
        className="out-search"
        placeholder="Search systems, regions, objects…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {section(
        'empires',
        'Empires',
        empires.length,
        'showTerritories',
        <div className="out-list">
          {empires.map((e) => (
            <div key={e.id} className="out-empire">
              <div
                className={`out-row${activeEmpireId === e.id ? ' active' : ''}`}
                onClick={() => setActiveEmpire(e.id)}
              >
                <input
                  type="color"
                  title="Territory fill"
                  value={e.color}
                  onClick={(ev) => ev.stopPropagation()}
                  onChange={(ev) => updateEmpire(e.id, { color: ev.target.value })}
                />
                <input
                  className="out-input"
                  value={e.name}
                  onClick={(ev) => ev.stopPropagation()}
                  onChange={(ev) => updateEmpire(e.id, { name: ev.target.value })}
                />
                <span className="out-sub">{counts.get(e.id) ?? 0}</span>
                <button
                  className="chip-x"
                  title="Delete empire"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    removeEmpire(e.id);
                  }}
                >
                  ✕
                </button>
              </div>
              {/* The border colour is a second thought about one empire, not
                  something to scan a list for — so it only unfolds for the
                  one you are working on. */}
              {activeEmpireId === e.id && (
                <div className="out-detail">
                  <span>Border</span>
                  <input
                    type="color"
                    value={e.borderColor ?? lighten(e.color)}
                    onChange={(ev) =>
                      updateEmpire(e.id, { borderColor: ev.target.value })
                    }
                  />
                  {e.borderColor ? (
                    <button
                      className="mini-btn"
                      title="Go back to a lightened fill colour"
                      onClick={() => updateEmpire(e.id, { borderColor: undefined })}
                    >
                      Auto
                    </button>
                  ) : (
                    <span className="out-sub">auto from fill</span>
                  )}
                </div>
              )}
            </div>
          ))}
          <button className="mini-btn" onClick={() => addEmpire()}>
            + Empire
          </button>
          <div className="panel-note">
            The active empire is what Paint applies and what new systems join.
          </div>
        </div>
      )}

      {section(
        'nebulae',
        'Nebulae',
        Object.keys(map.nebulae).length,
        'showNebulae',
        entRows(
          'nebulae',
          Object.values(map.nebulae),
          (id) => {
            const n = map.nebulae[id];
            if (n?.blobs.length) goTo(n.blobs[0].x, n.blobs[0].y);
          },
          (id) => map.nebulae[id]?.color,
          (id) => `${map.nebulae[id]?.blobs.length ?? 0} dabs`
        )
      )}

      {section(
        'regions',
        'Regions',
        Object.keys(map.regions).length,
        'showRegions',
        entRows(
          'regions',
          Object.values(map.regions),
          (id) => {
            const r = map.regions[id];
            if (r) goTo(r.x, r.y);
          },
          (id) => map.regions[id]?.color ?? '#c9d6f2',
          (id) => (map.regions[id]?.shape ? 'area' : 'label')
        )
      )}

      {section(
        'objects',
        'Objects',
        Object.keys(map.objects).length,
        'showObjects',
        entRows(
          'objects',
          Object.values(map.objects),
          (id) => {
            const o = map.objects[id];
            if (o) goTo(o.x, o.y);
          },
          (id) => {
            const o = map.objects[id];
            return o?.color ?? OBJECT_BY_ID[o?.kind ?? '']?.color;
          },
          (id) => {
            const o = map.objects[id];
            if (!o) return undefined;
            const other = o.linkedId ? map.objects[o.linkedId] : null;
            // Showing the far end here is the quickest way to see which gates
            // are actually joined up and which are still dangling.
            return other ? `↔ ${other.name}` : OBJECT_BY_ID[o.kind]?.label;
          }
        )
      )}

      {section(
        'annotations',
        'Annotations',
        Object.keys(map.annotations).length,
        'showAnnotations',
        entRows(
          'annotations',
          Object.values(map.annotations).map((a) => ({
            id: a.id,
            name: a.kind === 'text' ? a.text || '(empty text)' : a.kind,
          })),
          (id) => {
            const a = map.annotations[id];
            if (a?.points[0]) goTo(a.points[0].x, a.points[0].y);
          },
          (id) => map.annotations[id]?.color
        )
      )}
    </>
  );
}
