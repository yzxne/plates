import { useRef, useState } from 'preact/hooks';

const THRESHOLD = 90;

/**
 * Swipe a row left to delete it (sets in the workout logger). Unlike SwipeRow this wraps a div,
 * so the row can hold inputs and buttons; it only takes over once the finger clearly moves sideways.
 */
export function SwipeDelete({ onDelete, children, class: cls = '' }: { onDelete: () => void; children: preact.ComponentChildren; class?: string }) {
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const horizontal = useRef<boolean | null>(null);

  const reset = () => { start.current = null; horizontal.current = null; setDx(0); };

  return (
    <div class="swipe-del-wrap">
      <div class={`swipe-del-under ${dx <= -THRESHOLD ? 'armed' : ''}`} aria-hidden="true">{dx < 0 ? 'Delete' : ''}</div>
      <div
        class={cls}
        style={{ transform: dx ? `translateX(${dx}px)` : undefined, transition: dx ? 'none' : undefined }}
        onPointerDown={(e) => { if (e.pointerType !== 'mouse' || e.button === 0) { start.current = { x: e.clientX, y: e.clientY, id: e.pointerId }; horizontal.current = null; } }}
        onPointerMove={(e) => {
          const s = start.current;
          if (!s || s.id !== e.pointerId) return;
          const mx = e.clientX - s.x;
          const my = e.clientY - s.y;
          if (horizontal.current === null && (Math.abs(mx) > 12 || Math.abs(my) > 12)) {
            horizontal.current = mx < 0 && Math.abs(mx) > Math.abs(my) * 1.3;
            if (horizontal.current) {
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              (document.activeElement as HTMLElement | null)?.blur?.();
            }
          }
          if (horizontal.current) setDx(Math.max(-160, Math.min(0, mx)));
        }}
        onPointerUp={() => { const d = dx; const h = horizontal.current; reset(); if (h && d <= -THRESHOLD) onDelete(); }}
        onPointerCancel={reset}
        onClickCapture={(e) => { if (horizontal.current) { e.preventDefault(); e.stopPropagation(); } }}
      >
        {children}
      </div>
    </div>
  );
}
