import { useEffect, useRef, useState } from 'react';
import { api } from '../net/api';
import { connectMap, disconnect } from '../net/sync';
import { MapCanvas } from './MapCanvas';
import { ViewerPanel } from './ViewerPanel';

/** A published map, opened by anyone holding the link. Read-only throughout. */
export function ViewerPage({ slug, token }: { slug: string; token: string }) {
  const [meta, setMeta] = useState<{ title: string; owner: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const booted = useRef(false);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    // The REST call is for the title and a readable error; the map itself
    // arrives over the socket, which then keeps it current.
    api
      .publicMap(slug, token)
      .then((r) => setMeta({ title: r.meta.title, owner: r.meta.owner }))
      .catch((e) => setError((e as Error).message));
    connectMap({ slug, token });
    return () => disconnect();
  }, [slug, token]);

  return (
    <div className="app">
      <MapCanvas />
      <aside className="sidebar viewer">
        <div className="tab-body">
          {error ? (
            <div className="panel">
              <div className="panel-header">
                <span>Cannot open this map</span>
              </div>
              <div className="error-note">{error}</div>
            </div>
          ) : (
            <ViewerPanel
              title={meta?.title ?? 'Loading…'}
              owner={meta?.owner ?? '…'}
            />
          )}
        </div>
      </aside>
    </div>
  );
}
