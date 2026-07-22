import { useEffect, useState } from 'react';
import { api } from '../net/api';

type Invite = { code: string; used: boolean; usedBy: string | null };

/**
 * Admin-only: mint and track the codes new people register with.
 *
 * These are credentials — anyone holding an unused one gets an account — so
 * they live behind a deliberate click rather than sitting open on the
 * dashboard where a screen share would leak them.
 */
export function InviteDialog({
  onClose,
  onError,
}: {
  onClose: () => void;
  onError: (m: string) => void;
}) {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const refresh = () =>
    api
      .listInvites()
      .then((r) => setInvites(r.invites))
      .catch((e) => onError((e as Error).message));

  useEffect(() => {
    refresh();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const unused = invites.filter((i) => !i.used);
  const used = invites.filter((i) => i.used);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Invite codes</h2>

        <div className="invite-list">
          {invites.length === 0 && <div className="empty-hint">No codes yet.</div>}
          {[...unused, ...used].map((i) => (
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

        <div className="panel-note">
          A code is good for one registration. Send it to the person; they enter
          it on the Register tab.
        </div>

        <div className="modal-actions">
          <button
            className="tool-btn"
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
          <button className="tool-btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
