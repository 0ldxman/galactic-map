import { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { useEditor } from '../model/store';
import { useSync } from '../net/sync';
import { STATUS_BY_ID, statusOf } from '../model/status';
import { MARKER_BY_ID } from '../model/markers';
import { OBJECT_BY_ID } from '../model/objects';

function Markdown({ text }: { text?: string }) {
  const html = useMemo(
    () => (text ? DOMPurify.sanitize(marked.parse(text, { async: false }) as string) : ''),
    [text]
  );
  if (!html) return null;
  return <div className="notes-view" dangerouslySetInnerHTML={{ __html: html }} />;
}

/**
 * The read-only side panel a guest sees on a published map: what is selected,
 * who owns it and whatever lore the author wrote. No editing controls at all,
 * so nothing looks clickable that would silently do nothing.
 */
export function ViewerPanel({ title, owner }: { title: string; owner: string }) {
  const map = useEditor((s) => s.map);
  const selection = useEditor((s) => s.selection);
  const selectedEntity = useEditor((s) => s.selectedEntity);
  const status = useSync((s) => s.status);
  const error = useSync((s) => s.error);
  const peers = useSync((s) => s.peers);

  const sys = selection.length === 1 ? map.systems[selection[0]] : null;
  const ent = selectedEntity ? map[selectedEntity.c][selectedEntity.id] : null;

  return (
    <>
      <div className="panel">
        <div className="panel-header">
          <span>{title}</span>
        </div>
        <div className="panel-note">
          Published by {owner} ·{' '}
          {status === 'live'
            ? `live, ${peers.length} viewing`
            : status === 'connecting'
              ? 'reconnecting…'
              : 'offline'}
        </div>
        {error && <div className="error-note">{error}</div>}
      </div>

      {sys && (
        <div className="panel">
          <div className="panel-header">
            <span>{sys.name}</span>
          </div>
          <div className="kv">
            <span>Owner</span>
            <b>{sys.ownerId ? map.empires[sys.ownerId]?.name ?? '—' : 'Neutral'}</b>
          </div>
          <div className="kv">
            <span>Status</span>
            <b>{STATUS_BY_ID[statusOf(sys)]?.label ?? 'Core'}</b>
          </div>
          {!!sys.markers?.length && (
            <div className="kv">
              <span>Markers</span>
              <b>
                {sys.markers
                  .map((m) => MARKER_BY_ID[m]?.label ?? m)
                  .join(', ')}
              </b>
            </div>
          )}
          <Markdown text={sys.notes} />
        </div>
      )}

      {ent && selectedEntity && (
        <div className="panel">
          <div className="panel-header">
            <span>
              {'name' in ent ? (ent.name as string) : 'Annotation'}
            </span>
          </div>
          {selectedEntity.c === 'objects' && (
            <div className="kv">
              <span>Type</span>
              <b>
                {OBJECT_BY_ID[map.objects[selectedEntity.id].kind]?.label ?? '—'}
              </b>
            </div>
          )}
          <Markdown text={'notes' in ent ? (ent.notes as string) : undefined} />
        </div>
      )}

      <div className="help-box">
        <b>Viewing a published map</b>
        <ul>
          <li>Drag with the right or middle button to pan</li>
          <li>Wheel to zoom · click a system to read about it</li>
        </ul>
      </div>
    </>
  );
}
