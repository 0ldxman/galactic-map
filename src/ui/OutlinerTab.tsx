import { useMemo, useState } from 'react';
import { useEditor } from '../model/store';
import { EntColl } from '../model/ops';
import { DisplaySettings, resolveDisplay } from '../model/display';
import { OBJECT_BY_ID } from '../model/objects';

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

  const entRows = (coll: EntColl, list: { id: string; name: string }[], go: (id: string) => void) => (
    <div className="out-list">
      {list.length === 0 && <div className="empty-hint">None yet.</div>}
      {list.map((e) => (
        <button
          key={e.id}
          className={`out-row${
            selectedEntity?.c === coll && selectedEntity.id === e.id ? ' active' : ''
          }`}
          onClick={() => {
            selectEntity({ c: coll, id: e.id });
            go(e.id);
          }}
        >
          <span className="out-name">{e.name}</span>
        </button>
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
            <div
              key={e.id}
              className={`out-row${activeEmpireId === e.id ? ' active' : ''}`}
              onClick={() => setActiveEmpire(e.id)}
            >
              <input
                type="color"
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
        entRows('nebulae', Object.values(map.nebulae), (id) => {
          const n = map.nebulae[id];
          if (n?.blobs.length) goTo(n.blobs[0].x, n.blobs[0].y);
        })
      )}

      {section(
        'regions',
        'Regions',
        Object.keys(map.regions).length,
        'showRegions',
        entRows('regions', Object.values(map.regions), (id) => {
          const r = map.regions[id];
          if (r) goTo(r.x, r.y);
        })
      )}

      {section(
        'objects',
        'Objects',
        Object.keys(map.objects).length,
        'showObjects',
        <div className="out-list">
          {Object.values(map.objects).length === 0 && (
            <div className="empty-hint">None yet.</div>
          )}
          {Object.values(map.objects).map((o) => (
            <button
              key={o.id}
              className={`out-row${
                selectedEntity?.c === 'objects' && selectedEntity.id === o.id
                  ? ' active'
                  : ''
              }`}
              onClick={() => {
                selectEntity({ c: 'objects', id: o.id });
                goTo(o.x, o.y);
              }}
            >
              <span
                className="peer-dot"
                style={{ background: o.color ?? OBJECT_BY_ID[o.kind]?.color }}
              />
              <span className="out-name">{o.name}</span>
              <span className="out-sub">{OBJECT_BY_ID[o.kind]?.label}</span>
            </button>
          ))}
        </div>
      )}

      {section(
        'annotations',
        'Annotations',
        Object.keys(map.annotations).length,
        'showAnnotations',
        <div className="out-list">
          {Object.values(map.annotations).length === 0 && (
            <div className="empty-hint">None yet.</div>
          )}
          {Object.values(map.annotations).map((a) => (
            <button
              key={a.id}
              className={`out-row${
                selectedEntity?.c === 'annotations' && selectedEntity.id === a.id
                  ? ' active'
                  : ''
              }`}
              onClick={() => {
                selectEntity({ c: 'annotations', id: a.id });
                if (a.points[0]) goTo(a.points[0].x, a.points[0].y);
              }}
            >
              <span className="peer-dot" style={{ background: a.color }} />
              <span className="out-name">
                {a.kind === 'text' ? a.text || '(empty text)' : a.kind}
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
