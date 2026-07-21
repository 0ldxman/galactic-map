import { useEffect, useRef, useState } from 'react';
import { api } from '../net/api';
import { connectMap, disconnect, useSync } from '../net/sync';
import { useEditor } from '../model/store';
import { MapCanvas } from './MapCanvas';
import { ViewerCard } from './ViewerCard';

/**
 * A published map as its audience sees it: the map, full bleed. No tools, no
 * panels — a title in the corner, and a card only when they click something.
 */
export function ViewerPage({ slug, token }: { slug: string; token: string }) {
  const [meta, setMeta] = useState<{ title: string; owner: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const booted = useRef(false);
  const clearSelection = useEditor((s) => s.clearSelection);
  const syncError = useSync((s) => s.error);
  const status = useSync((s) => s.status);

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clearSelection();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clearSelection]);

  const fatal = error ?? (status === 'error' ? syncError : null);

  if (fatal) {
    return (
      <div className="viewer-blocked">
        <div className="auth-card">
          <div className="auth-logo">✷</div>
          <h1>Map unavailable</h1>
          <p className="auth-sub">{fatal}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="viewer-page">
      <MapCanvas />
      <div className="viewer-title">
        <b>{meta?.title ?? 'Loading…'}</b>
        {meta && <span>by {meta.owner}</span>}
      </div>
      <div className="viewer-hint">
        Drag to pan · wheel to zoom · click anything to read about it
      </div>
      <ViewerCard onClose={clearSelection} />
    </div>
  );
}
