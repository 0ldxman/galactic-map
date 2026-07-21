import { useEditor, Tool } from '../model/store';

const TOOLS: { id: Tool; label: string; icon: string; key: string; hint: string }[] = [
  { id: 'select', label: 'Select', icon: '↖', key: 'V', hint: 'Select & move systems / pan' },
  { id: 'add-system', label: 'Add', icon: '✦', key: 'A', hint: 'Add a star system' },
  { id: 'connect', label: 'Link', icon: '⇄', key: 'L', hint: 'Toggle a hyperlane between two systems' },
  { id: 'paint', label: 'Paint', icon: '◉', key: 'B', hint: 'Assign systems to the active empire' },
  { id: 'delete', label: 'Erase', icon: '✕', key: 'E', hint: 'Delete a system, object, annotation or hyperlane' },
  { id: 'nebula', label: 'Nebula', icon: '☁', key: 'N', hint: 'Paint a nebula (Alt-drag erases)' },
  { id: 'region', label: 'Region', icon: '◍', key: 'R', hint: 'Place a named region / sector label' },
  { id: 'object', label: 'Object', icon: '⬡', key: 'O', hint: 'Place a special object (wormhole, gate, debris…)' },
  { id: 'annotate', label: 'Note', icon: '✎', key: 'T', hint: 'Draw text, arrows, lines and areas' },
];

export function Toolbar() {
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);

  return (
    <div className="toolbar">
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

      <div className="tool-group" style={{ marginTop: 8 }}>
        <button
          className="tool-btn"
          title="Undo  (Ctrl+Z)"
          disabled={!canUndo}
          onClick={undo}
        >
          <span className="tool-icon">↶</span>
          <span className="tool-key">Undo</span>
        </button>
        <button
          className="tool-btn"
          title="Redo  (Ctrl+Shift+Z)"
          disabled={!canRedo}
          onClick={redo}
        >
          <span className="tool-icon">↷</span>
          <span className="tool-key">Redo</span>
        </button>
      </div>

      <div className="toolbar-spacer" />
    </div>
  );
}
