// Plate calculator: which plates to load on each side for a target weight.
import { useState } from 'preact/hooks';
import { platesPerSide } from '../../../shared/training';
import { fmt } from '../format';

const BARS = [[45, 'Barbell 45'], [35, 'Bar 35'], [25, 'EZ bar 25'], [0, 'Plates only']] as const;

export function PlateCalc({ initial, onClose }: { initial: number | null; onClose: () => void }) {
  const [weight, setWeight] = useState(initial ? String(initial) : '');
  const [bar, setBar] = useState(45);
  const total = Number(weight) || 0;
  const { plates, left } = platesPerSide(total, bar);
  return (
    <div class="sheet-backdrop" onClick={onClose}>
      <div class="sheet" role="dialog" aria-modal="true" aria-label="Plate calculator" onClick={(e) => e.stopPropagation()}>
        <h2>Plates per side</h2>
        <div class="with-unit mb">
          <input type="number" inputMode="decimal" step="any" aria-label="Total weight" value={weight} onInput={(e) => setWeight(e.currentTarget.value)} />
          <span class="unit">lb</span>
        </div>
        <div class="chips mb">
          {BARS.map(([b, label]) => <button key={b} class={`chip ${bar === b ? 'on' : ''}`} onClick={() => setBar(b)}>{label}</button>)}
        </div>
        {total > bar ? (
          <>
            <div class="plates" aria-label={`Each side: ${plates.join(', ')} lb`}>
              {plates.map((p, i) => <span key={i} class={`plate p${String(p).replace('.', '_')}`}>{fmt(p, 1)}</span>)}
            </div>
            <p class="tiny muted">{plates.length ? `Each side: ${plates.map((p) => fmt(p, 1)).join(' + ')} lb` : 'No plates needed.'}
              {left > 0 ? ` · ${fmt(left * 2, 2)} lb short of ${fmt(total, 1)} (closest you can load: ${fmt(total - left * 2, 1)}).` : ''}</p>
          </>
        ) : <p class="muted tiny">Enter a weight above the bar.</p>}
        <button class="btn" style="width:100%" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
