import { useEffect, useState } from 'react';
import { api, RemoteMap, SessionUser } from '../net/api';

/**
 * Who else may edit this map. Only the owner (or an admin) sees it — everyone
 * else has no business changing the guest list.
 */
export function AccessSection({
  map,
  me,
  onChanged,
  onError,
}: {
  map: RemoteMap;
  me: SessionUser;
  onChanged: () => void;
  onError: (m: string) => void;
}) {
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);

  const mayShare = map.ownerId === me.id || me.admin;

  useEffect(() => {
    if (!mayShare) return;
    api
      .listUsers()
      .then((r) => setUsers(r.users))
      .catch((e) => onError((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mayShare]);

  if (!mayShare) return null;

  const editorIds = map.editors.map((e) => e.id);
  const candidates = users.filter(
    (u) => u.id !== map.ownerId && !editorIds.includes(u.id)
  );

  const apply = async (next: string[]) => {
    setBusy(true);
    try {
      await api.setAccess(map.id, next);
      onChanged();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="field" style={{ marginTop: 10 }}>
      <span>Who can edit</span>
      <div className="peer-list">
        <span className="peer" title="The owner always can">
          {map.owner} · owner
        </span>
        {map.editors.map((e) => (
          <span key={e.id} className="peer">
            {e.name}
            <button
              className="chip-x"
              title="Remove"
              disabled={busy}
              onClick={() => apply(editorIds.filter((id) => id !== e.id))}
            >
              ✕
            </button>
          </span>
        ))}
      </div>
      {candidates.length > 0 ? (
        <div className="link-row">
          <select
            className="empire-name"
            value={pick}
            onChange={(e) => setPick(e.target.value)}
          >
            <option value="">— pick someone —</option>
            {candidates.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <button
            className="mini-btn"
            disabled={!pick || busy}
            onClick={() => {
              apply([...editorIds, pick]);
              setPick('');
            }}
          >
            Add
          </button>
        </div>
      ) : (
        <div className="panel-note">
          Everyone with an account can already edit this map. Invite more people
          with an invite code.
        </div>
      )}
    </div>
  );
}
