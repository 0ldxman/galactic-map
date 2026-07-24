import { useState } from 'react';
import { useEditor } from '../model/store';
import { liveCamera } from '../render/camera';
import { exportMapImage, ExportMode } from '../persistence/exportImage';
import {
  DEFAULT_LEGEND,
  LEGEND_SECTIONS,
  LegendCorner,
  LegendSection,
} from '../render/legend';

const MODES: { id: ExportMode; label: string; hint: string }[] = [
  { id: 'viewport', label: 'Current view', hint: 'Exactly what is on screen right now' },
  { id: 'galaxy', label: 'Whole galaxy', hint: 'Everything on the map, framed and rendered at full resolution' },
  { id: 'empire', label: 'One empire', hint: 'The chosen empire in colour, everyone else greyed out' },
];

const SIZES = [2048, 4096, 8192, 16384];

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const map = useEditor((s) => s.map);
  const activeEmpireId = useEditor((s) => s.activeEmpireId);

  const [mode, setMode] = useState<ExportMode>('galaxy');
  const [empireIds, setEmpireIds] = useState<string[]>(
    activeEmpireId ? [activeEmpireId] : []
  );
  const [maxSize, setMaxSize] = useState(4096);
  const [legend, setLegend] = useState(true);
  const [sections, setSections] = useState<LegendSection[]>([
    ...DEFAULT_LEGEND.sections,
  ]);
  const [legendEmpires, setLegendEmpires] = useState<string[]>([]);
  const [allEmpires, setAllEmpires] = useState(false);
  const [corner, setCorner] = useState<LegendCorner>('bl');
  const [legendScale, setLegendScale] = useState(1);
  const [legendBg, setLegendBg] = useState(0.82);
  const [legendOpen, setLegendOpen] = useState(false);
  const [transparent, setTransparent] = useState(false);
  const [references, setReferences] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const empires = Object.values(map.empires);
  // Tracing images are scaffolding, so the option only appears if any exist.
  const hasRefs = Object.keys(map.references ?? {}).length > 0;
  // Fall back to the first empire so the mode is never a no-op, and keep the
  // list in map order rather than click order so the filename is stable.
  const picked = empires.filter((e) => empireIds.includes(e.id));
  const chosen = picked.length > 0 ? picked : empires.slice(0, 1);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const slug = (s: string) =>
        s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const name =
        mode === 'empire' && chosen.length > 0
          ? chosen.length === 1
            ? `galaxy-${slug(chosen[0].name) || 'empire'}.png`
            : `galaxy-${chosen.length}-empires.png`
          : mode === 'viewport'
            ? 'galaxy-view.png'
            : 'galaxy.png';
      await exportMapImage(map, liveCamera, {
        mode,
        empireIds: mode === 'empire' ? chosen.map((e) => e.id) : undefined,
        maxSize,
        legend,
        transparent,
        references,
        legendOptions: {
          sections,
          empireIds: legendEmpires,
          allEmpires,
          corner,
          scale: legendScale,
          background: legendBg,
          title: title.trim() || undefined,
        },
        filename: name,
      });
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Export image</h2>

        <div className="field">
          <span>What to export</span>
          {MODES.map((m) => (
            <label className="radio-row" key={m.id} title={m.hint}>
              <input
                type="radio"
                checked={mode === m.id}
                onChange={() => setMode(m.id)}
              />
              <span>
                <b>{m.label}</b>
                <em>{m.hint}</em>
              </span>
            </label>
          ))}
        </div>

        {mode === 'empire' && (
          <div className="field">
            <span>
              Empires in colour ({chosen.length} of {empires.length})
            </span>
            {/* A checklist, because the interesting exports are rarely one
                empire: an alliance, or the two sides of a war, in their own
                colours against a grey galaxy. */}
            <div className="pick-list">
              {empires.map((e) => {
                const on = chosen.some((c) => c.id === e.id);
                return (
                  <label className="pick-row" key={e.id}>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() =>
                        setEmpireIds((prev) =>
                          prev.includes(e.id)
                            ? prev.filter((x) => x !== e.id)
                            : [...prev, e.id]
                        )
                      }
                    />
                    <span className="peer-dot" style={{ background: e.color }} />
                    <span className="pick-name">{e.name}</span>
                  </label>
                );
              })}
            </div>
            <div className="btn-row">
              <button
                className="mini-btn"
                onClick={() => setEmpireIds(empires.map((e) => e.id))}
              >
                All
              </button>
              <button className="mini-btn" onClick={() => setEmpireIds([])}>
                None
              </button>
            </div>
            <div className="panel-note">
              Everyone else is drawn in neutral grey. The shot is framed around
              the chosen empires.
            </div>
          </div>
        )}

        <label className="field">
          <span>Resolution (longest side)</span>
          <select value={maxSize} onChange={(e) => setMaxSize(Number(e.target.value))}>
            {SIZES.map((s) => (
              <option key={s} value={s}>
                {s} px
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Title (optional, drawn on the legend)</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>

        <label className="toggle-row">
          <input
            type="checkbox"
            checked={legend}
            onChange={(e) => setLegend(e.target.checked)}
          />
          <span>Draw a legend</span>
          {legend && (
            <button
              className="mini-btn"
              onClick={(e) => {
                e.preventDefault();
                setLegendOpen((v) => !v);
              }}
            >
              {legendOpen ? 'Hide' : 'Customise…'}
            </button>
          )}
        </label>

        {legend && legendOpen && (
          <div className="tab-section" style={{ marginBottom: 10 }}>
            <div className="field">
              <span>What it lists</span>
              <div className="pick-list">
                {LEGEND_SECTIONS.map((sec) => (
                  <label className="pick-row" key={sec.id}>
                    <input
                      type="checkbox"
                      checked={sections.includes(sec.id)}
                      onChange={() =>
                        setSections((prev) =>
                          prev.includes(sec.id)
                            ? prev.filter((x) => x !== sec.id)
                            : // Keep the canonical order rather than click
                              // order, so the panel never reshuffles itself.
                              LEGEND_SECTIONS.filter(
                                (s2) => s2.id === sec.id || prev.includes(s2.id)
                              ).map((s2) => s2.id)
                        )
                      }
                    />
                    <span className="pick-name">{sec.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {sections.includes('empires') && (
              <div className="field">
                <span>
                  Which empires{' '}
                  {legendEmpires.length === 0 && '(all that are in the shot)'}
                </span>
                <div className="pick-list">
                  {empires.map((e) => (
                    <label className="pick-row" key={e.id}>
                      <input
                        type="checkbox"
                        checked={legendEmpires.includes(e.id)}
                        onChange={() =>
                          setLegendEmpires((prev) =>
                            prev.includes(e.id)
                              ? prev.filter((x) => x !== e.id)
                              : [...prev, e.id]
                          )
                        }
                      />
                      <span className="peer-dot" style={{ background: e.color }} />
                      <span className="pick-name">{e.name}</span>
                    </label>
                  ))}
                </div>
                <div className="btn-row">
                  <button
                    className="mini-btn"
                    onClick={() => setLegendEmpires([])}
                  >
                    Clear (auto)
                  </button>
                </div>
                <label className="toggle-row">
                  <input
                    type="checkbox"
                    checked={allEmpires}
                    onChange={(e) => setAllEmpires(e.target.checked)}
                  />
                  <span>Include empires outside the frame</span>
                </label>
              </div>
            )}

            <label className="field">
              <span>Corner</span>
              <select
                value={corner}
                onChange={(e) => setCorner(e.target.value as LegendCorner)}
              >
                <option value="bl">Bottom left</option>
                <option value="br">Bottom right</option>
                <option value="tl">Top left</option>
                <option value="tr">Top right</option>
              </select>
            </label>
            <label className="field">
              <span>Panel size: {legendScale.toFixed(2)}×</span>
              <input
                type="range"
                min={0.5}
                max={2.5}
                step={0.05}
                value={legendScale}
                onChange={(e) => setLegendScale(Number(e.target.value))}
              />
            </label>
            <label className="field">
              <span>
                Backdrop:{' '}
                {legendBg === 0 ? 'none' : legendBg.toFixed(2)}
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={legendBg}
                onChange={(e) => setLegendBg(Number(e.target.value))}
              />
            </label>
          </div>
        )}
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={transparent}
            onChange={(e) => setTransparent(e.target.checked)}
          />
          <span>Transparent background</span>
        </label>
        {hasRefs && (
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={references}
              onChange={(e) => setReferences(e.target.checked)}
            />
            <span>Include reference images marked for export</span>
          </label>
        )}

        {error && <div className="error-note">{error}</div>}

        <div className="modal-actions">
          <button className="mini-btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="mini-btn" onClick={run} disabled={busy}>
            {busy ? 'Rendering…' : 'Export PNG'}
          </button>
        </div>
      </div>
    </div>
  );
}
