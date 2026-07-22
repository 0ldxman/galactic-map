import { useEditor, EntityRef } from '../model/store';
import { AnnotationKind, ObjectKind } from '../model/types';
import { OBJECT_TYPES, OBJECT_BY_ID } from '../model/objects';
import { pointInPolygon } from '../util/geom';
import { Notes } from './Notes';
import { ColorSwatch } from './ColorSwatch';
import { getImage } from '../render/references';

const TITLES: Record<EntityRef['c'], string> = {
  nebulae: 'Nebula',
  regions: 'Region',
  objects: 'Object',
  annotations: 'Annotation',
  references: 'Reference image',
};

/** Editor for the selected nebula / region / object / annotation. */
export function EntityInspector({ entity: sel }: { entity: EntityRef }) {
  const map = useEditor((s) => s.map);
  const updateEnt = useEditor((s) => s.updateEnt);
  const removeEnt = useEditor((s) => s.removeEnt);
  const linkObjects = useEditor((s) => s.linkObjects);
  const linkFromId = useEditor((s) => s.linkFromId);
  const setToolOptions = useEditor((s) => s.setToolOptions);
  const focusOn = useEditor((s) => s.focusOn);

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
        <div className="field">
          <span>Colour</span>
          <ColorSwatch
            value={n.color}
            onChange={(hex) => updateEnt('nebulae', n.id, { color: hex })}
          />
        </div>
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
        <label className="field">
          <span>Texture: {(n.texture ?? 0.75).toFixed(2)}</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={n.texture ?? 0.75}
            onChange={(e) =>
              updateEnt('nebulae', n.id, { texture: Number(e.target.value) })
            }
          />
        </label>
        <label className="field">
          <span>Filament size: {Math.round(n.detail ?? 320)}</span>
          <input
            type="range"
            min={60}
            max={1200}
            step={10}
            value={n.detail ?? 320}
            onChange={(e) =>
              updateEnt('nebulae', n.id, { detail: Number(e.target.value) })
            }
          />
        </label>
        <div className="btn-row">
          <button
            className="mini-btn"
            title="Reshuffle the noise for a different cloud of the same size"
            onClick={() =>
              updateEnt('nebulae', n.id, {
                seed: Math.floor(Math.random() * 0xffffff),
              })
            }
          >
            ⟳ New pattern
          </button>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={n.showName}
              onChange={(e) =>
                updateEnt('nebulae', n.id, { showName: e.target.checked })
              }
            />
            <span>Show name</span>
          </label>
        </div>
        <div className="panel-note">
          {n.blobs.length} brush dabs. Texture 0 gives the plain soft cloud;
          higher values tear it into filaments.
        </div>
        <Notes
          value={n.notes}
          onChange={(v) => updateEnt('nebulae', n.id, { notes: v })}
        />
      </div>
    );
  }

  if (sel.c === 'regions') {
    const r = map.regions[sel.id];
    const inside = r.shape
      ? Object.values(map.systems).filter((s) =>
          pointInPolygon(s.x, s.y, r.shape!)
        )
      : [];
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
        {r.shape ? (
          <>
            <div className="kv">
              <span>Systems inside</span>
              <b>{inside.length}</b>
            </div>
            <label className="field">
              <span>Area fill: {(r.fillAlpha ?? 0.1).toFixed(2)}</span>
              <input
                type="range"
                min={0}
                max={0.4}
                step={0.01}
                value={r.fillAlpha ?? 0.1}
                onChange={(e) =>
                  updateEnt('regions', r.id, {
                    fillAlpha: Number(e.target.value),
                  })
                }
              />
            </label>
            <div className="btn-row">
              <button
                className="mini-btn"
                title="Keep the name, drop the boundary"
                onClick={() => updateEnt('regions', r.id, { shape: undefined })}
              >
                Drop the outline
              </button>
            </div>
            <div className="panel-note">
              Drag the handles to reshape it, or drag inside to move the whole
              sector. {r.shape.length} points.
            </div>
          </>
        ) : (
          <div className="panel-note">
            A bare label. Draw a boundary with the Region tool in Area mode to
            make it a real sector.
          </div>
        )}
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
        <div className="field">
          <span>Colour</span>
          <ColorSwatch
            value={r.color ?? '#c9d6f2'}
            onChange={(hex) => updateEnt('regions', r.id, { color: hex })}
          />
        </div>
        <Notes
          value={r.notes}
          onChange={(v) => updateEnt('regions', r.id, { notes: v })}
        />
      </div>
    );
  }

  if (sel.c === 'references') {
    const r = map.references[sel.id];
    return (
      <div className="panel">
        {header}
        <label className="field">
          <span>Name</span>
          <input
            value={r.name}
            onChange={(e) => updateEnt('references', r.id, { name: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Opacity: {r.opacity.toFixed(2)}</span>
          <input
            type="range"
            min={0.05}
            max={1}
            step={0.05}
            value={r.opacity}
            onChange={(e) =>
              updateEnt('references', r.id, { opacity: Number(e.target.value) })
            }
          />
        </label>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={!!r.locked}
            onChange={(e) =>
              updateEnt('references', r.id, { locked: e.target.checked })
            }
          />
          <span>Locked — can't be picked or nudged</span>
        </label>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={(r.layer ?? 'below') === 'above'}
            onChange={(e) =>
              updateEnt('references', r.id, {
                layer: e.target.checked ? 'above' : 'below',
              })
            }
          />
          <span>Over the territories</span>
        </label>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={!!r.exported}
            onChange={(e) =>
              updateEnt('references', r.id, { exported: e.target.checked })
            }
          />
          <span>Include in exported images</span>
        </label>
        {/* Numbers, because correcting a perspective usually means "make it
            exactly this much taller" rather than nudging a handle. */}
        <div className="btn-row">
          <label className="opt">
            <span>W</span>
            <input
              type="number"
              step={1}
              value={Math.round(r.w)}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (v >= 4) updateEnt('references', r.id, { w: v });
              }}
            />
          </label>
          <label className="opt">
            <span>H</span>
            <input
              type="number"
              step={1}
              value={Math.round(r.h)}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (v >= 4) updateEnt('references', r.id, { h: v });
              }}
            />
          </label>
        </div>
        <div className="btn-row">
          <button
            className="mini-btn"
            title="Match the picture's own proportions again"
            onClick={() => {
              const img = getImage(r.src);
              if (!img?.naturalWidth) return;
              updateEnt('references', r.id, {
                h: (r.w * img.naturalHeight) / img.naturalWidth,
              });
            }}
          >
            Reset aspect
          </button>
          <button
            className="mini-btn"
            title="Put the camera on it"
            onClick={() => focusOn(r.x + r.w / 2, r.y + r.h / 2)}
          >
            ◎ Go to
          </button>
        </div>
        <div className="panel-note">
          {Math.round(r.src.length / 1024)} KB in the file. A corner scales the
          whole picture (Alt frees the proportions); a <b>side handle stretches
          that one axis</b>, which is what a game screenshot usually needs —
          its galaxy is drawn in perspective. Then lock it and draw on top. A
          guest reading the published map never sees it.
        </div>
      </div>
    );
  }

  if (sel.c === 'objects') {
    const o = map.objects[sel.id];
    const type = OBJECT_BY_ID[o.kind];
    const linked = o.linkedId ? map.objects[o.linkedId] : null;
    const linking = linkFromId === o.id;
    // A passage joins to one of its own kind — a wormhole doesn't open onto a
    // gateway. Ends that are already taken stay on the list, and picking one
    // moves the link rather than silently doing nothing.
    const candidates = Object.values(map.objects).filter(
      (c) => c.id !== o.id && c.kind === o.kind
    );
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
        <div className="field">
          <span>Colour</span>
          <ColorSwatch
            value={o.color ?? type?.color ?? '#cfd8ff'}
            onChange={(hex) => updateEnt('objects', o.id, { color: hex })}
          />
        </div>

        {/* Only passages lead somewhere. A debris field has no far end, so it
            isn't offered one. */}
        {type?.pairs && (
          <div className="field">
            <span>Leads to</span>
            {linked ? (
              <div className="link-row">
                <span className="link-name">↔ {linked.name}</span>
                <button
                  className="mini-btn"
                  onClick={() => focusOn(linked.x, linked.y)}
                  title="Jump to the other end"
                >
                  Go
                </button>
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
            ) : (
              <>
                <select
                  value=""
                  onChange={(e) => {
                    if (e.target.value) linkObjects(o.id, e.target.value);
                  }}
                >
                  <option value="">— pick the far end —</option>
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.linkedId ? ' (relinks)' : ''}
                    </option>
                  ))}
                </select>
                <button
                  className={`mini-btn${linking ? ' danger' : ''}`}
                  onClick={() =>
                    setToolOptions({ linkFromId: linking ? null : o.id })
                  }
                >
                  {linking
                    ? '✕ Cancel — or click the other end on the map'
                    : '⇢ Pick the far end on the map'}
                </button>
                {candidates.length === 0 && (
                  <div className="panel-note">
                    Nothing to link to yet — drop a second {type.label} first.
                  </div>
                )}
              </>
            )}
          </div>
        )}

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
      <div className="field">
        <span>Colour</span>
        <ColorSwatch
          value={a.color}
          onChange={(hex) => updateEnt('annotations', a.id, { color: hex })}
        />
      </div>
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
