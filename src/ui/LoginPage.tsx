import { useState } from 'react';
import { api, SessionUser } from '../net/api';
import { navigate, paths } from './routes';

export function LoginPage({ onSignedIn }: { onSignedIn: (u: SessionUser) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [invite, setInvite] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r =
        mode === 'login'
          ? await api.login(name, password)
          : await api.register(name, password, invite);
      onSignedIn(r.user);
      navigate(paths.dashboard);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-logo">✷</div>
        <h1>Galactic Map</h1>
        <p className="auth-sub">Political maps of imagined galaxies.</p>

        <div className="seg auth-seg">
          <button
            type="button"
            className={`seg-btn${mode === 'login' ? ' active' : ''}`}
            onClick={() => setMode('login')}
          >
            Sign in
          </button>
          <button
            type="button"
            className={`seg-btn${mode === 'register' ? ' active' : ''}`}
            onClick={() => setMode('register')}
          >
            Register
          </button>
        </div>

        <label className="field">
          <span>Name</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="username"
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
        </label>
        {mode === 'register' && (
          <label className="field">
            <span>Invite code</span>
            <input
              value={invite}
              onChange={(e) => setInvite(e.target.value)}
              placeholder="ask whoever runs this server"
            />
          </label>
        )}

        {error && <div className="error-note">{error}</div>}

        <button className="auth-submit" type="submit" disabled={busy}>
          {busy ? '…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>

        <button
          type="button"
          className="auth-link"
          onClick={() => navigate(paths.local)}
        >
          Continue without an account →
        </button>
        <p className="auth-foot">
          Without an account the map lives only in this browser. You can upload
          it later.
        </p>
      </form>
    </div>
  );
}
