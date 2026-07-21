import { useEffect, useState } from 'react';
import { useEditor } from '../model/store';
import { useSync, connectMap, disconnect } from '../net/sync';
import { api, RemoteMap, SessionUser, viewerLink } from '../net/api';

/** Sign-in, the list of maps on the server, live status and publishing. */
export function CloudPanel() {
  const map = useEditor((s) => s.map);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);
  const [maps, setMaps] = useState<RemoteMap[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [invite, setInvite] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  const status = useSync((s) => s.status);
  const peers = useSync((s) => s.peers);
  const openId = useSync((s) => s.mapId);
  const selfId = useSync((s) => s.selfId);

  useEffect(() => {
    api
      .me()
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setReady(true));
  }, []);

  const refresh = () =>
    api
      .listMaps()
      .then((r) => setMaps(r.maps))
      .catch((e) => setError((e as Error).message));

  useEffect(() => {
    if (user) refresh();
    else setMaps([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

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

  if (!ready) return null;

  if (!user) {
    return (
      <div className="panel">
        <div className="panel-header">
          <span>Server</span>
          <div className="seg">
            <button
              className={`seg-btn${mode === 'login' ? ' active' : ''}`}
              onClick={() => setMode('login')}
            >
              Sign in
            </button>
            <button
              className={`seg-btn${mode === 'register' ? ' active' : ''}`}
              onClick={() => setMode('register')}
            >
              Register
            </button>
          </div>
        </div>
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {mode === 'register' && (
          <label className="field">
            <span>Invite code</span>
            <input value={invite} onChange={(e) => setInvite(e.target.value)} />
          </label>
        )}
        {error && <div className="error-note">{error}</div>}
        <button
          className="mini-btn"
          disabled={busy}
          onClick={() =>
            guard(async () => {
              const r =
                mode === 'login'
                  ? await api.login(name, password)
                  : await api.register(name, password, invite);
              setUser(r.user);
              setPassword('');
            })
          }
        >
          {mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
        <div className="panel-note">
          Maps stay local until you sign in. Registration needs an invite code
          from whoever runs the server.
        </div>
      </div>
    );
  }

  const openMap = maps.find((m) => m.id === openId) ?? null;

  return (
    <div className="panel">
      <div className="panel-header">
        <span>Server — {user.name}</span>
        <button
          className="mini-btn"
          onClick={() =>
            guard(async () => {
              disconnect();
              await api.logout();
              setUser(null);
            })
          }
        >
          Sign out
        </button>
      </div>

      {openId && (
        <div className={`sync-bar sync-${status}`}>
          <span className="sync-dot" />
          <span className="sync-text">
            {status === 'live'
              ? `Live · ${peers.length} here`
              : status === 'connecting'
                ? 'Reconnecting…'
                : status === 'error'
                  ? 'Disconnected'
                  : 'Offline'}
          </span>
          <button className="mini-btn" onClick={disconnect}>
            Leave
          </button>
        </div>
      )}

      {openId && peers.length > 0 && (
        <div className="peer-list">
          {peers.map((p) => (
            <span key={p.id} className="peer" style={{ borderColor: p.color }}>
              <span className="peer-dot" style={{ background: p.color }} />
              {p.name}
              {p.id === selfId ? ' (you)' : ''}
              {!p.canEdit && ' · viewing'}
            </span>
          ))}
        </div>
      )}

      <div className="empire-list">
        {maps.length === 0 && (
          <div className="empty-hint">No maps on the server yet.</div>
        )}
        {maps.map((m) => (
          <div
            key={m.id}
            className={`empire-row${openId === m.id ? ' active' : ''}`}
            onClick={() => connectMap({ mapId: m.id })}
            title={`by ${m.owner} · updated ${new Date(m.updatedAt).toLocaleString()}`}
          >
            <span className="map-name">{m.title}</span>
            {m.published && <span className="badge">public</span>}
            <button
              className="mini-btn danger"
              title="Delete from the server"
              onClick={(ev) => {
                ev.stopPropagation();
                if (!confirm(`Delete "${m.title}" from the server?`)) return;
                guard(async () => {
                  if (openId === m.id) disconnect();
                  await api.deleteMap(m.id);
                  await refresh();
                });
              }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <button
        className="mini-btn"
        style={{ marginTop: 8 }}
        disabled={busy}
        onClick={() =>
          guard(async () => {
            const title = prompt('Name this map', 'Untitled galaxy');
            if (!title) return;
            const r = await api.createMap(title, map);
            await refresh();
            connectMap({ mapId: r.map.id });
          })
        }
      >
        ⬆ Upload the current map
      </button>

      {openMap && (
        <div className="field" style={{ marginTop: 10 }}>
          <span>Sharing</span>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={openMap.published}
              onChange={(e) =>
                guard(async () => {
                  await api.updateMap(openMap.id, { published: e.target.checked });
                  await refresh();
                })
              }
            />
            <span>Anyone with the link can view</span>
          </label>
          {openMap.published && (
            <div className="link-row">
              <input
                className="empire-name"
                readOnly
                value={viewerLink(openMap.slug, openMap.viewToken)}
                onFocus={(e) => e.currentTarget.select()}
              />
              <button
                className="mini-btn"
                onClick={() => {
                  navigator.clipboard
                    ?.writeText(viewerLink(openMap.slug, openMap.viewToken))
                    .then(() => {
                      setCopied(openMap.id);
                      setTimeout(() => setCopied(null), 1500);
                    })
                    .catch(() => {});
                }}
              >
                {copied === openMap.id ? '✓' : 'Copy'}
              </button>
            </div>
          )}
        </div>
      )}

      {user.admin && (
        <button
          className="mini-btn"
          style={{ marginTop: 8 }}
          onClick={() =>
            guard(async () => {
              const r = await api.createInvite();
              alert(`New invite code: ${r.code}`);
            })
          }
        >
          + Invite code
        </button>
      )}

      {error && <div className="error-note">{error}</div>}
    </div>
  );
}
