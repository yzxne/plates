// Drinks: standard pours, counted with − / +, logged as one row per kind ("Beer · 3 drinks").
// Numbers are typical US servings; alcohol's own calories (7 kcal/g) are in kcal but not in any macro.
import { useState } from 'preact/hooks';
import { MEAL_LABELS, roundNutrients, type LogEntry, type Meal, type Nutrients } from '../../../shared/nutrition';
import { errorMessage } from '../api';
import { addEntry, deleteEntry, uuid } from '../foodData';
import { fmt } from '../format';
import { showToast } from '../toast';
import { showUndo } from '../undo';

interface Drink { id: string; name: string; pour: string; kcal: number; carbs: number; protein: number }

export const DRINKS: Drink[] = [
  { id: 'shot', name: 'Shot', pour: '1.5 oz liquor', kcal: 97, carbs: 0, protein: 0 },
  { id: 'beer', name: 'Beer', pour: '12 oz regular', kcal: 153, carbs: 13, protein: 1.6 },
  { id: 'light', name: 'Light beer', pour: '12 oz', kcal: 103, carbs: 6, protein: 0.9 },
  { id: 'ipa', name: 'IPA / craft beer', pour: '12 oz', kcal: 200, carbs: 16, protein: 2 },
  { id: 'seltzer', name: 'Hard seltzer', pour: '12 oz can', kcal: 100, carbs: 2, protein: 0 },
  { id: 'wine', name: 'Wine', pour: '5 oz glass', kcal: 123, carbs: 4, protein: 0.1 },
  { id: 'mixed', name: 'Mixed drink', pour: 'Shot + soda or juice', kcal: 180, carbs: 21, protein: 0 },
  { id: 'cocktail', name: 'Sweet cocktail', pour: 'Margarita, daiquiri…', kcal: 250, carbs: 26, protein: 0 },
];

const per = (d: Drink): Nutrients => ({ kcal: d.kcal, protein_g: d.protein, carbs_g: d.carbs, fat_g: 0, fiber_g: null, sugar_g: null, sodium_mg: null });

export function DrinkList({ date, meal, onLogged }: { date: string; meal: Meal; onLogged: () => void }) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const bump = (id: string, d: number) => setCounts((c) => ({ ...c, [id]: Math.max(0, (c[id] ?? 0) + d) }));
  const picked = DRINKS.filter((d) => (counts[d.id] ?? 0) > 0);
  const total = picked.reduce((s, d) => s + d.kcal * counts[d.id]!, 0);
  const drinks = picked.reduce((s, d) => s + counts[d.id]!, 0);

  async function log() {
    setBusy(true);
    const done: LogEntry[] = [];
    let ok = true;
    try {
      for (const d of picked) {
        const n = counts[d.id]!;
        const p = per(d);
        const e: LogEntry = {
          id: uuid(), date, meal, food_id: '', food_name: d.name, grams: null, servings: n,
          n: roundNutrients({ ...p, kcal: p.kcal * n, protein_g: p.protein_g * n, carbs_g: p.carbs_g * n }),
          entry_method: 'drink', notes: d.pour, food_source: '', place: '', is_estimate: false,
        };
        ok = (await addEntry(e)) && ok;
        done.push(e);
      }
      setCounts({});
      onLogged();
      showUndo(`${ok ? 'Logged' : 'Queued'} ${drinks} drink${drinks === 1 ? '' : 's'} · ${fmt(total)} kcal · ${MEAL_LABELS[meal]}`, {
        undo: async () => { for (const e of done) await deleteEntry(e); onLogged(); },
      });
    } catch (err) {
      showToast(errorMessage(err), 'error');
      if (done.length) onLogged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p class="muted tiny-pad">Count them up, then log. Standard pours; change the count later by tapping the entry.</p>
      <div class="list card">
        {DRINKS.map((d) => {
          const n = counts[d.id] ?? 0;
          return (
            <div class="row drink-row" key={d.id}>
              <span class="row-text"><span>{d.name}</span><small class="muted">{d.pour} · {d.kcal} kcal</small></span>
              <div class="drink-count">
                <button type="button" aria-label={`One less ${d.name}`} disabled={!n} onClick={() => bump(d.id, -1)}>−</button>
                <span aria-live="polite">{n}</span>
                <button type="button" aria-label={`One more ${d.name}`} onClick={() => bump(d.id, 1)}>+</button>
              </div>
            </div>
          );
        })}
      </div>
      <button class="btn primary mt" disabled={!drinks || busy} onClick={log}>
        {busy ? 'Logging…' : drinks ? `Log ${drinks} drink${drinks === 1 ? '' : 's'} · ${fmt(total)} kcal` : 'Log drinks'}
      </button>
    </>
  );
}
