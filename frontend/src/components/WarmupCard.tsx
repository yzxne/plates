// Warm-up / cool-down checklist for a workout, and the ramp-up set hint under a lift.
// Ticks live with the workout on the phone only (not saved to the Sheet). Timed items count down when tapped.
import { useEffect, useState } from 'preact/hooks';
import type { PrepItem, Ramp } from '../../../shared/warmups';
import { rampWeight } from '../../../shared/warmups';
import { fmt } from '../format';

export function PrepCard({ title, items, done, onToggle, startOpen }: {
  title: string; items: PrepItem[]; done: string[]; onToggle: (id: string, on: boolean) => void; startOpen: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  const [timer, setTimer] = useState<{ id: string; endsAt: number } | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!timer) return;
    const t = setInterval(() => {
      if (Date.now() >= timer.endsAt) { onToggle(timer.id, true); setTimer(null); } else tick((n) => n + 1);
    }, 250);
    return () => clearInterval(t);
  }, [timer]);
  const count = items.filter((i) => done.includes(i.id)).length;
  const all = count === items.length;

  return (
    <details class={`card prep-card ${all ? 'all-done' : ''}`} open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>
        <h2>{title}</h2>
        <span class="muted">{all ? '✓ Done' : `${count}/${items.length}`}</span>
      </summary>
      <ul class="prep-list">
        {items.map((it) => {
          const on = done.includes(it.id);
          const running = timer?.id === it.id;
          const left = running ? Math.max(0, Math.ceil((timer!.endsAt - Date.now()) / 1000)) : 0;
          return (
            <li key={it.id} class={on ? 'on' : ''}>
              <button class={`check ${on ? 'on' : ''}`} aria-pressed={on} aria-label={`${it.label} done`} onClick={() => { if (running) setTimer(null); onToggle(it.id, !on); }}>✓</button>
              <span class="prep-text"><span>{it.label}</span><small class="muted">{it.dose}</small></span>
              {it.seconds && !on && (
                <button class="chip prep-timer" onClick={() => setTimer(running ? null : { id: it.id, endsAt: Date.now() + it.seconds! * 1000 })}>
                  {running ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} · stop` : '▶ Timer'}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

/** "Ramp-up: 95 × 8 · 135 × 4 · 160 × 2" from the first working set's weight. Tap a step to tick it. Not saved as sets. */
export function RampHint({ ramp, working, done, onToggle }: {
  ramp: Ramp; working: number | null; done: number[]; onToggle: (i: number) => void;
}) {
  return (
    <div class="ramp" aria-label="Ramp-up sets before your working sets">
      <small class="muted">Ramp-up</small>
      {ramp.map((r, i) => (
        <button key={i} class={`chip ramp-step ${done.includes(i) ? 'on' : ''}`} aria-pressed={done.includes(i)} onClick={() => onToggle(i)}>
          {working ? `${fmt(rampWeight(working, r.pct), 1)} × ${r.reps}` : `${Math.round(r.pct * 100)}% × ${r.reps}`}
        </button>
      ))}
    </div>
  );
}
