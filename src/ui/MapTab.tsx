import { useEditor } from '../model/store';
import { DisplaySettings, resolveDisplay, DEFAULT_DISPLAY } from '../model/display';
import { exportToFile } from '../persistence/io';

const STYLE_TOGGLES: { key: keyof DisplaySettings; label: string }[] = [
  { key: 'showHyperlanes', label: 'Hyperlanes' },
  { key: 'showEmpireNames', label: 'Empire names' },
  { key: 'showSystemNames', label: 'System names' },
  { key: 'showMarkers', label: 'Markers' },
  { key: 'showGrid', label: 'Grid' },
  { key: 'showStarGlow', label: 'Star glow' },
  { key: 'showBgStars', label: 'Background stars' },
  { key: 'showVignette', label: 'Vignette' },
];

/** How the map looks, and what you can do with the whole document. */
export function MapTab({
  onOpenGenerate,
  onOpenExport,
}: {
  onOpenGenerate: () => void;
  onOpenExport: () => void;
}) {
  const map = useEditor((s) => s.map);
  const setDisplay = useEditor((s) => s.setDisplay);
  const display = resolveDisplay(map.display);

  const slider = (
    key: keyof DisplaySettings,
    label: string,
    min: number,
    max: number,
    step: number,
    digits = 2
  ) => (
    <label className="field" key={key}>
      <span>
        {label}: {(display[key] as number).toFixed(digits)}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={display[key] as number}
        onChange={(e) => setDisplay({ [key]: Number(e.target.value) })}
      />
    </label>
  );

  return (
    <>
      <div className="tab-section">
        <div className="tab-title">Contents</div>
        <div className="kv"><span>Systems</span><b>{Object.keys(map.systems).length}</b></div>
        <div className="kv"><span>Hyperlanes</span><b>{Object.keys(map.hyperlanes).length}</b></div>
        <div className="kv"><span>Empires</span><b>{Object.keys(map.empires).length}</b></div>
      </div>

      <div className="tab-section">
        <div className="tab-title">Borders &amp; labels</div>
        {slider('borderWidth', 'Border width', 0.5, 6, 0.5, 1)}
        {slider('borderAlpha', 'Border opacity', 0, 1, 0.05)}
        {slider('fillAlpha', 'Fill opacity', 0, 0.6, 0.01)}
        {slider('empireNameScale', 'Empire name size', 0.3, 3, 0.05)}
        {slider('systemNameZoom', 'System names from zoom', 0.2, 6, 0.1, 1)}
      </div>

      <div className="tab-section">
        <div className="tab-title">Style layers</div>
        <div className="toggle-grid">
          {STYLE_TOGGLES.map((t) => (
            <label className="toggle-row" key={t.key}>
              <input
                type="checkbox"
                checked={display[t.key] as boolean}
                onChange={(e) => setDisplay({ [t.key]: e.target.checked })}
              />
              <span>{t.label}</span>
            </label>
          ))}
        </div>
        <button
          className="mini-btn"
          style={{ marginTop: 6 }}
          onClick={() => setDisplay({ ...DEFAULT_DISPLAY })}
        >
          Reset the look
        </button>
        <div className="panel-note">
          Saved with the map, so an export or a published link keeps this look.
          Content layers are toggled in the Outliner.
        </div>
      </div>

      <div className="tab-section">
        <div className="tab-title">Document</div>
        <div className="btn-row">
          <button className="mini-btn" onClick={onOpenExport}>
            🖼 Export image…
          </button>
          <button className="mini-btn" onClick={() => exportToFile(map)}>
            ↧ Export JSON
          </button>
        </div>
        <button
          className="mini-btn"
          style={{ marginTop: 6 }}
          onClick={onOpenGenerate}
        >
          ✧ Regenerate this map…
        </button>
        <div className="panel-note">
          Regenerating replaces everything on this map — undoable with Ctrl+Z.
        </div>
      </div>
    </>
  );
}
