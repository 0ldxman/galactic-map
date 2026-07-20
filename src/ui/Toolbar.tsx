import { useRef } from 'react';
import { useEditor, Tool } from '../model/store';
import { exportToFile, importFromFile } from '../persistence/io';

const TOOLS: { id: Tool; label: string; icon: string; key: string; hint: string }[] = [
  { id: 'select', label: 'Select', icon: '↖', key: 'V', hint: 'Select & move systems / pan' },
  { id: 'add-system', label: 'Add', icon: '✦', key: 'A', hint: 'Add a star system' },
  { id: 'connect', label: 'Link', icon: '⇄', key: 'L', hint: 'Toggle a hyperlane between two systems' },
  { id: 'paint', label: 'Paint', icon: '◉', key: 'B', hint: 'Assign systems to the active empire' },
  { id: 'delete', label: 'Erase', icon: '✕', key: 'E', hint: 'Delete a system or hyperlane' },
];

export function Toolbar({ onOpenGenerate }: { onOpenGenerate: () => void }) {
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  const map = useEditor((s) => s.map);
  const setMap = useEditor((s) => s.setMap);
  const fileRef = useRef<HTMLInputElement>(null);

  const onImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const m = await importFromFile(file);
      setMap(m);
    } catch (err) {
      alert(`Import failed: ${(err as Error).message}`);
    }
    e.target.value = '';
  };

  return (
    <div className="toolbar">
      <div className="toolbar-logo" title="Galactic Map">✷</div>

      <div className="tool-group">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={`tool-btn${tool === t.id ? ' active' : ''}`}
            title={`${t.hint}  (${t.key})`}
            onClick={() => setTool(t.id)}
          >
            <span className="tool-icon">{t.icon}</span>
            <span className="tool-key">{t.key}</span>
          </button>
        ))}
      </div>

      <div className="toolbar-spacer" />

      <div className="tool-group">
        <button
          className="tool-btn primary"
          title="Generate a new galaxy  (G)"
          onClick={onOpenGenerate}
        >
          <span className="tool-icon">✧</span>
          <span className="tool-key">Gen</span>
        </button>
        <button
          className="tool-btn"
          title="Export map as JSON"
          onClick={() => exportToFile(map)}
        >
          <span className="tool-icon">↧</span>
          <span className="tool-key">Exp</span>
        </button>
        <button
          className="tool-btn"
          title="Import map from JSON"
          onClick={() => fileRef.current?.click()}
        >
          <span className="tool-icon">↥</span>
          <span className="tool-key">Imp</span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={onImport}
        />
      </div>
    </div>
  );
}
