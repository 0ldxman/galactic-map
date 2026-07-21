import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../model/store';
import { MapCanvas } from './MapCanvas';
import { Toolbar } from './Toolbar';
import { EmpirePanel } from './EmpirePanel';
import { Inspector } from './Inspector';
import { DisplayPanel } from './DisplayPanel';
import { GenerateDialog } from './GenerateDialog';
import { generateGalaxy } from '../generation/generateGalaxy';
import { loadAutosave, saveAutosave } from '../persistence/io';

export function App() {
  const [showGenerate, setShowGenerate] = useState(false);
  const setMap = useEditor((s) => s.setMap);
  const bootstrapped = useRef(false);

  // On first load: restore autosave, else generate a starter galaxy.
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    // `true` clears the undo history: this is opening a document, not an edit.
    const saved = loadAutosave();
    if (saved) {
      setMap(saved, true);
    } else {
      setMap(
        generateGalaxy({
          seed: 42,
          shape: 'spiral',
          systemCount: 300,
          empireCount: 6,
          arms: 3,
        }),
        true
      );
    }
  }, [setMap]);

  // Debounced autosave on every mutation.
  useEffect(() => {
    let t: number | undefined;
    const unsub = useEditor.subscribe((s) => {
      window.clearTimeout(t);
      const map = s.map;
      t = window.setTimeout(() => saveAutosave(map), 600);
    });
    return () => {
      window.clearTimeout(t);
      unsub();
    };
  }, []);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'SELECT' ||
          el.tagName === 'TEXTAREA' ||
          el.isContentEditable)
      )
        return;
      const st = useEditor.getState();
      const key = e.key.toLowerCase();

      // Ctrl/Cmd combos first — copy/paste live in MapCanvas (it owns the
      // cursor position needed to place a paste).
      if (e.ctrlKey || e.metaKey) {
        if (key === 'z') {
          e.preventDefault();
          if (e.shiftKey) st.redo();
          else st.undo();
        } else if (key === 'y') {
          e.preventDefault();
          st.redo();
        } else if (key === 'a') {
          e.preventDefault();
          st.selectAll();
        }
        return;
      }
      if (e.altKey) return;

      switch (key) {
        case 'v': st.setTool('select'); break;
        case 'a': st.setTool('add-system'); break;
        case 'l': st.setTool('connect'); break;
        case 'b': st.setTool('paint'); break;
        case 'e': st.setTool('delete'); break;
        case 'g': setShowGenerate(true); break;
        case 'escape':
          st.setConnectFrom(null);
          st.clearSelection();
          break;
        case 'delete':
        case 'backspace':
          if (st.selection.length > 0) {
            e.preventDefault();
            st.removeSystems(st.selection);
          }
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app">
      <Toolbar onOpenGenerate={() => setShowGenerate(true)} />
      <MapCanvas />
      <aside className="sidebar">
        <EmpirePanel />
        <Inspector />
        <DisplayPanel />
        <div className="help-box">
          <b>Shortcuts</b>
          <ul>
            <li><b>V</b> Select · <b>A</b> Add · <b>L</b> Link</li>
            <li><b>B</b> Paint · <b>E</b> Erase · <b>G</b> Generate</li>
            <li><b>Ctrl+Z</b> undo · <b>Ctrl+Shift+Z</b> redo</li>
            <li><b>Ctrl+C/X/V</b> copy · <b>Ctrl+D</b> duplicate</li>
            <li><b>Ctrl+A</b> select all · <b>Del</b> remove selected</li>
            <li>Drag empty space — box select (<b>Shift</b> adds)</li>
            <li>Right- or middle-drag — pan · Wheel — zoom</li>
          </ul>
        </div>
      </aside>
      {showGenerate && <GenerateDialog onClose={() => setShowGenerate(false)} />}
    </div>
  );
}
