import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../model/store';
import { MapCanvas } from './MapCanvas';
import { Toolbar } from './Toolbar';
import { EmpirePanel } from './EmpirePanel';
import { Inspector } from './Inspector';
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
    const saved = loadAutosave();
    if (saved) {
      setMap(saved);
    } else {
      setMap(
        generateGalaxy({
          seed: 42,
          shape: 'spiral',
          systemCount: 300,
          empireCount: 6,
          arms: 3,
        })
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
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const st = useEditor.getState();
      switch (e.key.toLowerCase()) {
        case 'v': st.setTool('select'); break;
        case 'a': st.setTool('add-system'); break;
        case 'l': st.setTool('connect'); break;
        case 'b': st.setTool('paint'); break;
        case 'e': st.setTool('delete'); break;
        case 'g': setShowGenerate(true); break;
        case 'escape':
          st.setConnectFrom(null);
          st.selectSystem(null);
          break;
        case 'delete':
        case 'backspace':
          if (st.selectedSystemId) {
            e.preventDefault();
            st.removeSystem(st.selectedSystemId);
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
        <div className="help-box">
          <b>Shortcuts</b>
          <ul>
            <li><b>V</b> Select · <b>A</b> Add · <b>L</b> Link</li>
            <li><b>B</b> Paint · <b>E</b> Erase · <b>G</b> Generate</li>
            <li><b>Del</b> remove selected · <b>Esc</b> cancel</li>
            <li>Drag empty space / middle-drag — pan</li>
            <li>Wheel — zoom · Erase clicks systems <i>or</i> links</li>
          </ul>
        </div>
      </aside>
      {showGenerate && <GenerateDialog onClose={() => setShowGenerate(false)} />}
    </div>
  );
}
