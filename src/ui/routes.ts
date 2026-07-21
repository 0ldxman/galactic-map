import { useEffect, useState } from 'react';

/**
 * A four-route app doesn't need a router library. The URL is the single source
 * of truth; `navigate` pushes history and everything listening re-reads it.
 */
export type Route =
  | { name: 'login' }
  | { name: 'dashboard' }
  | { name: 'editor'; mapId: string }
  | { name: 'viewer'; slug: string; token: string }
  /** editing a map that only exists in this browser */
  | { name: 'local' };

export function parseRoute(): Route {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  const view = path.match(/^\/v\/([^/]+)$/);
  if (view) {
    return {
      name: 'viewer',
      slug: decodeURIComponent(view[1]),
      token: new URLSearchParams(window.location.search).get('t') ?? '',
    };
  }
  const edit = path.match(/^\/m\/([^/]+)$/);
  if (edit) return { name: 'editor', mapId: decodeURIComponent(edit[1]) };
  if (path === '/login') return { name: 'login' };
  if (path === '/local') return { name: 'local' };
  return { name: 'dashboard' };
}

const listeners = new Set<() => void>();

export function navigate(path: string, replace = false) {
  if (replace) window.history.replaceState(null, '', path);
  else window.history.pushState(null, '', path);
  for (const fn of listeners) fn();
}

export function useRoute(): Route {
  const [route, setRoute] = useState(parseRoute);
  useEffect(() => {
    const update = () => setRoute(parseRoute());
    listeners.add(update);
    window.addEventListener('popstate', update);
    return () => {
      listeners.delete(update);
      window.removeEventListener('popstate', update);
    };
  }, []);
  return route;
}

export const paths = {
  dashboard: '/',
  login: '/login',
  local: '/local',
  editor: (id: string) => `/m/${encodeURIComponent(id)}`,
};
