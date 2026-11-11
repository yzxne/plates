import { useRef, useState } from 'preact/hooks';

interface Props {
  onTap: () => void;
  onSwipeLeft: () => void; // delete
  onSwipeRight: () => void; // edit
  children: preact.ComponentChildren;
  label: string;
}

const THRESHOLD = 80;

/**
 * Entry row with swipe gestures: swipe left = delete, swipe right or tap = edit.
 * Vertical scrolling still works (we only take over once the finger clearly moves sideways).
 */
export function SwipeRow({ onTap, onSwipeLeft, onSwipeRight, children, label }: Props) {
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const horizontal = useRef<boolean | null>(null);

  function down(e: PointerEvent) {
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    horizontal.current = null;
  }
  function move(e: PointerEvent) {
    const s = start.current;
    if (!s || s.id !== e.pointerId) return;
    const mx = e.clientX - s.x;
    const my = e.clientY - s.y;
    if (horizontal.current === null && (Math.abs(mx) > 10 || Math.abs(my) > 10)) {
      horizontal.current = Math.abs(mx) > Math.abs(my) * 1.3;
      if (horizontal.current) (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
    if (horizontal.current) setDx(Math.max(-140, Math.min(140, mx)));
  }
  function up() {
    const wasHorizontal = horizontal.current;
    const d = dx;
    start.current = null;
    horizontal.current = null;
    setDx(0);
    if (wasHorizontal) {
      if (d <= -THRESHOLD) onSwipeLeft();
      else if (d >= THRESHOLD) onSwipeRight();
    } else if (wasHorizontal === null) {
      onTap();
    }
  }

  return (
    <div class="swipe-wrap">
      <div class={`swipe-under ${dx < 0 ? 'del' : 'edit'}`} aria-hidden="true">
        <span>{dx > 0 ? 'Edit' : ''}</span><span>{dx < 0 ? 'Delete' : ''}</span>
      </div>
      <button
        class="entry swipe-row"
        aria-label={label}
        style={{ transform: dx ? `translateX(${dx}px)` : undefined }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => { start.current = null; horizontal.current = null; setDx(0); }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTap(); } }}
      >
        {children}
      </button>
    </div>
  );
}
