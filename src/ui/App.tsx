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

  return (
    <div className="app">
      <Toolbar onOpenGenerate={() => setShowGenerate(true)} />
      <div className="workspace">
        <MapCanvas />
        <aside className="sidebar">
          <EmpirePanel />
          <Inspector />
          <div className="help-box">
            <b>Controls</b>
            <ul>
              <li>Drag empty space / middle-drag — pan</li>
              <li>Wheel — zoom</li>
              <li>Select tool — click & drag a system to move</li>
              <li>Link tool — click two systems</li>
              <li>Paint tool — apply active empire</li>
            </ul>
          </div>
        </aside>
      </div>
      {showGenerate && <GenerateDialog onClose={() => setShowGenerate(false)} />}
    </div>
  );
}
