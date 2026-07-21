import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../model/store';
import { MapCanvas } from './MapCanvas';
import { Toolbar } from './Toolbar';
import { EmpirePanel } from './EmpirePanel';
import { Inspector } from './Inspector';
import { DisplayPanel } from './DisplayPanel';
import { ToolOptions } from './ToolOptions';
import { GenerateDialog } from './GenerateDialog';
import { ExportDialog } from './ExportDialog';
import { CloudPanel } from './CloudPanel';
import { ViewerPanel } from './ViewerPanel';
import { generateGalaxy } from '../generation/generateGalaxy';
import { loadAutosave, saveAutosave } from '../persistence/io';
import { api, readViewerRoute } from '../net/api';
import { connectMap, useSync } from '../net/sync';

export function App() {
  const [showGenerate, setShowGenerate] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const setMap = useEditor((s) => s.setMap);
  const bootstrapped = useRef(false);
  // A `/v/<slug>` URL means this tab is a viewer for a published map.
  const viewerRoute = useRef(readViewerRoute()).current;
  const [viewerMeta, setViewerMeta] = useState<{ title: string; owner: string } | null>(
    null
  );
  const [viewerError, setViewerError] = useState<string | null>(null);

  // On first load: open the published map, restore the autosave, or generate
  // a starter galaxy.
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;

    if (viewerRoute) {
      // The REST call is only for the title and a decent error message; the
      // map itself arrives over the socket, which then keeps it up to date.
      api
        .publicMap(viewerRoute.slug, viewerRoute.token)
        .then((r) => setViewerMeta({ title: r.meta.title, owner: r.meta.owner }))
        .catch((e) => setViewerError((e as Error).message));
      connectMap({ slug: viewerRoute.slug, token: viewerRoute.token });
      return;
    }

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
  }, [setMap, viewerRoute]);

  // Debounced autosave of the local draft. A map opened from the server is
  // saved there instead, and must not overwrite whatever is in this browser.
  useEffect(() => {
    if (viewerRoute) return;
    let t: number | undefined;
    const unsub = useEditor.subscribe((s) => {
      if (useSync.getState().mapId) return;
      window.clearTimeout(t);
      const map = s.map;
      t = window.setTimeout(() => saveAutosave(map), 600);
    });
    return () => {
      window.clearTimeout(t);
      unsub();
    };
  }, [viewerRoute]);

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
        case 'n': st.setTool('nebula'); break;
        case 'r': st.setTool('region'); break;
        case 'o': st.setTool('object'); break;
        case 't': st.setTool('annotate'); break;
        case 'g': setShowGenerate(true); break;
        case 'escape':
          st.setConnectFrom(null);
          st.clearSelection();
          break;
        case 'delete':
        case 'backspace':
          if (st.selectedEntity) {
            e.preventDefault();
            st.removeEnt(st.selectedEntity.c, st.selectedEntity.id);
          } else if (st.selection.length > 0) {
            e.preventDefault();
            st.removeSystems(st.selection);
          }
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (viewerRoute) {
    return (
      <div className="app">
        <MapCanvas />
        <aside className="sidebar">
          {viewerError ? (
            <div className="panel">
              <div className="panel-header">
                <span>Cannot open this map</span>
              </div>
              <div className="error-note">{viewerError}</div>
            </div>
          ) : (
            <ViewerPanel
              title={viewerMeta?.title ?? 'Loading…'}
              owner={viewerMeta?.owner ?? '…'}
            />
          )}
        </aside>
      </div>
    );
  }

  return (
    <div className="app">
      <Toolbar
        onOpenGenerate={() => setShowGenerate(true)}
        onOpenExport={() => setShowExport(true)}
      />
      <MapCanvas />
      <aside className="sidebar">
        <CloudPanel />
        <ToolOptions />
        <EmpirePanel />
        <Inspector />
        <DisplayPanel />
        <div className="help-box">
          <b>Shortcuts</b>
          <ul>
            <li><b>V</b> Select · <b>A</b> Add · <b>L</b> Link</li>
            <li><b>B</b> Paint · <b>E</b> Erase · <b>G</b> Generate</li>
            <li><b>N</b> Nebula · <b>R</b> Region · <b>O</b> Object · <b>T</b> Note</li>
            <li><b>Ctrl+Z</b> undo · <b>Ctrl+Shift+Z</b> redo</li>
            <li><b>Ctrl+C/X/V</b> copy · <b>Ctrl+D</b> duplicate</li>
            <li><b>Ctrl+A</b> select all · <b>Del</b> remove selected</li>
            <li>Drag empty space — box select (<b>Shift</b> adds)</li>
            <li>Right- or middle-drag — pan · Wheel — zoom</li>
          </ul>
        </div>
      </aside>
      {showGenerate && <GenerateDialog onClose={() => setShowGenerate(false)} />}
      {showExport && <ExportDialog onClose={() => setShowExport(false)} />}
    </div>
  );
}
