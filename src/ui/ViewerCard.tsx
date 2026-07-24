import { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { useEditor } from '../model/store';
import { STATUS_BY_ID, statusOf } from '../model/status';
import { MARKER_BY_ID } from '../model/markers';
import { OBJECT_BY_ID } from '../model/objects';
import { sectorSystems, sectorDepth } from '../model/sectors';

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
 * What a guest gets when they tap something on a published map: a card with
 * that object's facts and lore, and nothing else. No panel is shown while
 * nothing is selected — the map is the whole interface.
 *
 * It answers the questions a reader actually has (whose is this, how firmly do
 * they hold it, what is here, what is written about it) and leaves out the
 * editor's bookkeeping — the star list among it, which told a reader nothing.
 */
export function ViewerCard({ onClose }: { onClose: () => void }) {
  const map = useEditor((s) => s.map);
  const selection = useEditor((s) => s.selection);
  const selectedEntity = useEditor((s) => s.selectedEntity);

  const sys = selection.length === 1 ? map.systems[selection[0]] : null;
  const ent = selectedEntity ? map[selectedEntity.c][selectedEntity.id] : null;
  if (!sys && !ent) return null;

  const owner = sys?.ownerId ? map.empires[sys.ownerId] : null;
  // A system can be in several sectors; a reader wants the innermost naming,
  // so the deepest one is shown and the rest follow it.
  const sectors = sys
    ? (sys.sectors ?? [])
        .map((id) => map.regions[id])
        .filter(Boolean)
        .sort((a, b) => sectorDepth(map, b.id) - sectorDepth(map, a.id))
    : [];
  // Objects sitting in this system are part of what is there, so they are
  // listed rather than needing a second tap to discover.
  const here = sys
    ? Object.values(map.objects).filter((o) => o.systemId === sys.id)
    : [];

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
            <b className="v-owner">
              {owner && (
                <span className="peer-dot" style={{ background: owner.color }} />
              )}
              {owner ? owner.name : 'Unclaimed'}
            </b>
          </div>
          {owner && (
            <div className="kv">
              <span>Hold</span>
              <b>{STATUS_BY_ID[statusOf(sys)]?.label ?? 'Core'}</b>
            </div>
          )}
          {sectors.length > 0 && (
            <div className="kv">
              <span>{sectors.length > 1 ? 'Sectors' : 'Sector'}</span>
              <b>{sectors.map((r) => r.name).join(' · ')}</b>
            </div>
          )}
          {!!sys.markers?.length && (
            <div className="v-chips">
              {sys.markers.map((m) => {
                const mk = MARKER_BY_ID[m];
                if (!mk) return null;
                return (
                  <span className="v-chip" key={m} style={{ borderColor: mk.color }}>
                    <span style={{ color: mk.color }}>{mk.glyph}</span>
                    {mk.label}
                  </span>
                );
              })}
            </div>
          )}
          {here.length > 0 && (
            <div className="v-chips">
              {here.map((o) => (
                <span
                  className="v-chip"
                  key={o.id}
                  style={{ borderColor: o.color ?? OBJECT_BY_ID[o.kind]?.color }}
                >
                  {o.name}
                </span>
              ))}
            </div>
          )}
          <Markdown text={sys.notes} />
        </>
      )}

      {ent && selectedEntity && (
        <>
          <h2>{'name' in ent ? (ent.name as string) : 'Annotation'}</h2>
          {selectedEntity.c === 'objects' && (
            <>
              <div className="kv">
                <span>Type</span>
                <b>{OBJECT_BY_ID[map.objects[selectedEntity.id].kind]?.label ?? '—'}</b>
              </div>
              {(() => {
                const o = map.objects[selectedEntity.id];
                const far = o.linkedId ? map.objects[o.linkedId] : null;
                return far ? (
                  <div className="kv">
                    <span>Leads to</span>
                    <b>{far.name}</b>
                  </div>
                ) : null;
              })()}
            </>
          )}
          {selectedEntity.c === 'regions' && (
            <div className="kv">
              <span>Systems</span>
              <b>{sectorSystems(map, selectedEntity.id).length}</b>
            </div>
          )}
          <Markdown text={'notes' in ent ? (ent.notes as string) : undefined} />
        </>
      )}
    </div>
  );
}
