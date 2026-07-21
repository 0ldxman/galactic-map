import { useEffect, useState } from 'react';
import { api } from '../net/api';

type Invite = { code: string; used: boolean; usedBy: string | null };

/** Admin-only: mint and track the codes new people register with. */
export function InviteSection({ onError }: { onError: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const refresh = () =>
    api
      .listInvites()
      .then((r) => setInvites(r.invites))
      .catch((e) => onError((e as Error).message));

  useEffect(() => {
    if (open) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const unused = invites.filter((i) => !i.used);

  return (
    <div className="field" style={{ marginTop: 10 }}>
      <div className="notes-head">
        <span>Invite codes</span>
        <button className="mini-btn" onClick={() => setOpen(!open)}>
          {open ? 'Hide' : 'Show'}
        </button>
      </div>
      {open && (
        <>
          <div className="invite-list">
            {invites.length === 0 && (
              <div className="empty-hint">No codes yet.</div>
            )}
            {[...unused, ...invites.filter((i) => i.used)].map((i) => (
              <div key={i.code} className={`invite${i.used ? ' used' : ''}`}>
                <code>{i.code}</code>
                <span className="invite-who">
                  {i.used ? `used by ${i.usedBy ?? '—'}` : 'unused'}
                </span>
                {!i.used && (
                  <button
                    className="mini-btn"
                    onClick={() =>
                      navigator.clipboard
                        ?.writeText(i.code)
                        .then(() => {
                          setCopied(i.code);
                          setTimeout(() => setCopied(null), 1500);
                        })
                        .catch(() => {})
                    }
                  >
                    {copied === i.code ? '✓' : 'Copy'}
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            className="mini-btn"
            style={{ marginTop: 6 }}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api.createInvite();
                await refresh();
              } catch (e) {
                onError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            + New code
          </button>
          <div className="panel-note">
            A code is good for one registration. Send it to the person; they
            enter it on the Register tab.
          </div>
        </>
      )}
    </div>
  );
}
