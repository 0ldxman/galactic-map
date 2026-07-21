import { useEditor } from '../model/store';
import { lighten } from '../util/color';

export function EmpirePanel() {
  const map = useEditor((s) => s.map);
  const activeEmpireId = useEditor((s) => s.activeEmpireId);
  const setActiveEmpire = useEditor((s) => s.setActiveEmpire);
  const addEmpire = useEditor((s) => s.addEmpire);
  const updateEmpire = useEditor((s) => s.updateEmpire);
  const removeEmpire = useEditor((s) => s.removeEmpire);

  const empires = Object.values(map.empires);
  const systems = Object.values(map.systems);
  const counts = new Map<string, number>();
  for (const s of systems) {
    if (s.ownerId) counts.set(s.ownerId, (counts.get(s.ownerId) ?? 0) + 1);
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <span>Empires</span>
        <button className="mini-btn" onClick={() => addEmpire()}>
          + Add
        </button>
      </div>
      <div className="empire-list">
        {empires.length === 0 && (
          <div className="empty-hint">No empires yet. Generate a galaxy or add one.</div>
        )}
        {empires.map((e) => (
          <div
            key={e.id}
            className={`empire-row${activeEmpireId === e.id ? ' active' : ''}`}
            onClick={() => setActiveEmpire(e.id)}
          >
            <input
              type="color"
              title="Territory fill colour"
              value={e.color}
              onClick={(ev) => ev.stopPropagation()}
              onChange={(ev) => updateEmpire(e.id, { color: ev.target.value })}
            />
            <input
              type="color"
              className="border-swatch"
              title="Border colour (defaults to a lighter fill)"
              value={e.borderColor ?? lighten(e.color)}
              onClick={(ev) => ev.stopPropagation()}
              onChange={(ev) =>
                updateEmpire(e.id, { borderColor: ev.target.value })
              }
            />
            <input
              className="empire-name"
              value={e.name}
              onClick={(ev) => ev.stopPropagation()}
              onChange={(ev) => updateEmpire(e.id, { name: ev.target.value })}
            />
            <span className="empire-count">{counts.get(e.id) ?? 0}</span>
            <button
              className="mini-btn danger"
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
      </div>
      {activeEmpireId && (
        <div className="panel-note">
          Active empire is applied by the <b>Paint</b> tool and to new systems.
        </div>
      )}
    </div>
  );
}
