// Drag rows by their ≡ handle to change the order. Works with touch and mouse (pointer events).
import { useRef, useState } from 'preact/hooks';

export function ReorderSheet({ title, items, onDone, onClose }: {
  title: string; items: { key: string; label: string; sub?: string }[];
  onDone: (order: number[]) => void; onClose: () => void;
}) {
  const [order, setOrder] = useState(() => items.map((_, i) => i));
  const [drag, setDrag] = useState<{ pos: number; dy: number } | null>(null);
  const start = useRef<{ y: number; pos: number; h: number } | null>(null);
  const list = useRef<HTMLDivElement>(null);

  function down(e: PointerEvent, pos: number) {
    const row = (e.currentTarget as HTMLElement).closest('.reorder-row') as HTMLElement;
    start.current = { y: e.clientY, pos, h: row.offsetHeight };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ pos, dy: 0 });
    e.preventDefault();
  }
  function move(e: PointerEvent) {
    const s = start.current;
    if (!s) return;
    let dy = e.clientY - s.y;
    // Crossed half a row → swap with the neighbour and re-anchor.
    const steps = Math.trunc((dy + Math.sign(dy) * s.h / 2) / s.h);
    const to = Math.max(0, Math.min(order.length - 1, s.pos + steps));
    if (to !== s.pos) {
      setOrder((o) => { const n = [...o]; const [x] = n.splice(s.pos, 1); n.splice(to, 0, x!); return n; });
      dy -= (to - s.pos) * s.h;
      start.current = { ...s, y: s.y + (to - s.pos) * s.h, pos: to };
    }
    setDrag({ pos: start.current!.pos, dy });
  }
  function up() { start.current = null; setDrag(null); }

  const changed = order.some((v, i) => v !== i);
  return (
    <div class="sheet-backdrop" onClick={onClose}>
      <div class="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <p class="muted tiny-pad">Drag ≡ to move an exercise.</p>
        <div class="list card reorder" ref={list}>
          {order.map((idx, pos) => {
            const it = items[idx]!;
            const active = drag?.pos === pos;
            return (
              <div key={it.key} class={`row reorder-row ${active ? 'dragging' : ''}`} style={active ? { transform: `translateY(${drag!.dy}px)` } : undefined}>
                <span class="reorder-num">{pos + 1}</span>
                <span class="row-text"><span class="clip">{it.label}</span>{it.sub && <small class="muted">{it.sub}</small>}</span>
                <span class="reorder-handle" aria-label={`Drag ${it.label}`} role="button"
                  onPointerDown={(e) => down(e, pos)} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>≡</span>
              </div>
            );
          })}
        </div>
        <button class="btn primary" disabled={!changed} onClick={() => { onDone(order); onClose(); }}>Save order</button>
      </div>
    </div>
  );
}
