import { useEditor } from '../model/store';
import { StarType } from '../model/types';

const STAR_TYPES: StarType[] = ['yellow', 'red', 'blue', 'white', 'neutron', 'blackhole'];

export function Inspector() {
  const map = useEditor((s) => s.map);
  const selectedSystemId = useEditor((s) => s.selectedSystemId);
  const updateSystem = useEditor((s) => s.updateSystem);
  const setOwner = useEditor((s) => s.setOwner);
  const removeSystem = useEditor((s) => s.removeSystem);
  const updateEmpire = useEditor((s) => s.updateEmpire);

  const sys = selectedSystemId ? map.systems[selectedSystemId] : null;

  if (!sys) {
    return (
      <div className="panel">
        <div className="panel-header">
          <span>Inspector</span>
        </div>
        <div className="empty-hint">Select a system to edit its properties.</div>
      </div>
    );
  }

  const isCapital = sys.ownerId
    ? map.empires[sys.ownerId]?.capitalId === sys.id
    : false;

  return (
    <div className="panel">
      <div className="panel-header">
        <span>System</span>
        <button className="mini-btn danger" onClick={() => removeSystem(sys.id)}>
          Delete
        </button>
      </div>
      <label className="field">
        <span>Name</span>
        <input
          value={sys.name}
          onChange={(e) => updateSystem(sys.id, { name: e.target.value })}
        />
      </label>
      <label className="field">
        <span>Star type</span>
        <select
          value={sys.starType}
          onChange={(e) =>
            updateSystem(sys.id, { starType: e.target.value as StarType })
          }
        >
          {STAR_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Owner</span>
        <select
          value={sys.ownerId ?? ''}
          onChange={(e) => setOwner(sys.id, e.target.value || null)}
        >
          <option value="">— Neutral —</option>
          {Object.values(map.empires).map((emp) => (
            <option key={emp.id} value={emp.id}>
              {emp.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Influence: {Math.round(sys.influence)}</span>
        <input
          type="range"
          min={10}
          max={120}
          value={sys.influence}
          onChange={(e) =>
            updateSystem(sys.id, { influence: Number(e.target.value) })
          }
        />
      </label>
      {sys.ownerId && (
        <button
          className="mini-btn"
          disabled={isCapital}
          onClick={() => updateEmpire(sys.ownerId!, { capitalId: sys.id })}
        >
          {isCapital ? '★ Capital' : 'Set as capital'}
        </button>
      )}
    </div>
  );
}
