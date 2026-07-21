import { useState } from 'react';
import { useEditor } from '../model/store';
import { DisplaySettings, resolveDisplay, DEFAULT_DISPLAY } from '../model/display';

const TOGGLES: { key: keyof DisplaySettings; label: string }[] = [
  { key: 'showTerritories', label: 'Territories' },
  { key: 'showHyperlanes', label: 'Hyperlanes' },
  { key: 'showEmpireNames', label: 'Empire names' },
  { key: 'showSystemNames', label: 'System names' },
  { key: 'showMarkers', label: 'Markers' },
  { key: 'showNebulae', label: 'Nebulae' },
  { key: 'showRegions', label: 'Region names' },
  { key: 'showObjects', label: 'Objects' },
  { key: 'showAnnotations', label: 'Annotations' },
  { key: 'showGrid', label: 'Grid' },
  { key: 'showStarGlow', label: 'Star glow' },
  { key: 'showBgStars', label: 'Background stars' },
  { key: 'showVignette', label: 'Vignette' },
];

export function DisplayPanel() {
  // Select the raw value and resolve outside the selector — resolving inside
  // would return a fresh object every store update and re-render constantly.
  const raw = useEditor((s) => s.map.display);
  const display = resolveDisplay(raw);
  const setDisplay = useEditor((s) => s.setDisplay);
  const [open, setOpen] = useState(false);

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
    <div className="panel">
      <div className="panel-header">
        <span>Display</span>
        <button className="mini-btn" onClick={() => setOpen(!open)}>
          {open ? 'Hide' : 'Show'}
        </button>
      </div>
      {open && (
        <>
          <div className="toggle-grid">
            {TOGGLES.map((t) => (
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
          {slider('borderWidth', 'Border width', 0.5, 6, 0.5, 1)}
          {slider('borderAlpha', 'Border opacity', 0, 1, 0.05)}
          {slider('fillAlpha', 'Fill opacity', 0, 0.6, 0.01)}
          {slider('empireNameScale', 'Empire name size', 0.3, 3, 0.05)}
          {slider('systemNameZoom', 'System names from zoom', 0.2, 6, 0.1, 1)}
          <button
            className="mini-btn"
            onClick={() => setDisplay({ ...DEFAULT_DISPLAY })}
          >
            Reset to defaults
          </button>
          <div className="panel-note">
            These settings are saved with the map, so an exported or published
            map keeps the look you chose.
          </div>
        </>
      )}
    </div>
  );
}
