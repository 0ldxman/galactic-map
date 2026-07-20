import { useRef } from 'react';
import { useEditor, Tool } from '../model/store';
import { exportToFile, importFromFile } from '../persistence/io';

const TOOLS: { id: Tool; label: string; icon: string; hint: string }[] = [
  { id: 'select', label: 'Select', icon: '↖', hint: 'Select & move systems / pan' },
  { id: 'add-system', label: 'Add', icon: '✦', hint: 'Add a star system' },
  { id: 'connect', label: 'Link', icon: '―', hint: 'Toggle a hyperlane between two systems' },
  { id: 'paint', label: 'Paint', icon: '◉', hint: 'Assign systems to the active empire' },
  { id: 'delete', label: 'Delete', icon: '✕', hint: 'Delete a system' },
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
      <div className="toolbar-title">Galactic Map</div>
      <div className="tool-group">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={`tool-btn${tool === t.id ? ' active' : ''}`}
            title={t.hint}
            onClick={() => setTool(t.id)}
          >
            <span className="tool-icon">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>
      <div className="toolbar-spacer" />
      <div className="tool-group">
        <button className="tool-btn primary" onClick={onOpenGenerate}>
          Generate
        </button>
        <button className="tool-btn" onClick={() => exportToFile(map)}>
          Export
        </button>
        <button className="tool-btn" onClick={() => fileRef.current?.click()}>
          Import
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
