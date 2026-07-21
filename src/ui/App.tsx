import { useEffect, useState } from 'react';
import { api, SessionUser } from '../net/api';
import { useRoute, navigate, paths } from './routes';
import { LoginPage } from './LoginPage';
import { DashboardPage } from './DashboardPage';
import { EditorPage } from './EditorPage';
import { ViewerPage } from './ViewerPage';

export function App() {
  const route = useRoute();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [checked, setChecked] = useState(false);

  // Who is signed in, if anyone. A failure here means the server is not
  // reachable at all, which is normal in `npm run dev` — the local draft route
  // still works, so it must not be treated as an error.
  useEffect(() => {
    api
      .me()
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setChecked(true));
  }, []);

  if (route.name === 'viewer') {
    return <ViewerPage slug={route.slug} token={route.token} />;
  }
  if (route.name === 'local') return <EditorPage mapId={null} />;

  if (!checked) return <div className="boot">…</div>;

  if (!user) {
    // Anything that needs an account falls back to the sign-in page.
    if (route.name !== 'login') navigate(paths.login, true);
    return <LoginPage onSignedIn={setUser} />;
  }

  if (route.name === 'editor') return <EditorPage mapId={route.mapId} />;

  if (route.name === 'login') navigate(paths.dashboard, true);
  return <DashboardPage user={user} onSignedOut={() => setUser(null)} />;
}
