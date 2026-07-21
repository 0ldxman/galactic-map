import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor } from '../model/store';
import { useSync, connectMap, disconnect } from '../net/sync';
import { api, RemoteMap } from '../net/api';
import { navigate, paths } from './routes';
import { MapCanvas } from './MapCanvas';
import { Toolbar } from './Toolbar';
import { ToolOptionsBar } from './ToolOptionsBar';
import { Inspector } from './Inspector';
import { OutlinerTab } from './OutlinerTab';
import { MapTab } from './MapTab';
import { HelpOverlay } from './HelpOverlay';
import { GenerateDialog } from './GenerateDialog';
import { ExportDialog } from './ExportDialog';
import { loadAutosave, saveAutosave } from '../persistence/io';
import { generateGalaxy } from '../generation/generateGalaxy';

type Tab = 'properties' | 'outliner' | 'map';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'properties', label: 'Properties', icon: '⚙' },
  { id: 'outliner', label: 'Outliner', icon: '☰' },
  { id: 'map', label: 'Map', icon: '◍' },
];

const WIDTH_KEY = 'galactic-map:sidebar-width';

/** The editor proper: a server map when `mapId` is given, a local draft if not. */
export function EditorPage({ mapId }: { mapId: string | null }) {
  const [tab, setTab] = useState<Tab>('properties');
  const [showGenerate, setShowGenerate] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [meta, setMeta] = useState<RemoteMap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [width, setWidth] = useState(
    () => Number(localStorage.getItem(WIDTH_KEY)) || 320
  );
  const [collapsed, setCollapsed] = useState(false);
  const setMap = useEditor((s) => s.setMap);
  const readOnly = useEditor((s) => s.readOnly);
  const status = useSync((s) => s.status);
  const peers = useSync((s) => s.peers);
  const booted = useRef(false);

  // --- open the document ---------------------------------------------------
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;

    if (mapId) {
      api
        .listMaps()
        .then((r) => setMeta(r.maps.find((m) => m.id === mapId) ?? null))
        .catch(() => {});
      // The socket delivers the map itself and keeps it in sync from there.
      connectMap({ mapId });
      return;
    }

    const saved = loadAutosave();
    setMap(
      saved ??
        generateGalaxy({
          seed: 42,
          shape: 'spiral',
          systemCount: 300,
          empireCount: 6,
          arms: 3,
        }),
      true
    );
  }, [mapId, setMap]);

  useEffect(() => () => disconnect(), []);

  // A local draft is kept in this browser; a server map saves itself remotely.
  useEffect(() => {
    if (mapId) return;
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
  }, [mapId]);

  // --- resizing ------------------------------------------------------------
  const startResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const move = (ev: PointerEvent) => {
      const next = Math.min(520, Math.max(240, window.innerWidth - ev.clientX));
      setWidth(next);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setWidth((w) => {
        localStorage.setItem(WIDTH_KEY, String(w));
        return w;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, []);

  // --- keyboard ------------------------------------------------------------
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

      if (e.key === '?') {
        setShowHelp((v) => !v);
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        setCollapsed((v) => !v);
        return;
      }

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
        case 'f': {
          // Frame the selection.
          const ids = st.selection;
          if (ids.length) {
            let sx = 0, sy = 0, n = 0;
            for (const id of ids) {
              const sys = st.map.systems[id];
              if (!sys) continue;
              sx += sys.x; sy += sys.y; n++;
            }
            if (n) st.focusOn(sx / n, sy / n);
          }
          break;
        }
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

  const renameMap = (title: string) => {
    if (!mapId) return;
    setMeta((m) => (m ? { ...m, title } : m));
    api.updateMap(mapId, { title }).catch((e) => setError((e as Error).message));
  };

  return (
    <div className="editor">
      <header className="editor-top">
        <button
          className="mini-btn"
          onClick={() => {
            disconnect();
            navigate(mapId ? paths.dashboard : paths.login);
          }}
        >
          ← {mapId ? 'Maps' : 'Sign in'}
        </button>

        {mapId ? (
          <input
            className="editor-title"
            value={meta?.title ?? ''}
            placeholder="Untitled galaxy"
            disabled={readOnly}
            onChange={(e) => renameMap(e.target.value)}
          />
        ) : (
          <span className="editor-title local">Local draft — not saved to the server</span>
        )}

        {mapId && (
          <span className={`sync-chip sync-${status}`}>
            <span className="sync-dot" />
            {status === 'live'
              ? peers.length > 1
                ? `Live · ${peers.length}`
                : 'Live'
              : status === 'connecting'
                ? 'Reconnecting…'
                : 'Offline'}
            {peers.slice(0, 5).map((p) => (
              <span
                key={p.id}
                className="peer-dot"
                style={{ background: p.color }}
                title={p.name}
              />
            ))}
          </span>
        )}
        {readOnly && <span className="badge">read-only</span>}
        {error && <span className="badge badge-warn">{error}</span>}

        <span className="spacer" />
        <button className="mini-btn" onClick={() => setShowHelp(true)} title="Shortcuts (?)">
          ?
        </button>
      </header>

      <div className="editor-body">
        <Toolbar />
        <div className="editor-main">
          <ToolOptionsBar />
          <MapCanvas />
        </div>

        {!collapsed && (
          <>
            <div className="resizer" onPointerDown={startResize} />
            <aside className="sidebar" style={{ width, flexBasis: width }}>
              <div className="tabbar">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    className={`tab${tab === t.id ? ' active' : ''}`}
                    onClick={() => setTab(t.id)}
                  >
                    <span className="tab-icon">{t.icon}</span>
                    {t.label}
                  </button>
                ))}
              </div>
              <div className="tab-body">
                {tab === 'properties' && <Inspector />}
                {tab === 'outliner' && <OutlinerTab />}
                {tab === 'map' && (
                  <MapTab
                    onOpenGenerate={() => setShowGenerate(true)}
                    onOpenExport={() => setShowExport(true)}
                  />
                )}
              </div>
            </aside>
          </>
        )}
        {collapsed && (
          <button
            className="uncollapse"
            title="Show the panel (Tab)"
            onClick={() => setCollapsed(false)}
          >
            ‹
          </button>
        )}
      </div>

      {showGenerate && <GenerateDialog onClose={() => setShowGenerate(false)} />}
      {showExport && <ExportDialog onClose={() => setShowExport(false)} />}
      {showHelp && <HelpOverlay onClose={() => setShowHelp(false)} />}
    </div>
  );
}
