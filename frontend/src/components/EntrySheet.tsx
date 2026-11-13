// Edit a logged food. Same card as Add food: name, amount (servings or grams), calories + macros, meal, Save.
// Entries without a saved food (quick add, AI, imported) scale by servings, and their numbers can be edited directly.
import { useEffect, useState } from 'preact/hooks';
import { MEAL_LABELS, MEALS, makeEntry, roundNutrients, scale, type Food, type LogEntry, type Meal, type Nutrients } from '../../../shared/nutrition';
import { errorMessage } from '../api';
import { deleteEntry, findFood, loadFoods, setFavorite, updateEntry } from '../foodData';
import { showToast } from '../toast';
import { AmountPicker } from './AmountPicker';
import { IconBack } from './Icons';
import { NumInput } from './NumInput';
import { NutrientTable } from './NutrientTable';

interface Props {
  entry: LogEntry;
  onClose: () => void;
  onSaved: (e: LogEntry) => void;
  onDeleted: (e: LogEntry) => void;
}

const QUICK = [[0.5, '½'], [1, '1'], [1.5, '1½'], [2, '2']] as const;
const DRINK_QUICK = [[1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5']] as const;
const perUnit = (n: Nutrients, k: number): Nutrients => ({
  kcal: n.kcal / k, protein_g: n.protein_g / k, carbs_g: n.carbs_g / k, fat_g: n.fat_g / k,
  fiber_g: n.fiber_g == null ? null : n.fiber_g / k, sugar_g: n.sugar_g == null ? null : n.sugar_g / k, sodium_mg: n.sodium_mg == null ? null : n.sodium_mg / k,
});

function timeLabel(e: LogEntry): string {
  const m = /(\d{1,2}:\d{2}\s*[ap]m)/i.exec(e.entry_method.startsWith('import') ? e.notes : '');
  if (m) return m[1]!.replace(/\s*([ap])m/i, (_x, a: string) => ` ${a.toUpperCase()}M`);
  if (!e.logged_at) return '';
  return new Date(e.logged_at).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' });
}

export function EntrySheet({ entry, onClose, onSaved, onDeleted }: Props) {
  const [food, setFood] = useState<Food | undefined>(entry.food_id ? findFood(entry.food_id) : undefined);
  const [loading, setLoading] = useState(!!entry.food_id && !food);
  const [meal, setMeal] = useState<Meal>(entry.meal);
  const [busy, setBusy] = useState(false);

  // With a food: grams. Without: a servings multiplier on the logged numbers (editable as "base").
  const [grams, setGrams] = useState(entry.grams ?? 0);
  // Drinks are counted: the amount is the number of drinks and the base is one drink.
  const isDrink = entry.entry_method === 'drink' && (entry.servings ?? 0) > 0;
  const [times, setTimes] = useState(isDrink ? String(entry.servings) : '1');
  const [base, setBase] = useState<Nutrients>(() => (isDrink ? perUnit(entry.n, entry.servings!) : entry.n));
  const [editNumbers, setEditNumbers] = useState(false);

  useEffect(() => {
    if (entry.food_id && !food) void loadFoods().then(() => { setFood(findFood(entry.food_id)); setLoading(false); });
  }, []);

  const mult = Math.max(0, Number(times) || 0);
  const n: Nutrients = food ? roundNutrients(scale(food.per100, grams)) : roundNutrients({
    kcal: base.kcal * mult, protein_g: base.protein_g * mult, carbs_g: base.carbs_g * mult, fat_g: base.fat_g * mult,
    fiber_g: base.fiber_g == null ? null : base.fiber_g * mult, sugar_g: base.sugar_g == null ? null : base.sugar_g * mult,
    sodium_mg: base.sodium_mg == null ? null : base.sodium_mg * mult,
  });

  async function save() {
    if (food && !(grams > 0)) { showToast('Enter an amount above 0', 'error'); return; }
    if (!food && !(mult > 0)) { showToast('Enter an amount above 0', 'error'); return; }
    const updated: LogEntry = food
      ? {
        ...makeEntry({
          id: entry.id, date: entry.date, meal, food, grams, method: entry.entry_method, notes: entry.notes,
          food_source: entry.food_source, place: entry.place, is_estimate: entry.is_estimate,
        }),
        food_name: entry.food_name, logged_at: entry.logged_at, source_tab: entry.source_tab,
        group_id: entry.group_id, group_name: entry.group_name,
      }
      : { ...entry, meal, n, ...(isDrink ? { servings: mult } : {}) };
    setBusy(true);
    try {
      const ok = await updateEntry(updated);
      showToast(ok ? 'Saved' : 'Not saved yet — will retry', ok ? 'ok' : 'error');
      onSaved(updated);
    } catch (err) {
      showToast(errorMessage(err), 'error');
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
      setBusy(false);
    }
  }

  async function toggleFav() {
    if (!food) return;
    try { setFood(await setFavorite(food, !food.favorite)); } catch (err) { showToast(errorMessage(err), 'error'); }
  }

  const numberField = (k: keyof Nutrients, label: string, unit: string) => (
    <div class="field" key={k}>
      <label>{label}</label>
      <div class="with-unit">
        <NumInput aria-label={label} value={base[k] as number | null | undefined}
          onValue={(v) => setBase((b) => ({ ...b, [k]: v ?? (k === 'kcal' || k === 'protein_g' || k === 'carbs_g' || k === 'fat_g' ? 0 : null) }))} />
        <span class="unit">{unit}</span>
      </div>
    </div>
  );

  const name = food?.brand ? entry.food_name.replace(` (${food.brand})`, '') : entry.food_name;
  const sub = [food?.brand || entry.place, timeLabel(entry), entry.group_id ? `Part of ${entry.group_name || 'a combo'}` : ''].filter(Boolean).join(' · ');

  return (
    <div class="overlay" role="dialog" aria-modal="true" aria-label="Edit food">
      <header class="overlay-head">
        <button class="icon-btn" aria-label="Back" onClick={onClose}><IconBack /></button>
        <div class="overlay-title"><strong>Edit food</strong><small class="muted">{MEAL_LABELS[entry.meal]}</small></div>
      </header>

      <div class="overlay-body">
        <div class="card">
          <div class="ex-head">
            <h2 class="no-margin grow">{name}{entry.is_estimate && <span class="tag">estimate</span>}</h2>
            {food && <button class={`icon-btn star ${food.favorite ? 'on' : ''}`} aria-pressed={!!food.favorite} aria-label="Favorite" onClick={toggleFav}>{food.favorite ? '★' : '☆'}</button>}
          </div>
          {sub && <p class="muted">{sub}</p>}

          {loading ? <p class="muted">Loading…</p> : food ? (
            <AmountPicker food={food} usualGrams={food.grams_per_serving ?? entry.grams ?? 100} initialGrams={entry.grams ?? food.grams_per_serving ?? 100} onChange={setGrams} id="edit-amount" />
          ) : (
            <div class="field amount">
              <label for="edit-times">Amount</label>
              <div class="with-unit">
                <input id="edit-times" type="text" inputMode="decimal" value={times} onInput={(e) => setTimes(e.currentTarget.value)} />
                <span class="unit">{isDrink ? (mult === 1 ? 'drink' : 'drinks') : '× as logged'}</span>
              </div>
              <div class="chips amount-chips" role="group" aria-label="Quick amounts">
                {(isDrink ? DRINK_QUICK : QUICK).map(([v, label]) => <button type="button" key={label} class={`chip ${mult === v ? 'on' : ''}`} onClick={() => setTimes(String(v))}>{label}</button>)}
              </div>
            </div>
          )}

          {!loading && <NutrientTable n={n} />}

          {!food && !loading && (
            editNumbers ? (
              <div class="form mt">
                <p class="muted tiny">{isDrink ? 'Numbers for 1 drink.' : 'Numbers for 1 × as logged.'}</p>
                {numberField('kcal', 'Calories', 'kcal')}
                {numberField('protein_g', 'Protein', 'g')}
                {numberField('carbs_g', 'Carbs', 'g')}
                {numberField('fat_g', 'Fat', 'g')}
                {numberField('fiber_g', 'Fiber', 'g')}
                {numberField('sugar_g', 'Sugar', 'g')}
                {numberField('sodium_mg', 'Sodium', 'mg')}
              </div>
            ) : (
              <button class="btn link" onClick={() => { if (!isDrink) { setBase(n); setTimes('1'); } setEditNumbers(true); }}>Edit numbers</button>
            )
          )}
        </div>

        {!entry.group_id && (
          <>
            <h3 class="group-label">Meal</h3>
            <div class="seg full mb">
              {MEALS.map((m) => <button key={m} class={meal === m ? 'on' : ''} onClick={() => setMeal(m)}>{MEAL_LABELS[m]}</button>)}
            </div>
          </>
        )}

        <button class="btn primary" disabled={busy || loading} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
        <button class="btn link danger center" disabled={busy} onClick={remove}>Delete entry</button>
      </div>
    </div>
  );
}
