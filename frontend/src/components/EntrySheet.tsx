import { useEffect, useState } from 'preact/hooks';
import { MEAL_LABELS, MEALS, makeEntry, roundNutrients, type Food, type LogEntry, type Meal } from '../../../shared/nutrition';
import { errorMessage } from '../api';
import { deleteEntry, findFood, loadFoods, updateEntry } from '../foodData';
import { fmt, macroLine } from '../format';
import { showToast } from '../toast';
import { AmountPicker } from './AmountPicker';
import { IconClose } from './Icons';

interface Props {
  entry: LogEntry;
  onClose: () => void;
  onSaved: (e: LogEntry) => void;
  onDeleted: (e: LogEntry) => void;
}

/** Edit amount/meal of a logged item, or delete it. */
export function EntrySheet({ entry, onClose, onSaved, onDeleted }: Props) {
  const [food, setFood] = useState<Food | undefined>(entry.food_id ? findFood(entry.food_id) : undefined);
  const [meal, setMeal] = useState<Meal>(entry.meal);
  const [grams, setGrams] = useState(entry.grams ?? 0);
  // Quick-add entries (no saved food): edit the numbers directly.
  const [kcal, setKcal] = useState(String(entry.n.kcal));
  const [p, setP] = useState(String(entry.n.protein_g));
  const [c, setC] = useState(String(entry.n.carbs_g));
  const [f, setF] = useState(String(entry.n.fat_g));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (entry.food_id && !food) void loadFoods().then(() => setFood(findFood(entry.food_id)));
  }, []);

  const preview: LogEntry | null = food && grams > 0
    ? {
      ...makeEntry({
        id: entry.id, date: entry.date, meal, food, grams, method: entry.entry_method, notes: entry.notes,
        food_source: entry.food_source, place: entry.place, is_estimate: entry.is_estimate,
      }),
      food_name: entry.food_name, logged_at: entry.logged_at,
    }
    : null;

  async function save() {
    let updated: LogEntry;
    if (food) {
      if (!preview) { showToast('Enter an amount above 0', 'error'); return; }
      updated = preview;
    } else {
      const n = roundNutrients({ kcal: Number(kcal) || 0, protein_g: Number(p) || 0, carbs_g: Number(c) || 0, fat_g: Number(f) || 0, fiber_g: entry.n.fiber_g, sugar_g: entry.n.sugar_g, sodium_mg: entry.n.sodium_mg });
      updated = { ...entry, meal, n };
    }
    setBusy(true);
    try {
      const ok = await updateEntry(updated);
      showToast(ok ? 'Saved' : 'Not saved yet — will retry', ok ? 'ok' : 'error');
      onSaved(updated);
    } catch (err) {
      showToast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete "${entry.food_name}" from this day?`)) return;
    setBusy(true);
    try {
      const ok = await deleteEntry(entry);
      showToast(ok ? 'Deleted' : 'Delete queued — will retry', ok ? 'info' : 'error');
      onDeleted(entry);
    } catch (err) {
      showToast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="sheet-backdrop" onClick={onClose}>
      <div class="sheet" role="dialog" aria-modal="true" aria-label="Edit entry" onClick={(e) => e.stopPropagation()}>
        <div class="sheet-head">
          <h2 class="clip">{entry.food_name}</h2>
          <button class="icon-btn" aria-label="Close" onClick={onClose}><IconClose /></button>
        </div>

        {food && (
          <>
            <AmountPicker id="amt" food={food} usualGrams={entry.grams ?? food.grams_per_serving ?? 100} initialGrams={entry.grams ?? food.grams_per_serving ?? 100} onChange={setGrams} />
            {preview && <p class="muted tiny-pad">{fmt(preview.n.kcal)} kcal · {macroLine(preview.n)}</p>}
          </>
        )}

        {!food && (
          <div class="grid4">
            <div class="field"><label for="qk">kcal</label><input id="qk" type="number" inputMode="decimal" value={kcal} onInput={(e) => setKcal(e.currentTarget.value)} /></div>
            <div class="field"><label for="qp">Protein</label><input id="qp" type="number" inputMode="decimal" value={p} onInput={(e) => setP(e.currentTarget.value)} /></div>
            <div class="field"><label for="qc">Carbs</label><input id="qc" type="number" inputMode="decimal" value={c} onInput={(e) => setC(e.currentTarget.value)} /></div>
            <div class="field"><label for="qf">Fat</label><input id="qf" type="number" inputMode="decimal" value={f} onInput={(e) => setF(e.currentTarget.value)} /></div>
          </div>
        )}

        <div class="field">
          <label for="meal">Meal</label>
          <select id="meal" value={meal} onChange={(e) => setMeal(e.currentTarget.value as Meal)}>
            {MEALS.map((m) => <option key={m} value={m}>{MEAL_LABELS[m]}</option>)}
          </select>
        </div>

        <button class="btn primary" disabled={busy} onClick={save}>Save</button>
        <button class="btn link danger center" disabled={busy} onClick={remove}>Delete entry</button>
      </div>
    </div>
  );
}
