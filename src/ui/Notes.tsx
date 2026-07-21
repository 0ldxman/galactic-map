import { useState, useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

interface Props {
  value?: string;
  onChange: (v: string) => void;
  label?: string;
}

/**
 * Markdown lore field with edit / preview tabs. The rendered HTML is sanitised
 * before it is injected — notes travel with a map that may be imported from
 * someone else's file or, later, published to viewers.
 */
export function Notes({ value, onChange, label = 'Notes' }: Props) {
  const [tab, setTab] = useState<'edit' | 'preview'>(
    value ? 'preview' : 'edit'
  );

  const html = useMemo(() => {
    if (!value) return '';
    const raw = marked.parse(value, { async: false }) as string;
    return DOMPurify.sanitize(raw);
  }, [value]);

  return (
    <div className="field">
      <div className="notes-head">
        <span>{label}</span>
        <div className="seg">
          <button
            type="button"
            className={`seg-btn${tab === 'edit' ? ' active' : ''}`}
            onClick={() => setTab('edit')}
          >
            Edit
          </button>
          <button
            type="button"
            className={`seg-btn${tab === 'preview' ? ' active' : ''}`}
            onClick={() => setTab('preview')}
          >
            Preview
          </button>
        </div>
      </div>
      {tab === 'edit' ? (
        <textarea
          className="notes-input"
          rows={6}
          placeholder="Markdown: **bold**, *italic*, # heading, - list, [link](url)"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : html ? (
        <div className="notes-view" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <div className="empty-hint">Nothing written yet.</div>
      )}
    </div>
  );
}
