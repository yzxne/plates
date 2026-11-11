import { useEffect, useRef, useState } from 'preact/hooks';
import type { RestTimer as Rest } from '../activeWorkout';
import { beep } from '../sound';

interface Props {
  rest: Rest;
  onChange: (r: Rest | null) => void;
}

const fmt = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Bar at the bottom of the logger. Uses an end timestamp, so it stays right after the phone sleeps. */
export function RestTimer({ rest, onChange }: Props) {
  const [now, setNow] = useState(Date.now());
  const rang = useRef(false);

  useEffect(() => {
    rang.current = rest.endsAt <= Date.now();
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [rest.endsAt]);

  const left = rest.endsAt - now;
  useEffect(() => {
    if (left <= 0 && !rang.current) {
      rang.current = true;
      beep();
      const t = setTimeout(() => onChange(null), 4000);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [left <= 0]);

  const adjust = (sec: number) => onChange({ endsAt: Math.max(Date.now(), rest.endsAt + sec * 1000), total: Math.max(5, rest.total + sec) });
  const pct = Math.min(100, Math.max(0, (left / (rest.total * 1000)) * 100));

  return (
    <div class={`rest-bar ${left <= 0 ? 'done' : ''}`} role="timer" aria-live="polite">
      <div class="rest-progress" style={{ width: `${pct}%` }} />
      <button class="btn" onClick={() => adjust(-15)} aria-label="15 seconds less">−15</button>
      <div class="rest-time">{left > 0 ? fmt(left) : 'Rest done'}</div>
      <button class="btn" onClick={() => adjust(15)} aria-label="15 seconds more">+15</button>
      <button class="btn" onClick={() => onChange(null)}>Skip</button>
    </div>
  );
}
