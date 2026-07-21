import { useCallback, useEffect, useRef, useState } from 'react';
import { api, RemoteMap, SessionUser, viewerLink } from '../net/api';
import { navigate, paths } from './routes';
import { InviteSection } from './InviteSection';
import { AccessSection } from './AccessSection';
import { GenerateDialog } from './GenerateDialog';
import { useEditor } from '../model/store';
import { importFromFile } from '../persistence/io';
import { emptyMap } from '../model/types';

/** How often the card list refreshes to show who is on which board. */
const PRESENCE_POLL = 6000;

export function DashboardPage({
  user,
  onSignedOut,
}: {
  user: SessionUser;
  onSignedOut: () => void;
}) {
  const [maps, setMaps] = useState<RemoteMap[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);
  const [sharing, setSharing] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const setMap = useEditor((s) => s.setMap);

  const refresh = useCallback(
    () =>
      api
        .listMaps()
        .then((r) => setMaps(r.maps))
        .catch((e) => setError((e as Error).message)),
    []
  );

  useEffect(() => {
    refresh();
    // Presence is the only thing that changes without us doing anything, so a
    // slow poll is plenty — no need for a second socket just for the lobby.
    const t = window.setInterval(refresh, PRESENCE_POLL);
    return () => window.clearInterval(t);
  }, [refresh]);

  const guard = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const createFrom = (title: string, map: Parameters<typeof api.createMap>[1]) =>
    guard(async () => {
      const r = await api.createMap(title, map);
      navigate(paths.editor(r.map.id));
    });

  return (
    <div className="dash">
      <header className="dash-head">
        <div className="dash-brand">
          <span className="dash-logo">✷</span>
          <span>Galactic Map</span>
        </div>
        <div className="dash-user">
          <span>{user.name}</span>
          {user.admin && <span className="badge">admin</span>}
          <button
            className="mini-btn"
            onClick={() =>
              guard(async () => {
                await api.logout();
                onSignedOut();
                navigate(paths.login);
              })
            }
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="dash-body">
        <div className="dash-actions">
          <button
            className="big-btn primary"
            disabled={busy}
            onClick={() => setShowGenerate(true)}
          >
            <span className="big-icon">✧</span>
            <span>
              <b>Generate a galaxy</b>
              <em>New map from procedural parameters</em>
            </span>
          </button>
          <button
            className="big-btn"
            disabled={busy}
            onClick={() => createFrom('Empty galaxy', emptyMap(0))}
          >
            <span className="big-icon">＋</span>
            <span>
              <b>Empty map</b>
              <em>Start from nothing and place systems by hand</em>
            </span>
          </button>
          <button
            className="big-btn"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            <span className="big-icon">↥</span>
            <span>
              <b>Import JSON</b>
              <em>Upload a map file as a new map</em>
            </span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              guard(async () => {
                const m = await importFromFile(file);
                await createFrom(file.name.replace(/\.json$/i, ''), m);
              });
            }}
          />
        </div>

        {error && <div className="error-note">{error}</div>}

        <h2 className="dash-title">Your maps</h2>
        {maps.length === 0 && (
          <div className="empty-hint">
            Nothing here yet. Generate a galaxy to begin.
          </div>
        )}

        <div className="map-grid">
          {maps.map((m) => (
            <article className="map-card" key={m.id}>
              <button
                className="map-open"
                onClick={() => navigate(paths.editor(m.id))}
              >
                <h3>{m.title}</h3>
                <div className="map-meta">
                  {m.ownerId === user.id ? 'yours' : `by ${m.owner}`} · edited{' '}
                  {relTime(m.updatedAt)}
                </div>
              </button>

              <div className="map-row">
                <span className={`badge${m.published ? ' badge-live' : ''}`}>
                  {m.published ? 'published' : 'private'}
                </span>
                {m.active.length > 0 && (
                  <span className="map-active" title="Here right now">
                    {m.active.map((a, i) => (
                      <span
                        key={i}
                        className="peer-dot"
                        style={{ background: a.color }}
                        title={a.name}
                      />
                    ))}
                    {m.active.length} on the board
                  </span>
                )}
              </div>

              <div className="map-row">
                <button
                  className="mini-btn"
                  onClick={() => setSharing(sharing === m.id ? null : m.id)}
                >
                  Share
                </button>
                {m.published && (
                  <button
                    className="mini-btn"
                    onClick={() =>
                      navigator.clipboard
                        ?.writeText(viewerLink(m.slug, m.viewToken))
                        .then(() => {
                          setCopied(m.id);
                          setTimeout(() => setCopied(null), 1500);
                        })
                        .catch(() => {})
                    }
                  >
                    {copied === m.id ? '✓ copied' : 'Copy link'}
                  </button>
                )}
                <span className="spacer" />
                {(m.ownerId === user.id || user.admin) && (
                  <button
                    className="mini-btn danger"
                    onClick={() => {
                      if (!confirm(`Delete "${m.title}" for good?`)) return;
                      guard(async () => {
                        await api.deleteMap(m.id);
                        await refresh();
                      });
                    }}
                  >
                    Delete
                  </button>
                )}
              </div>

              {sharing === m.id && (
                <div className="map-share">
                  <label className="toggle-row">
                    <input
                      type="checkbox"
                      checked={m.published}
                      onChange={(e) =>
                        guard(async () => {
                          await api.updateMap(m.id, { published: e.target.checked });
                          await refresh();
                        })
                      }
                    />
                    <span>Anyone with the link can view</span>
                  </label>
                  {m.published && (
                    <input
                      className="empire-name"
                      readOnly
                      value={viewerLink(m.slug, m.viewToken)}
                      onFocus={(e) => e.currentTarget.select()}
                    />
                  )}
                  <AccessSection
                    map={m}
                    me={user}
                    onChanged={refresh}
                    onError={setError}
                  />
                </div>
              )}
            </article>
          ))}
        </div>

        {user.admin && (
          <div className="panel dash-panel">
            <div className="panel-header">
              <span>Administration</span>
            </div>
            <InviteSection onError={setError} />
          </div>
        )}
      </main>

      {showGenerate && (
        <GenerateDialog
          onClose={() => setShowGenerate(false)}
          onGenerated={(m, title) => {
            setShowGenerate(false);
            // Hold it locally too, so the editor has something to draw the
            // instant it mounts, before the socket's copy arrives.
            setMap(m, true);
            createFrom(title, m);
          }}
        />
      )}
    </div>
  );
}

function relTime(ts: number) {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(ts).toLocaleDateString();
}
