const GROUPS: { title: string; rows: [string, string][] }[] = [
  {
    title: 'Tools',
    rows: [
      ['V', 'Select and move'],
      ['A', 'Add a system'],
      ['L', 'Link — toggle a hyperlane'],
      ['B', 'Paint the active empire'],
      ['E', 'Erase'],
      ['N', 'Paint a nebula (Alt flips paint / erase)'],
      ['R', 'Assign systems to a sector (Alt removes)'],
      ['O', 'Place a special object'],
      ['T', 'Annotate — text, arrows, areas'],
    ],
  },
  {
    title: 'Navigation',
    rows: [
      ['Right- or middle-drag', 'Pan'],
      ['Wheel', 'Zoom toward the cursor'],
      ['Drag empty space', 'Box select'],
      ['Alt-drag empty space', 'Lasso select'],
      ['Two fingers', 'Pinch to zoom, drag to pan'],
      ['Shift + click', 'Add to the selection'],
      ['Ctrl + A', 'Select everything'],
      ['Esc', 'Clear the selection'],
    ],
  },
  {
    title: 'Editing',
    rows: [
      ['Ctrl + Z', 'Undo'],
      ['Ctrl + Shift + Z', 'Redo'],
      ['Ctrl + C / X / V', 'Copy · cut · paste'],
      ['Ctrl + D', 'Duplicate'],
      ['Del', 'Delete the selection'],
      ['Enter / Esc', 'Finish or cancel an area'],
      ['Drop / paste an image', 'Add it as a tracing reference'],
    ],
  },
  {
    title: 'Interface',
    rows: [
      ['Tab', 'Collapse the side panel'],
      ['?', 'This list'],
      ['G', 'Generate a galaxy'],
    ],
  },
];

export function HelpOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="help-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Shortcuts</h2>
        <div className="help-cols">
          {GROUPS.map((g) => (
            <div className="help-col" key={g.title}>
              <h3>{g.title}</h3>
              {g.rows.map(([k, what]) => (
                <div className="help-row" key={k}>
                  <kbd>{k}</kbd>
                  <span>{what}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="modal-actions">
          <button className="mini-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
