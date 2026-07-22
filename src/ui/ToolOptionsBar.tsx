import { useEditor } from '../model/store';
import { AnnotationKind, ObjectKind } from '../model/types';
import { OBJECT_TYPES, OBJECT_BY_ID } from '../model/objects';

const ANNOTATION_KINDS: { id: AnnotationKind; label: string; hint: string }[] = [
  { id: 'text', label: 'Text', hint: 'Click to place a label' },
  { id: 'arrow', label: 'Arrow', hint: 'Drag to draw an arrow' },
  { id: 'line', label: 'Line', hint: 'Drag to draw a line' },
  { id: 'polygon', label: 'Area', hint: 'Click vertices · Enter finishes · Esc cancels' },
  { id: 'ellipse', label: 'Ellipse', hint: 'Drag to draw an ellipse' },
];

/**
 * Options for the active tool, in a strip above the canvas. They belong to what
 * your hand is doing, not to the document, so they sit next to the map instead
 * of competing for height in the properties panel.
 */
export function ToolOptionsBar() {
  const tool = useEditor((s) => s.tool);
  const map = useEditor((s) => s.map);
  const setToolOptions = useEditor((s) => s.setToolOptions);
  const brushSize = useEditor((s) => s.brushSize);
  const activeNebulaId = useEditor((s) => s.activeNebulaId);
  const nebulaErase = useEditor((s) => s.nebulaErase);
  const objectKind = useEditor((s) => s.objectKind);
  const annotationKind = useEditor((s) => s.annotationKind);
  const annotationColor = useEditor((s) => s.annotationColor);
  const marqueeMode = useEditor((s) => s.marqueeMode);
  const regionMode = useEditor((s) => s.regionMode);
  const activeEmpireId = useEditor((s) => s.activeEmpireId);
  const setActiveEmpire = useEditor((s) => s.setActiveEmpire);
  const addNebula = useEditor((s) => s.addNebula);
  const addEmpire = useEditor((s) => s.addEmpire);
  const removeEnt = useEditor((s) => s.removeEnt);
  const updateEnt = useEditor((s) => s.updateEnt);
  const selection = useEditor((s) => s.selection);
  const linkFromId = useEditor((s) => s.linkFromId);

  const empires = Object.values(map.empires);
  const empirePicker = (
    <label className="opt">
      <span>Empire</span>
      <select
        value={activeEmpireId ?? ''}
        onChange={(e) => setActiveEmpire(e.target.value || null)}
      >
        <option value="">— none —</option>
        {empires.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name}
          </option>
        ))}
      </select>
      {activeEmpireId && map.empires[activeEmpireId] && (
        <span
          className="opt-swatch"
          style={{ background: map.empires[activeEmpireId].color }}
        />
      )}
      {/* Making an empire is what you do right before painting one, so the
          button belongs next to the picker rather than only in a dialog. */}
      <button
        className="mini-btn"
        title="Create an empire and make it the active one"
        onClick={() => addEmpire()}
      >
        +
      </button>
    </label>
  );

  let body: React.ReactNode = null;

  switch (tool) {
    case 'select':
      body = (
        <>
          <div className="opt-seg">
            <button
              className={`seg-btn${marqueeMode === 'box' ? ' active' : ''}`}
              title="Drag a rectangle"
              onClick={() => setToolOptions({ marqueeMode: 'box' })}
            >
              ▭ Box
            </button>
            <button
              className={`seg-btn${marqueeMode === 'lasso' ? ' active' : ''}`}
              title="Draw a free loop around what you want"
              onClick={() => setToolOptions({ marqueeMode: 'lasso' })}
            >
              ✎ Lasso
            </button>
          </div>
          <span className="opt-hint">
            {selection.length > 1
              ? `${selection.length} systems selected`
              : marqueeMode === 'lasso'
                ? 'Draw a loop · Shift adds · right-drag pans'
                : 'Drag a box · Alt-drag lassoes · Shift adds · right-drag pans'}
          </span>
        </>
      );
      break;

    case 'add-system':
    case 'paint':
      body = (
        <>
          {empirePicker}
          <span className="opt-hint">
            {tool === 'paint'
              ? 'Click or drag across systems to hand them over'
              : 'Click empty space to drop a system'}
          </span>
        </>
      );
      break;

    case 'nebula': {
      const active = activeNebulaId ? map.nebulae[activeNebulaId] : null;
      return (
        <div className="opt-bar">
          <label className="opt">
            <span>Nebula</span>
            <select
              value={activeNebulaId ?? ''}
              onChange={(e) => setToolOptions({ activeNebulaId: e.target.value || null })}
            >
              <option value="">— new —</option>
              {Object.values(map.nebulae).map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
            </select>
          </label>
          <button className="mini-btn" onClick={() => addNebula()}>
            + New
          </button>
          {active && (
            <>
              <label className="opt">
                <span>Colour</span>
                <input
                  type="color"
                  value={active.color}
                  onChange={(e) =>
                    updateEnt('nebulae', active.id, { color: e.target.value })
                  }
                />
              </label>
              <label className="opt">
                <span>Opacity</span>
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
              <label className="opt">
                <span>Texture</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={active.texture ?? 0.75}
                  onChange={(e) =>
                    updateEnt('nebulae', active.id, {
                      texture: Number(e.target.value),
                    })
                  }
                />
              </label>
            </>
          )}
          <div className="opt-seg">
            <button
              className={`seg-btn${nebulaErase ? '' : ' active'}`}
              onClick={() => setToolOptions({ nebulaErase: false })}
            >
              Paint
            </button>
            <button
              className={`seg-btn${nebulaErase ? ' active' : ''}`}
              onClick={() => setToolOptions({ nebulaErase: true })}
            >
              Erase
            </button>
          </div>
          <label className="opt">
            <span>Brush {Math.round(brushSize)}</span>
            <input
              type="range"
              min={10}
              max={400}
              value={brushSize}
              onChange={(e) => setToolOptions({ brushSize: Number(e.target.value) })}
            />
          </label>
          {active && (
            <button
              className="mini-btn danger"
              title="Delete this nebula and everything painted into it"
              onClick={() => {
                if (confirm(`Delete "${active.name}" and all its gas?`)) {
                  removeEnt('nebulae', active.id);
                }
              }}
            >
              🗑 Delete cloud
            </button>
          )}
          <span className="opt-hint">Alt flips paint / erase</span>
        </div>
      );
    }

    case 'object':
      body = (
        <>
          <label className="opt">
            <span>Type</span>
            <select
              value={objectKind}
              onChange={(e) =>
                setToolOptions({ objectKind: e.target.value as ObjectKind })
              }
            >
              {OBJECT_TYPES.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <span className="opt-hint">
            {linkFromId
              ? 'Linking — switch to Select and click the other end'
              : OBJECT_BY_ID[objectKind]?.pairs
                ? 'Click a system to pin it · drop two and link them in Properties'
                : 'Clicking a system pins the object beside it'}
          </span>
        </>
      );
      break;

    case 'annotate':
      body = (
        <>
          <div className="opt-seg">
            {ANNOTATION_KINDS.map((k) => (
              <button
                key={k.id}
                className={`seg-btn${annotationKind === k.id ? ' active' : ''}`}
                title={k.hint}
                onClick={() => setToolOptions({ annotationKind: k.id })}
              >
                {k.label}
              </button>
            ))}
          </div>
          <label className="opt">
            <span>Colour</span>
            <input
              type="color"
              value={annotationColor}
              onChange={(e) => setToolOptions({ annotationColor: e.target.value })}
            />
          </label>
          <span className="opt-hint">
            {ANNOTATION_KINDS.find((k) => k.id === annotationKind)?.hint}
          </span>
        </>
      );
      break;

    case 'region':
      body = (
        <>
          <div className="opt-seg">
            <button
              className={`seg-btn${regionMode === 'area' ? ' active' : ''}`}
              title="Draw the sector's boundary"
              onClick={() => setToolOptions({ regionMode: 'area' })}
            >
              ⬠ Area
            </button>
            <button
              className={`seg-btn${regionMode === 'label' ? ' active' : ''}`}
              title="Just a wide name across the map"
              onClick={() => setToolOptions({ regionMode: 'label' })}
            >
              A Label
            </button>
          </div>
          <span className="opt-hint">
            {regionMode === 'area'
              ? 'Drag a loop around the sector — it closes itself'
              : 'Click to drop a sector name'}
          </span>
        </>
      );
      break;

    case 'connect':
      body = (
        <span className="opt-hint">
          Click two systems to add or remove a hyperlane
        </span>
      );
      break;

    case 'delete':
      body = (
        <span className="opt-hint">
          Click a system, object, annotation or hyperlane to remove it
        </span>
      );
      break;
  }

  return <div className="opt-bar">{body}</div>;
}
