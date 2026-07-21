import { useEditor } from '../model/store';
import { StarType, StarBody, STAR_COLORS, System } from '../model/types';
import { MARKER_TYPES } from '../model/markers';
import { STAR_SIZES, normalizeStars, makeStarBody } from '../model/stars';

const BODY_TYPES: StarType[] = ['yellow', 'red', 'blue', 'white', 'neutron'];

export function Inspector() {
  const map = useEditor((s) => s.map);
  const selection = useEditor((s) => s.selection);
  const updateSystem = useEditor((s) => s.updateSystem);
  const updateSystems = useEditor((s) => s.updateSystems);
  const setOwner = useEditor((s) => s.setOwner);
  const setOwnerMany = useEditor((s) => s.setOwnerMany);
  const removeSystem = useEditor((s) => s.removeSystem);
  const removeSystems = useEditor((s) => s.removeSystems);
  const updateEmpire = useEditor((s) => s.updateEmpire);
  const toggleMarkerMany = useEditor((s) => s.toggleMarkerMany);

  const picked = selection
    .map((id) => map.systems[id])
    .filter(Boolean) as System[];

  if (picked.length === 0) {
    return (
      <div className="panel">
        <div className="panel-header">
          <span>Inspector</span>
        </div>
        <div className="empty-hint">
          Select a system to edit it. Drag a box over empty space to select many.
        </div>
      </div>
    );
  }

  // ---- Group editing -------------------------------------------------------
  if (picked.length > 1) {
    const ids = picked.map((s) => s.id);
    const owners = new Set(picked.map((s) => s.ownerId ?? ''));
    const ownerValue = owners.size === 1 ? [...owners][0] : '__mixed__';
    const infs = picked.map((s) => s.influence);
    const infMin = Math.round(Math.min(...infs));
    const infMax = Math.round(Math.max(...infs));

    return (
      <div className="panel">
        <div className="panel-header">
          <span>{picked.length} systems</span>
          <button className="mini-btn danger" onClick={() => removeSystems(ids)}>
            Delete all
          </button>
        </div>

        <label className="field">
          <span>Owner (applies to all)</span>
          <select
            value={ownerValue}
            onChange={(e) => setOwnerMany(ids, e.target.value || null)}
          >
            {ownerValue === '__mixed__' && (
              <option value="__mixed__">— Mixed —</option>
            )}
            <option value="">— Neutral —</option>
            {Object.values(map.empires).map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.name}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>
            Influence: {infMin === infMax ? infMin : `${infMin}–${infMax}`}
          </span>
          <input
            type="range"
            min={10}
            max={120}
            value={infMax}
            onChange={(e) =>
              updateSystems(ids, { influence: Number(e.target.value) })
            }
          />
        </label>

        <div className="field" style={{ marginTop: 4 }}>
          <span>Markers (applies to all)</span>
          <div className="marker-grid">
            {MARKER_TYPES.map((m) => {
              const on = picked.every((s) => (s.markers ?? []).includes(m.id));
              const some = picked.some((s) => (s.markers ?? []).includes(m.id));
              return (
                <button
                  key={m.id}
                  type="button"
                  className={`marker-chip${on ? ' active' : some ? ' partial' : ''}`}
                  title={m.label}
                  onClick={() => toggleMarkerMany(ids, m.id)}
                >
                  <span className="marker-glyph" style={{ color: m.color }}>
                    {m.glyph}
                  </span>
                  <span className="marker-label">{m.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ---- Single system -------------------------------------------------------
  const sys = picked[0];
  const isCapital = sys.ownerId
    ? map.empires[sys.ownerId]?.capitalId === sys.id
    : false;

  const bodies = normalizeStars(sys);
  const commitStars = (next: StarBody[]) =>
    updateSystem(sys.id, { stars: next, starType: next[0].type });
  const setStar = (i: number, patch: Partial<StarBody>) =>
    commitStars(bodies.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  const addStar = () => {
    if (bodies.length < 4) commitStars([...bodies, makeStarBody(Math.random)]);
  };
  const removeStar = (i: number) => {
    if (bodies.length > 1) commitStars(bodies.filter((_, idx) => idx !== i));
  };

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
      <div className="field">
        <span>Stars ({bodies.length}/4)</span>
        <div className="star-list">
          {bodies.map((b, i) => (
            <div className="star-row" key={i}>
              <span
                className="star-dot"
                style={{ background: STAR_COLORS[b.type] }}
              />
              <select
                value={b.type}
                onChange={(e) => setStar(i, { type: e.target.value as StarType })}
              >
                {BODY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <select
                value={b.size}
                onChange={(e) => setStar(i, { size: e.target.value })}
              >
                {STAR_SIZES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
              <button
                className="mini-btn danger"
                title="Remove star"
                disabled={bodies.length <= 1}
                onClick={() => removeStar(i)}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <button
          className="mini-btn"
          style={{ marginTop: 4 }}
          disabled={bodies.length >= 4}
          onClick={addStar}
        >
          + Add star
        </button>
      </div>
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

      <div className="field" style={{ marginTop: 4 }}>
        <span>Markers</span>
        <div className="marker-grid">
          {MARKER_TYPES.map((m) => {
            const on = (sys.markers ?? []).includes(m.id);
            return (
              <button
                key={m.id}
                type="button"
                className={`marker-chip${on ? ' active' : ''}`}
                title={m.label}
                onClick={() => toggleMarkerMany([sys.id], m.id)}
              >
                <span className="marker-glyph" style={{ color: m.color }}>
                  {m.glyph}
                </span>
                <span className="marker-label">{m.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
