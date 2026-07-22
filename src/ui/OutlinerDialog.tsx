import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../model/store';
import { EntColl } from '../model/ops';
import { OBJECT_BY_ID } from '../model/objects';
import { DisplaySettings, resolveDisplay } from '../model/display';
import { lighten } from '../util/color';
import { ColorSwatch } from './ColorSwatch';
import { addImageFiles } from './addImage';

/** The categories the outliner can open. Empires aren't an entity collection. */
export type OutlinerCat = 'empires' | EntColl;

export const CATEGORIES: {
  id: OutlinerCat;
  label: string;
  icon: string;
  vis: keyof DisplaySettings;
  /** what to say when the list is empty — usually which tool makes them */
  empty: string;
}[] = [
  {
    id: 'empires',
    label: 'Empires',
    icon: '⬢',
    vis: 'showTerritories',
    empty: 'No empires yet. Add one, then paint systems into it with B.',
  },
  {
    id: 'nebulae',
    label: 'Nebulae',
    icon: '☁',
    vis: 'showNebulae',
    empty: 'No clouds yet. Add one and paint it with the Nebula tool (N).',
  },
  {
    id: 'regions',
    label: 'Sectors',
    icon: '◍',
    vis: 'showRegions',
    empty: 'No sectors yet. Draw one with the Region tool (R).',
  },
  {
    id: 'objects',
    label: 'Objects',
    icon: '⬡',
    vis: 'showObjects',
    empty: 'Nothing placed yet. Drop gates and wrecks with the Object tool (O).',
  },
  {
    id: 'references',
    label: 'References',
    icon: '🖼',
    vis: 'showReferences',
    empty:
      'No tracing images. Drop one on the map, paste one, or add a file below — ' +
      'handy for lining systems up with a screenshot from the game.',
  },
  {
    id: 'annotations',
    label: 'Notes',
    icon: '✎',
    vis: 'showAnnotations',
    empty: 'Nothing drawn yet. Text, arrows and areas come from the Note tool (T).',
  },
];

/**
 * One category of map furniture, edited in its own window.
 *
 * The outliner used to stack every category into a single scrolling column, so
 * the thing you wanted was always below the fold — including, fatally, the
 * button that makes a new empire. Each list now gets the whole dialog.
 */
