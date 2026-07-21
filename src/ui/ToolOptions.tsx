import { useEditor } from '../model/store';
import { AnnotationKind, ObjectKind } from '../model/types';
import { OBJECT_TYPES } from '../model/objects';

const ANNOTATION_KINDS: { id: AnnotationKind; label: string; hint: string }[] = [
  { id: 'text', label: 'Text', hint: 'Click to place a label' },
  { id: 'arrow', label: 'Arrow', hint: 'Drag to draw an arrow' },
  { id: 'line', label: 'Line', hint: 'Drag to draw a line' },
  { id: 'polygon', label: 'Area', hint: 'Click vertices, Enter to finish, Esc to cancel' },
  { id: 'ellipse', label: 'Ellipse', hint: 'Drag to draw an ellipse' },
];

/**
 * Contextual options for the active tool — the equivalent of Photoshop's
 * options bar. Hidden entirely for tools that have nothing to configure.
 */
export function ToolOptions() {
  const tool = useEditor((s) => s.tool);
  const map = useEditor((s) => s.map);
  const setToolOptions = useEditor((s) => s.setToolOptions);
  const brushSize = useEditor((s) => s.brushSize);
  const activeNebulaId = useEditor((s) => s.activeNebulaId);
  const objectKind = useEditor((s) => s.objectKind);
  const annotationKind = useEditor((s) => s.annotationKind);
  const annotationColor = useEditor((s) => s.annotationColor);
  const addNebula = useEditor((s) => s.addNebula);
  const updateEnt = useEditor((s) => s.updateEnt);
  const removeEnt = useEditor((s) => s.removeEnt);

  if (tool === 'nebula') {
    const nebulae = Object.values(map.nebulae);
    const active = activeNebulaId ? map.nebulae[activeNebulaId] : null;
    return (
      <div className="panel">
        <div className="panel-header">
          <span>Nebula brush</span>
          <button className="mini-btn" onClick={() => addNebula()}>
            + New
          </button>
        </div>
        <label className="field">
          <span>Brush size: {Math.round(brushSize)}</span>
          <input
            type="range"
            min={10}
            max={400}
            value={brushSize}
            onChange={(e) => setToolOptions({ brushSize: Number(e.target.value) })}
          />
        </label>
        <div className="empire-list">
          {nebulae.length === 0 && (
            <div className="empty-hint">
              Painting on the map creates a nebula automatically.
            </div>
          )}
          {nebulae.map((n) => (
            <div
              key={n.id}
              className={`empire-row${activeNebulaId === n.id ? ' active' : ''}`}
              onClick={() => setToolOptions({ activeNebulaId: n.id })}
            >
              <input
                type="color"
                value={n.color}
                onClick={(ev) => ev.stopPropagation()}
                onChange={(ev) =>
                  updateEnt('nebulae', n.id, { color: ev.target.value })
                }
              />
              <input
                className="empire-name"
                value={n.name}
                onClick={(ev) => ev.stopPropagation()}
                onChange={(ev) =>
                  updateEnt('nebulae', n.id, { name: ev.target.value })
                }
              />
              <span className="empire-count">{n.blobs.length}</span>
              <button
                className="mini-btn danger"
                title="Delete nebula"
                onClick={(ev) => {
                  ev.stopPropagation();
                  removeEnt('nebulae', n.id);
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        {active && (
          <>
            <label className="field" style={{ marginTop: 8 }}>
              <span>Opacity: {active.opacity.toFixed(2)}</span>
              <input
                type="range"
                min={0.05}
                max={1}
                step={0.05}
                value={active.opacity}
                onChange={(e) =>
                  updateEnt('nebulae', active.id, {
                    opacity: Number(e.target.value),
                  })
                }
              />
            </label>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={active.showName}
                onChange={(e) =>
                  updateEnt('nebulae', active.id, { showName: e.target.checked })
                }
              />
              <span>Show its name on the map</span>
            </label>
          </>
        )}
        <div className="panel-note">Alt-drag erases from the active nebula.</div>
      </div>
    );
  }

  if (tool === 'object') {
    return (
      <div className="panel">
        <div className="panel-header">
          <span>Object type</span>
        </div>
        <div className="marker-grid">
          {OBJECT_TYPES.map((o) => (
            <button
              key={o.id}
              type="button"
              className={`marker-chip${objectKind === o.id ? ' active' : ''}`}
              title={o.hint}
              onClick={() => setToolOptions({ objectKind: o.id as ObjectKind })}
            >
              <span className="marker-glyph" style={{ color: o.color }}>
                ◆
              </span>
              <span className="marker-label">{o.label}</span>
            </button>
          ))}
        </div>
        <div className="panel-note">
          Clicking a system pins the object beside it. Pair wormholes and gates
          from the object's inspector.
        </div>
      </div>
    );
  }

  if (tool === 'annotate') {
    const hint = ANNOTATION_KINDS.find((k) => k.id === annotationKind)?.hint;
    return (
      <div className="panel">
        <div className="panel-header">
          <span>Annotation</span>
          <input
            type="color"
            value={annotationColor}
            onChange={(e) => setToolOptions({ annotationColor: e.target.value })}
          />
        </div>
        <div className="marker-grid">
          {ANNOTATION_KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              className={`marker-chip${annotationKind === k.id ? ' active' : ''}`}
              title={k.hint}
              onClick={() => setToolOptions({ annotationKind: k.id })}
            >
              <span className="marker-label">{k.label}</span>
            </button>
          ))}
        </div>
        <div className="panel-note">{hint}</div>
      </div>
    );
  }

  return null;
}
