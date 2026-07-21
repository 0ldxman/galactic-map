import { useState } from 'react';
import { useEditor } from '../model/store';
import { generateGalaxy } from '../generation/generateGalaxy';
import { GalaxyShape } from '../generation/shapes';
import { GalaxyMap } from '../model/types';

const SHAPES: GalaxyShape[] = ['spiral', 'elliptical', 'ring'];

export function GenerateDialog({
  onClose,
  onGenerated,
}: {
  onClose: () => void;
  /**
   * When given, the dialog hands the fresh galaxy over instead of replacing the
   * open map — that's how the dashboard turns "Generate" into a new saved map.
   */
  onGenerated?: (map: GalaxyMap, title: string) => void;
}) {
  const setMap = useEditor((s) => s.setMap);
  const [shape, setShape] = useState<GalaxyShape>('spiral');
  const [systemCount, setSystemCount] = useState(300);
  const [empireCount, setEmpireCount] = useState(6);
  const [arms, setArms] = useState(3);
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e9));
  const [title, setTitle] = useState('');

  const generate = () => {
    const map = generateGalaxy({ seed, shape, systemCount, empireCount, arms });
    if (onGenerated) {
      onGenerated(map, title.trim() || `${shape} galaxy`);
      return;
    }
    setMap(map);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Generate Galaxy</h2>

        {onGenerated && (
          <label className="field">
            <span>Name</span>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Untitled galaxy"
            />
          </label>
        )}

        <label className="field">
          <span>Shape</span>
          <select value={shape} onChange={(e) => setShape(e.target.value as GalaxyShape)}>
            {SHAPES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>

        {shape === 'spiral' && (
          <label className="field">
            <span>Spiral arms: {arms}</span>
            <input
              type="range"
              min={2}
              max={6}
              value={arms}
              onChange={(e) => setArms(Number(e.target.value))}
            />
          </label>
        )}

        <label className="field">
          <span>Systems: {systemCount}</span>
          <input
            type="range"
            min={40}
            max={2000}
            step={10}
            value={systemCount}
            onChange={(e) => setSystemCount(Number(e.target.value))}
          />
        </label>

        <label className="field">
          <span>Empires: {empireCount}</span>
          <input
            type="range"
            min={0}
            max={16}
            value={empireCount}
            onChange={(e) => setEmpireCount(Number(e.target.value))}
          />
        </label>

        <label className="field">
          <span>Seed</span>
          <div className="seed-row">
            <input
              type="number"
              value={seed}
              onChange={(e) => setSeed(Number(e.target.value))}
            />
            <button
              className="mini-btn"
              onClick={() => setSeed(Math.floor(Math.random() * 1e9))}
            >
              🎲
            </button>
          </div>
        </label>

        <div className="modal-actions">
          <button className="tool-btn" onClick={onClose}>Cancel</button>
          <button className="tool-btn primary" onClick={generate}>Generate</button>
        </div>
      </div>
    </div>
  );
}
