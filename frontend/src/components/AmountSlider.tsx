// Drag to set an amount precisely; the marks underneath are one-tap shortcuts (½, 1, 1½…).
// The range grows if you type a bigger number, but stays put while you drag.
import { useState } from 'preact/hooks';

export function AmountSlider({ value, onChange, max, step, min = 0, marks, label }: {
  value: number; onChange: (v: number) => void; max: number; step: number; min?: number;
  marks: readonly (readonly [number, string])[]; label: string;
}) {
  const [top, setTop] = useState(() => Math.max(max, Math.ceil((value || 0) * 1.25)));
  const hi = value > top ? Math.ceil(value * 1.25) : top;
  if (hi !== top) setTop(hi);
  const decimals = (String(step).split('.')[1] ?? '').length;
  const pct = (v: number) => ((v - min) / (hi - min)) * 100;
  const v = Math.min(hi, Math.max(min, value || 0));
  return (
    <div class="amount-slider">
      <input type="range" aria-label={label} min={min} max={hi} step={step} value={v}
        style={{ '--fill': `${pct(v)}%` }}
        onInput={(e) => onChange(Number(Number(e.currentTarget.value).toFixed(decimals)))} />
      <div class="slider-marks">
        {marks.filter(([m]) => m >= min && m <= hi).map(([m, text]) => (
          <button type="button" key={text} class={Math.abs(v - m) < step / 2 ? 'on' : ''} style={{ left: `${pct(m)}%` }} onClick={() => onChange(m)}>{text}</button>
        ))}
      </div>
    </div>
  );
}