export function OutlinerDialog({
  cat,
  onClose,
}: {
  cat: OutlinerCat;
  onClose: () => void;
}) {
  const map = useEditor((s) => s.map);
  const activeEmpireId = useEditor((s) => s.activeEmpireId);
  const selectedEntity = useEditor((s) => s.selectedEntity);
  const setActiveEmpire = useEditor((s) => s.setActiveEmpire);
  const selectEntity = useEditor((s) => s.selectEntity);
  const addEmpire = useEditor((s) => s.addEmpire);
  const updateEmpire = useEditor((s) => s.updateEmpire);
  const removeEmpire = useEditor((s) => s.removeEmpire);
  const addNebula = useEditor((s) => s.addNebula);
  const updateEnt = useEditor((s) => s.updateEnt);
  const removeEnt = useEditor((s) => s.removeEnt);
  const setDisplay = useEditor((s) => s.setDisplay);
  const focusOn = useEditor((s) => s.focusOn);
  const readOnly = useEditor((s) => s.readOnly);
  const [query, setQuery] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const meta = CATEGORIES.find((c) => c.id === cat)!;
  const display = resolveDisplay(map.display);
  const visible = display[meta.vis] as boolean;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /** Selecting something means you want to look at it — so we get out of the way. */
  const goTo = (x: number, y: number) => {
    focusOn(x, y);
    onClose();
  };

  const match = (name: string) =>
    !query.trim() || name.toLowerCase().includes(query.trim().toLowerCase());

  let rows: React.ReactNode = null;
  let count = 0;

  if (cat === 'empires') {
    const counts = new Map<string, number>();
    for (const s of Object.values(map.systems)) {
      if (s.ownerId) counts.set(s.ownerId, (counts.get(s.ownerId) ?? 0) + 1);
    }
    const list = Object.values(map.empires).filter((e) => match(e.name));
    count = Object.keys(map.empires).length;
    rows = list.map((e) => (
      <div
        key={e.id}
        className={`ol-row${activeEmpireId === e.id ? ' active' : ''}`}
        onClick={() => setActiveEmpire(e.id)}
      >
        <ColorSwatch
          title="Territory fill"
          value={e.color}
          disabled={readOnly}
          onChange={(hex) => updateEmpire(e.id, { color: hex })}
        />
        <ColorSwatch
          title={
            e.borderColor
              ? 'Border colour — click Auto to follow the fill again'
              : 'Border colour (currently derived from the fill)'
          }
          value={e.borderColor ?? lighten(e.color)}
          disabled={readOnly}
          onChange={(hex) => updateEmpire(e.id, { borderColor: hex })}
        />
        <input
          className="ol-name"
          value={e.name}
          disabled={readOnly}
          onClick={(ev) => ev.stopPropagation()}
          onChange={(ev) => updateEmpire(e.id, { name: ev.target.value })}
        />
        {e.borderColor && (
          <button
            className="mini-btn"
            title="Derive the border from the fill again"
            onClick={(ev) => {
              ev.stopPropagation();
              updateEmpire(e.id, { borderColor: undefined });
            }}
          >
            Auto
          </button>
        )}
        <span className="ol-sub">{counts.get(e.id) ?? 0} sys</span>
        {activeEmpireId === e.id && <span className="badge">active</span>}
        <button
          className="chip-x"
          title="Delete this empire (its systems go neutral)"
          disabled={readOnly}
          onClick={(ev) => {
            ev.stopPropagation();
            if (confirm(`Delete "${e.name}"? Its systems become unclaimed.`)) {
              removeEmpire(e.id);
            }
          }}
        >
          ✕
        </button>
      </div>
    ));
  } else {
    const coll = cat;
    type Row = { id: string; name: string; color?: string; sub?: string; x: number; y: number };
    let list: Row[] = [];
    if (coll === 'nebulae') {
      list = Object.values(map.nebulae).map((n) => ({
        id: n.id,
        name: n.name,
        color: n.color,
        sub: `${n.blobs.length} dabs`,
        x: n.blobs[0]?.x ?? 0,
        y: n.blobs[0]?.y ?? 0,
      }));
    } else if (coll === 'regions') {
      list = Object.values(map.regions).map((r) => ({
        id: r.id,
        name: r.name,
        color: r.color ?? '#c9d6f2',
        sub: r.shape ? `area · ${r.shape.length} pts` : 'label',
        x: r.x,
        y: r.y,
      }));
    } else if (coll === 'objects') {
      list = Object.values(map.objects).map((o) => {
        const far = o.linkedId ? map.objects[o.linkedId] : null;
        return {
          id: o.id,
          name: o.name,
          color: o.color ?? OBJECT_BY_ID[o.kind]?.color,
          sub: far ? `↔ ${far.name}` : OBJECT_BY_ID[o.kind]?.label,
          x: o.x,
          y: o.y,
        };
      });
    } else if (coll === 'references') {
      list = Object.values(map.references).map((r) => ({
        id: r.id,
        name: r.name,
        sub: `${Math.round(r.w)}×${Math.round(r.h)}${r.locked ? ' · locked' : ''}`,
        x: r.x + r.w / 2,
        y: r.y + r.h / 2,
      }));
    } else {
      list = Object.values(map.annotations).map((a) => ({
        id: a.id,
        name: a.kind === 'text' ? a.text || '(empty text)' : a.kind,
        color: a.color,
        sub: a.kind,
        x: a.points[0]?.x ?? 0,
        y: a.points[0]?.y ?? 0,
      }));
    }
    count = list.length;
    rows = list
      .filter((r) => match(r.name))
      .map((r) => (
        <div
          key={r.id}
          className={`ol-row${
            selectedEntity?.c === coll && selectedEntity.id === r.id ? ' active' : ''
          }`}
          onClick={() => selectEntity({ c: coll, id: r.id })}
        >
          {coll === 'references' ? (
            <button
              className="eye"
              title={
                map.references[r.id]?.locked
                  ? 'Unlock so it can be moved'
                  : 'Lock it in place'
              }
              disabled={readOnly}
              onClick={(ev) => {
                ev.stopPropagation();
                updateEnt('references', r.id, {
                  locked: !map.references[r.id]?.locked,
                });
              }}
            >
              {map.references[r.id]?.locked ? '🔒' : '🔓'}
            </button>
          ) : (
            <ColorSwatch
              value={r.color ?? '#cfd8ff'}
              disabled={readOnly}
              onChange={(hex) => updateEnt(coll, r.id, { color: hex } as never)}
            />
          )}
          <input
            className="ol-name"
            value={r.name}
            disabled={readOnly || coll === 'annotations'}
            onClick={(ev) => ev.stopPropagation()}
            onChange={(ev) =>
              updateEnt(coll, r.id, { name: ev.target.value } as never)
            }
          />
          <span className="ol-sub">{r.sub}</span>
          <button
            className="mini-btn"
            title="Select it and fly there"
            onClick={(ev) => {
              ev.stopPropagation();
              selectEntity({ c: coll, id: r.id });
              goTo(r.x, r.y);
            }}
          >
            ◎
          </button>
          <button
            className="chip-x"
            title="Delete"
            disabled={readOnly}
            onClick={(ev) => {
              ev.stopPropagation();
              removeEnt(coll, r.id);
            }}
          >
            ✕
          </button>
        </div>
      ));
  }

  const create =
    cat === 'empires'
      ? () => addEmpire()
      : cat === 'nebulae'
        ? () => addNebula()
        : cat === 'references'
          ? () => fileRef.current?.click()
          : null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal ol-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ol-head">
          <h2>
            <span className="ol-icon">{meta.icon}</span> {meta.label}
            <span className="ol-count">{count}</span>
          </h2>
          <button
            className={`eye${visible ? '' : ' off'}`}
            title={visible ? 'Hide this layer on the map' : 'Show this layer'}
            onClick={() => setDisplay({ [meta.vis]: !visible })}
          >
            {visible ? '👁' : '⃠'}
          </button>
        </div>

        {count > 8 && (
          <input
            className="out-search"
            placeholder={`Filter ${meta.label.toLowerCase()}…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        )}

        <div className="ol-list">
          {count === 0 ? <div className="empty-hint">{meta.empty}</div> : rows}
        </div>

        {cat === 'references' && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: 'none' }}
              onChange={async (e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = '';
                if (files.length === 0) return;
                setBusy(true);
                setNote(await addImageFiles(files));
                setBusy(false);
              }}
            />
            {note && <div className="panel-note">{note}</div>}
            <div className="panel-note">
              Images are downscaled and stored inside the map, so they survive a
              reload and reach your co-editors — but they also make the file
              bigger. Guests reading the published link never see them.
            </div>
          </>
        )}

        <div className="modal-actions">
          {create && (
            <button
              className="tool-btn"
              disabled={readOnly || busy}
              onClick={create}
            >
              {cat === 'references'
                ? busy
                  ? 'Reading…'
                  : '＋ Add image…'
                : `+ New ${meta.label.replace(/s$/, '').toLowerCase()}`}
            </button>
          )}
          <button className="tool-btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
