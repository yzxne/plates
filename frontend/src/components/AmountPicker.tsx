// Serving-first amount: "1 serving · 52 g" with ½ / 1 / 1½ / 2 / 3 buttons; grams are one tap away.
// A "serving" is the label serving if the food has one, otherwise your usual amount for it.
import { useEffect, useState } from 'preact/hooks';
import type { Food } from '../../../shared/nutrition';
import { fmt } from '../format';

const QUICK = [[0.5, '½'], [1, '1'], [1.5, '1½'], [2, '2'], [3, '3']] as const;

export function servingGramsFor(food: Food, usual: number): { grams: number; label: string } {
  if (food.grams_per_serving) return { grams: food.grams_per_serving, label: food.serving_size || 'label serving' };
  return { grams: usual, label: 'your usual amount' };
}

export function AmountPicker({ food, usualGrams, initialGrams, onChange, id = 'amount' }: {
  food: Food; usualGrams: number; initialGrams: number; onChange: (grams: number) => void; id?: string;
}) {
  const serving = servingGramsFor(food, usualGrams);
  const [unit, setUnit] = useState<'serving' | 'g'>('serving');
  const [text, setText] = useState(() => String(round2(initialGrams / serving.grams)));
  const value = Number(text);
  const grams = unit === 'serving' ? value * serving.grams : value;

  useEffect(() => { onChange(grams > 0 ? grams : 0); }, [grams]);

  function switchUnit(u: 'serving' | 'g') {
    if (u === unit) return;
    setText(u === 'g' ? String(Math.round(grams * 10) / 10) : String(round2(grams / serving.grams)));
    setUnit(u);
  }

  return (
    <div class="field amount">
      <label for={id}>Amount</label>
      <div class="with-unit">
        <input id={id} type="number" inputMode="decimal" min="0" step="any" value={text} onInput={(e) => setText(e.currentTarget.value)} />
        <div class="seg">
          <button type="button" class={unit === 'serving' ? 'on' : ''} onClick={() => switchUnit('serving')}>{value === 1 && unit === 'serving' ? 'serving' : 'servings'}</button>
          <button type="button" class={unit === 'g' ? 'on' : ''} onClick={() => switchUnit('g')}>g</button>
        </div>
      </div>
      {unit === 'serving' && (
        <div class="chips amount-chips" role="group" aria-label="Quick amounts">
          {QUICK.map(([n, label]) => (
            <button type="button" key={label} class={`chip ${value === n ? 'on' : ''}`} onClick={() => setText(String(n))}>{label}</button>
          ))}
        </div>
      )}
      <small class="muted">
        {unit === 'serving'
          ? <>{grams > 0 ? `${fmt(grams, 1)} g` : '—'} · 1 serving = {fmt(serving.grams, 1)} g ({serving.label})</>
          : <>= {grams > 0 ? round2(grams / serving.grams) : 0} serving{round2(grams / serving.grams) === 1 ? '' : 's'}</>}
      </small>
    </div>
  );
}

const round2 = (n: number) => Math.round(n * 100) / 100;
