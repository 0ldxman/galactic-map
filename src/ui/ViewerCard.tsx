import { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { useEditor } from '../model/store';
import { STATUS_BY_ID, statusOf } from '../model/status';
import { MARKER_BY_ID } from '../model/markers';
import { OBJECT_BY_ID } from '../model/objects';
import { normalizeStars } from '../model/stars';

function Markdown({ text }: { text?: string }) {
  const html = useMemo(
    () =>
      text ? DOMPurify.sanitize(marked.parse(text, { async: false }) as string) : '',
    [text]
  );
  if (!html) return null;
  return <div className="notes-view" dangerouslySetInnerHTML={{ __html: html }} />;
}

/**
 * What a guest gets when they click something on a published map: a floating
 * card with that object's facts and lore, and nothing else. No panel is shown
 * while nothing is selected — the map is the whole interface.
 */
export function ViewerCard({ onClose }: { onClose: () => void }) {
  const map = useEditor((s) => s.map);
  const selection = useEditor((s) => s.selection);
  const selectedEntity = useEditor((s) => s.selectedEntity);

  const sys = selection.length === 1 ? map.systems[selection[0]] : null;
  const ent = selectedEntity ? map[selectedEntity.c][selectedEntity.id] : null;
  if (!sys && !ent) return null;

  return (
    <div className="viewer-card">
      <button className="viewer-close" onClick={onClose} title="Close">
        ✕
      </button>

      {sys && (
        <>
          <h2>{sys.name}</h2>
          <div className="kv">
            <span>Owner</span>
            <b>
              {sys.ownerId ? map.empires[sys.ownerId]?.name ?? '—' : 'Neutral'}
            </b>
          </div>
          <div className="kv">
            <span>Status</span>
            <b>{STATUS_BY_ID[statusOf(sys)]?.label ?? 'Core'}</b>
          </div>
          <div className="kv">
            <span>Stars</span>
            <b>
              {normalizeStars(sys)
                .map((b) => b.type)
                .join(', ')}
            </b>
          </div>
          {!!sys.markers?.length && (
            <div className="kv">
              <span>Markers</span>
              <b>{sys.markers.map((m) => MARKER_BY_ID[m]?.label ?? m).join(', ')}</b>
            </div>
          )}
          <Markdown text={sys.notes} />
        </>
      )}

      {ent && selectedEntity && (
        <>
          <h2>{'name' in ent ? (ent.name as string) : 'Annotation'}</h2>
          {selectedEntity.c === 'objects' && (
            <div className="kv">
              <span>Type</span>
              <b>{OBJECT_BY_ID[map.objects[selectedEntity.id].kind]?.label ?? '—'}</b>
            </div>
          )}
          <Markdown text={'notes' in ent ? (ent.notes as string) : undefined} />
        </>
      )}
    </div>
  );
}
