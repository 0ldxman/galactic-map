import { useEditor, EntityRef } from '../model/store';
import { AnnotationKind, ObjectKind } from '../model/types';
import { OBJECT_TYPES, OBJECT_BY_ID } from '../model/objects';
import { Notes } from './Notes';

const TITLES: Record<EntityRef['c'], string> = {
  nebulae: 'Nebula',
  regions: 'Region',
  objects: 'Object',
  annotations: 'Annotation',
};

/** Editor for the selected nebula / region / object / annotation. */
export function EntityInspector({ entity: sel }: { entity: EntityRef }) {
  const map = useEditor((s) => s.map);
  const updateEnt = useEditor((s) => s.updateEnt);
  const removeEnt = useEditor((s) => s.removeEnt);
  const linkObjects = useEditor((s) => s.linkObjects);
  const linkFromId = useEditor((s) => s.linkFromId);
  const setToolOptions = useEditor((s) => s.setToolOptions);

  const ent = map[sel.c][sel.id];
  if (!ent) return null;

  const header = (
    <div className="panel-header">
      <span>{TITLES[sel.c]}</span>
      <button
        className="mini-btn danger"
        onClick={() => removeEnt(sel.c, sel.id)}
      >
        Delete
      </button>
    </div>
  );

  if (sel.c === 'nebulae') {
    const n = map.nebulae[sel.id];
    return (
      <div className="panel">
        {header}
        <label className="field">
          <span>Name</span>
          <input
            value={n.name}
            onChange={(e) => updateEnt('nebulae', n.id, { name: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Colour</span>
          <input
            type="color"
            value={n.color}
            onChange={(e) => updateEnt('nebulae', n.id, { color: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Opacity: {n.opacity.toFixed(2)}</span>
          <input
            type="range"
            min={0.05}
            max={1}
            step={0.05}
            value={n.opacity}
            onChange={(e) =>
              updateEnt('nebulae', n.id, { opacity: Number(e.target.value) })
            }
          />
        </label>
        <div className="panel-note">{n.blobs.length} brush dabs</div>
        <Notes
          value={n.notes}
          onChange={(v) => updateEnt('nebulae', n.id, { notes: v })}
        />
      </div>
    );
  }

  if (sel.c === 'regions') {
    const r = map.regions[sel.id];
    return (
      <div className="panel">
        {header}
        <label className="field">
          <span>Name</span>
          <input
            value={r.name}
            onChange={(e) => updateEnt('regions', r.id, { name: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Size: {Math.round(r.size)}</span>
          <input
            type="range"
            min={10}
            max={400}
            value={r.size}
            onChange={(e) =>
              updateEnt('regions', r.id, { size: Number(e.target.value) })
            }
          />
        </label>
        <label className="field">
          <span>Letter spacing: {(r.spacing ?? 0.35).toFixed(2)}</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={r.spacing ?? 0.35}
            onChange={(e) =>
              updateEnt('regions', r.id, { spacing: Number(e.target.value) })
            }
          />
        </label>
        <label className="field">
          <span>Colour</span>
          <input
            type="color"
            value={r.color ?? '#c9d6f2'}
            onChange={(e) => updateEnt('regions', r.id, { color: e.target.value })}
          />
        </label>
        <Notes
          value={r.notes}
          onChange={(v) => updateEnt('regions', r.id, { notes: v })}
        />
      </div>
    );
  }

  if (sel.c === 'objects') {
    const o = map.objects[sel.id];
    const type = OBJECT_BY_ID[o.kind];
    const linked = o.linkedId ? map.objects[o.linkedId] : null;
    const linking = linkFromId === o.id;
    return (
      <div className="panel">
        {header}
        <label className="field">
          <span>Name</span>
          <input
            value={o.name}
            onChange={(e) => updateEnt('objects', o.id, { name: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Type</span>
          <select
            value={o.kind}
            onChange={(e) =>
              updateEnt('objects', o.id, { kind: e.target.value as ObjectKind })
            }
          >
            {OBJECT_TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Colour</span>
          <input
            type="color"
            value={o.color ?? type?.color ?? '#cfd8ff'}
            onChange={(e) => updateEnt('objects', o.id, { color: e.target.value })}
          />
        </label>

        <div className="field">
          <span>Link</span>
          {linked ? (
            <div className="link-row">
              <span className="link-name">↔ {linked.name}</span>
              <button
                className="mini-btn"
                onClick={() => {
                  updateEnt('objects', o.id, { linkedId: null });
                  updateEnt('objects', linked.id, { linkedId: null });
                }}
              >
                Unlink
              </button>
            </div>
          ) : linkFromId && linkFromId !== o.id ? (
            <button
              className="mini-btn"
              onClick={() => {
                linkObjects(linkFromId, o.id);
                setToolOptions({ linkFromId: null });
              }}
            >
              Link to {map.objects[linkFromId]?.name ?? 'selected'}
            </button>
          ) : (
            <button
              className="mini-btn"
              onClick={() =>
                setToolOptions({ linkFromId: linking ? null : o.id })
              }
            >
              {linking
                ? 'Cancel — now pick the other end'
                : 'Start a link from here'}
            </button>
          )}
        </div>

        <Notes
          value={o.notes}
          onChange={(v) => updateEnt('objects', o.id, { notes: v })}
        />
      </div>
    );
  }

  const a = map.annotations[sel.id];
  return (
    <div className="panel">
      {header}
      <label className="field">
        <span>Kind</span>
        <select
          value={a.kind}
          onChange={(e) =>
            updateEnt('annotations', a.id, {
              kind: e.target.value as AnnotationKind,
            })
          }
        >
          {['text', 'arrow', 'line', 'polygon', 'ellipse'].map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </label>
      {a.kind === 'text' && (
        <>
          <label className="field">
            <span>Text</span>
            <input
              value={a.text ?? ''}
              onChange={(e) =>
                updateEnt('annotations', a.id, { text: e.target.value })
              }
            />
          </label>
          <label className="field">
            <span>Size: {Math.round(a.fontSize ?? 24)}</span>
            <input
              type="range"
              min={4}
              max={400}
              value={a.fontSize ?? 24}
              onChange={(e) =>
                updateEnt('annotations', a.id, {
                  fontSize: Number(e.target.value),
                })
              }
            />
          </label>
        </>
      )}
      {a.kind !== 'text' && (
        <label className="field">
          <span>Line width: {a.width}</span>
          <input
            type="range"
            min={1}
            max={10}
            value={a.width}
            onChange={(e) =>
              updateEnt('annotations', a.id, { width: Number(e.target.value) })
            }
          />
        </label>
      )}
      <label className="field">
        <span>Colour</span>
        <input
          type="color"
          value={a.color}
          onChange={(e) =>
            updateEnt('annotations', a.id, { color: e.target.value })
          }
        />
      </label>
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={!!a.dashed}
          onChange={(e) =>
            updateEnt('annotations', a.id, { dashed: e.target.checked })
          }
        />
        <span>Dashed</span>
      </label>
      {(a.kind === 'polygon' || a.kind === 'ellipse') && (
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={!!a.filled}
            onChange={(e) =>
              updateEnt('annotations', a.id, { filled: e.target.checked })
            }
          />
          <span>Filled</span>
        </label>
      )}
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={(a.layer ?? 'above') === 'below'}
          onChange={(e) =>
            updateEnt('annotations', a.id, {
              layer: e.target.checked ? 'below' : 'above',
            })
          }
        />
        <span>Behind the territories</span>
      </label>
    </div>
  );
}
