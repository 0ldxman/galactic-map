import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { SWATCHES } from '../model/palette';

const PANEL_W = 232;
const PANEL_H = 214;

/**
 * A colour control that stays on screen.
 *
 * A bare `<input type="color">` hands the job to the browser, which anchors its
 * dialog to the input and happily runs it off the right edge — and the side
 * panel is *at* the right edge. So the common case (pick one of these) is a
 * popover we place ourselves, clamped to the viewport, with a hex field for
 * anything else. The OS picker is still reachable, one click further in, where
 * it opens from the middle of the screen instead of the corner.
 */
export function ColorSwatch({
  value,
  onChange,
  title,
  disabled,
}: {
  value: string;
  onChange: (hex: string) => void;
  title?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [text, setText] = useState(value);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => setText(value), [value]);

  useLayoutEffect(() => {
    if (!open) return;
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const x = Math.max(8, Math.min(r.left, window.innerWidth - PANEL_W - 8));
    // Below the swatch, unless that would fall off the bottom.
    const below = r.bottom + 6;
    const y =
      below + PANEL_H > window.innerHeight
        ? Math.max(8, r.top - PANEL_H - 6)
        : below;
    setPos({ x, y });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (
        !panelRef.current?.contains(e.target as Node) &&
        !btnRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const commitText = (raw: string) => {
    const hex = raw.trim().replace(/^#?/, '#');
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex)) onChange(hex);
    else setText(value);
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="swatch-btn"
        title={title}
        disabled={disabled}
        style={{ background: value }}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      />
      {open && (
        <div
          ref={panelRef}
          className="swatch-pop"
          style={{ left: pos.x, top: pos.y, width: PANEL_W }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="swatch-grid">
            {SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                className={`swatch-cell${
                  c.toLowerCase() === value.toLowerCase() ? ' on' : ''
                }`}
                style={{ background: c }}
                title={c}
                onClick={() => {
                  onChange(c);
                  setOpen(false);
                }}
              />
            ))}
          </div>
          <div className="swatch-foot">
            <input
              className="swatch-hex"
              value={text}
              spellCheck={false}
              onChange={(e) => setText(e.target.value)}
              onBlur={(e) => commitText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitText((e.target as HTMLInputElement).value);
              }}
            />
            <input
              type="color"
              title="More colours"
              value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff'}
              onChange={(e) => onChange(e.target.value)}
            />
          </div>
        </div>
      )}
    </>
  );
}
