import { useMemo, useState } from 'react';
import { useEditor } from '../model/store';
import { EntColl } from '../model/ops';
import { resolveDisplay } from '../model/display';
import { OBJECT_BY_ID } from '../model/objects';
import { CATEGORIES, OutlinerCat, OutlinerDialog } from './OutlinerDialog';

interface Hit {
  id: string;
  label: string;
  sub?: string;
  x: number;
  y: number;
  select: () => void;
}

/**
 * What is on this map, by category.
 *
 * The list itself lives in a dialog per category rather than in this column:
 * five stacked scrolling lists meant everything below the first one — the
 * "+ Empire" button among it — was off the bottom of the panel. What stays
 * here is the map's table of contents plus the search, which is the one thing
 * you want without a click.
 */
export function OutlinerTab() {
  const map = useEditor((s) => s.map);
  const selection = useEditor((s) => s.selection);
  const selectSystem = useEditor((s) => s.selectSystem);
  const selectEntity = useEditor((s) => s.selectEntity);
  const setDisplay = useEditor((s) => s.setDisplay);
  const focusOn = useEditor((s) => s.focusOn);
  const display = resolveDisplay(map.display);

  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<OutlinerCat | null>(null);

  // --- search across everything with a name -------------------------------
  const hits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return null;
    const out: Hit[] = [];
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

  const countOf = (cat: OutlinerCat) =>
    cat === 'empires'
      ? Object.keys(map.empires).length
      : Object.keys(map[cat]).length;

  return (
    <>
      <input
        className="out-search"
        placeholder="Search systems, sectors, objects…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {hits ? (
        <div className="out-list">
          {hits.length === 0 && <div className="empty-hint">Nothing matches.</div>}
          {hits.map((r) => (
            <button
              key={r.id}
              className={`out-row${selection.includes(r.id) ? ' active' : ''}`}
              onClick={() => {
                r.select();
                focusOn(r.x, r.y);
              }}
            >
              <span className="out-name">{r.label}</span>
              <span className="out-sub">{r.sub}</span>
            </button>
          ))}
        </div>
      ) : (
        <>
          <div className="cat-grid">
            {CATEGORIES.map((c) => {
              const visible = display[c.vis] as boolean;
              return (
                <div className="cat-card" key={c.id}>
                  <button className="cat-open" onClick={() => setOpen(c.id)}>
                    <span className="cat-icon">{c.icon}</span>
                    <span className="cat-label">{c.label}</span>
                    <span className="cat-count">{countOf(c.id)}</span>
                  </button>
                  <button
                    className={`eye${visible ? '' : ' off'}`}
                    title={visible ? 'Hide this layer' : 'Show this layer'}
                    onClick={() => setDisplay({ [c.vis]: !visible })}
                  >
                    {visible ? '👁' : '⃠'}
                  </button>
                </div>
              );
            })}
          </div>

          <div className="tab-section">
            <div className="kv">
              <span>Systems</span>
              <b>{Object.keys(map.systems).length}</b>
            </div>
            <div className="kv">
              <span>Hyperlanes</span>
              <b>{Object.keys(map.hyperlanes).length}</b>
            </div>
            <div className="kv">
              <span>Linked passages</span>
              <b>
                {
                  Object.values(map.objects).filter(
                    (o) => o.linkedId && OBJECT_BY_ID[o.kind]?.pairs
                  ).length
                }
              </b>
            </div>
            <div className="panel-note">
              The eye hides a layer on the map without deleting anything. Open a
              category to rename, recolour or remove what is in it.
            </div>
          </div>
        </>
      )}

      {open && <OutlinerDialog cat={open} onClose={() => setOpen(null)} />}
    </>
  );
}
