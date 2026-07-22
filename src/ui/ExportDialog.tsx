import { useState } from 'react';
import { useEditor } from '../model/store';
import { liveCamera } from '../render/camera';
import { exportMapImage, ExportMode } from '../persistence/exportImage';

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
  const [empireId, setEmpireId] = useState(activeEmpireId ?? '');
  const [maxSize, setMaxSize] = useState(4096);
  const [legend, setLegend] = useState(true);
  const [transparent, setTransparent] = useState(false);
  const [references, setReferences] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const empires = Object.values(map.empires);
  // Tracing images are scaffolding, so the option only appears if any exist.
  const hasRefs = Object.keys(map.references ?? {}).length > 0;
  const chosen = empires.find((e) => e.id === empireId) ?? empires[0] ?? null;

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const slug = (s: string) =>
        s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const name =
        mode === 'empire' && chosen
          ? `galaxy-${slug(chosen.name) || 'empire'}.png`
          : mode === 'viewport'
            ? 'galaxy-view.png'
            : 'galaxy.png';
      await exportMapImage(map, liveCamera, {
        mode,
        empireId: mode === 'empire' ? chosen?.id ?? null : null,
        maxSize,
        legend,
        transparent,
        references,
        title: title.trim() || undefined,
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
          <label className="field">
            <span>Empire</span>
            <select
              value={chosen?.id ?? ''}
              onChange={(e) => setEmpireId(e.target.value)}
            >
              {empires.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>
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
          <span>Draw a legend of what is visible</span>
        </label>
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
