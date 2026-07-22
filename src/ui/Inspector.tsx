import { useEditor } from '../model/store';
import {
  StarType,
  StarBody,
  STAR_COLORS,
  System,
  OwnStatus,
} from '../model/types';
import { MARKER_TYPES } from '../model/markers';
import { STATUS_TYPES } from '../model/status';
import { STAR_SIZES, normalizeStars, makeStarBody } from '../model/stars';
import { EntityInspector } from './EntityInspector';
import { Notes } from './Notes';
import { lighten } from '../util/color';
import { ColorSwatch } from './ColorSwatch';

const BODY_TYPES: StarType[] = ['yellow', 'red', 'blue', 'white', 'neutron'];

export function Inspector() {
  const map = useEditor((s) => s.map);
  const selection = useEditor((s) => s.selection);
  const selectedEntity = useEditor((s) => s.selectedEntity);
  const activeEmpireId = useEditor((s) => s.activeEmpireId);
  const updateSystem = useEditor((s) => s.updateSystem);
  const updateSystems = useEditor((s) => s.updateSystems);
  const setOwner = useEditor((s) => s.setOwner);
  const setOwnerMany = useEditor((s) => s.setOwnerMany);
  const removeSystem = useEditor((s) => s.removeSystem);
  const removeSystems = useEditor((s) => s.removeSystems);
  const updateEmpire = useEditor((s) => s.updateEmpire);
  const addEmpire = useEditor((s) => s.addEmpire);
  const toggleMarkerMany = useEditor((s) => s.toggleMarkerMany);

  if (selectedEntity && map[selectedEntity.c][selectedEntity.id]) {
    return <EntityInspector entity={selectedEntity} />;
  }

  const picked = selection
    .map((id) => map.systems[id])
    .filter(Boolean) as System[];

  // Nothing selected: show the active empire instead of an empty panel. It is
  // the one thing you always have "in hand", and its lore has to live
  // somewhere now that the empire list is a bare list in the Outliner.
  if (picked.length === 0) {
    const emp = activeEmpireId ? map.empires[activeEmpireId] : null;
    if (!emp) {
      return (
        <div className="panel">
          <div className="panel-header">
            <span>Nothing selected</span>
          </div>
          <div className="empty-hint">
            Click a system, or drag a box over empty space to select several.
          </div>
          <button className="mini-btn" onClick={() => addEmpire()}>
            + Add an empire
          </button>
        </div>
      );
    }
    return (
      <div className="panel">
        <div className="panel-header">
          <span>Active empire</span>
        </div>
        <label className="field">
          <span>Name</span>
          <input
            value={emp.name}
            onChange={(e) => updateEmpire(emp.id, { name: e.target.value })}
          />
        </label>
        <div className="btn-row">
          <div className="opt">
            <span>Fill</span>
            <ColorSwatch
              value={emp.color}
              onChange={(hex) => updateEmpire(emp.id, { color: hex })}
            />
          </div>
          <div className="opt">
            <span>Border</span>
            <ColorSwatch
              value={emp.borderColor ?? lighten(emp.color)}
              onChange={(hex) => updateEmpire(emp.id, { borderColor: hex })}
            />
          </div>
          {emp.borderColor && (
            <button
              className="mini-btn"
              title="Derive the border from the fill again"
              onClick={() => updateEmpire(emp.id, { borderColor: undefined })}
            >
              Auto
            </button>
          )}
        </div>
        <div className="kv" style={{ marginTop: 6 }}>
          <span>Systems</span>
          <b>
            {Object.values(map.systems).filter((s) => s.ownerId === emp.id).length}
          </b>
        </div>
        <div className="kv">
          <span>Capital</span>
          <b>{emp.capitalId ? map.systems[emp.capitalId]?.name ?? '—' : '—'}</b>
        </div>
        <Notes
          value={emp.notes}
          onChange={(v) => updateEmpire(emp.id, { notes: v })}
          label="Lore"
        />
        <div className="btn-row" style={{ marginTop: 8 }}>
          <button className="mini-btn" onClick={() => addEmpire()}>
            + Add an empire
          </button>
        </div>
        <div className="panel-note">
          Pick a different empire in Outliner ▸ Empires, or from the strip above
          the map. Click a system to edit it here.
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
          <span>Hold status (applies to all)</span>
          <select
            value={
              new Set(picked.map((s) => s.status ?? 'core')).size === 1
                ? picked[0].status ?? 'core'
                : '__mixed__'
            }
            onChange={(e) =>
              updateSystems(ids, { status: e.target.value as OwnStatus })
            }
          >
            {new Set(picked.map((s) => s.status ?? 'core')).size > 1 && (
              <option value="__mixed__">— Mixed —</option>
            )}
            {STATUS_TYPES.map((st) => (
              <option key={st.id} value={st.id}>
                {st.label}
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
        <span>Hold status</span>
        <select
          value={sys.status ?? 'core'}
          onChange={(e) =>
            updateSystem(sys.id, { status: e.target.value as OwnStatus })
          }
        >
          {STATUS_TYPES.map((st) => (
            <option key={st.id} value={st.id}>
              {st.label}
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

      <Notes
        value={sys.notes}
        onChange={(v) => updateSystem(sys.id, { notes: v })}
      />

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
