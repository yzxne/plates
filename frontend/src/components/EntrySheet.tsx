// Edit a logged food: full-screen page with measurement chips, a servings stepper, big calorie + macro cards,
// other nutrients, meal chips and Done. Entries without a saved food (quick add, imported) scale by servings,
// and their numbers can be edited directly.
import { useEffect, useState } from 'preact/hooks';
import { MEAL_LABELS, MEALS, makeEntry, roundNutrients, scale, type Food, type LogEntry, type Meal, type Nutrients } from '../../../shared/nutrition';
import { errorMessage } from '../api';
import { deleteEntry, findFood, loadFoods, setFavorite, updateEntry } from '../foodData';
import { fmt } from '../format';
import { showToast } from '../toast';
import { ActionSheet } from './ActionSheet';
import { IconBack } from './Icons';

interface Props {
  entry: LogEntry;
  onClose: () => void;
  onSaved: (e: LogEntry) => void;
  onDeleted: (e: LogEntry) => void;
}

const OZ = 28.3495;
type Mode = 'serving' | 'g' | 'oz';
const r2 = (n: number) => Math.round(n * 100) / 100;

/** "1 bar (60 g)" → "Bar"; "2 tbsp (32 g)" → "2 tbsp"; nothing → "Serving". */
function servingWord(food?: Food): string {
  const s = (food?.serving_size ?? '').split('(')[0]!.trim().replace(/^1\s+/, '');
  return s && s.length <= 14 && !/^\d+(\.\d+)?\s*(g|ml)$/i.test(s) ? s.charAt(0).toUpperCase() + s.slice(1) : 'Serving';
}

function timeLabel(e: LogEntry): string {
  const m = /(\d{1,2}:\d{2}\s*[ap]m)/i.exec(e.entry_method.startsWith('import') ? e.notes : '');
  if (m) return m[1]!.replace(/\s*([ap])m/i, (_x, a: string) => ` ${a.toUpperCase()}M`);
  if (!e.logged_at) return MEAL_LABELS[e.meal];
  return new Date(e.logged_at).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' });
}

export function EntrySheet({ entry, onClose, onSaved, onDeleted }: Props) {
  const [food, setFood] = useState<Food | undefined>(entry.food_id ? findFood(entry.food_id) : undefined);
  const [meal, setMeal] = useState<Meal>(entry.meal);
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const [showMore, setShowMore] = useState(false);

  // With a food: 1 serving = label serving, else the amount you logged. Without: the logged numbers are 1 serving.
  const servingG = food?.grams_per_serving ?? entry.grams ?? 100;
  const [mode, setMode] = useState<Mode>('serving');
  const [amount, setAmount] = useState(() => String(food?.grams_per_serving && entry.grams ? r2(entry.grams / food.grams_per_serving) : 1));
  // Food-less entries: editable base numbers.
  const [base, setBase] = useState<Nutrients>(entry.n);
  const [editNumbers, setEditNumbers] = useState(false);

  useEffect(() => {
    if (entry.food_id && !food) void loadFoods().then(() => {
      const f = findFood(entry.food_id);
      setFood(f);
      if (f?.grams_per_serving && entry.grams) setAmount(String(r2(entry.grams / f.grams_per_serving)));
    });
  }, []);

  // After a unit switch the shown number is rounded; keep the exact grams until you change the number.
  const [pinned, setPinned] = useState<{ text: string; grams: number } | null>(null);
  const value = Math.max(0, Number(amount) || 0);
  const grams = !food ? null : pinned && pinned.text === amount ? pinned.grams
    : mode === 'serving' ? value * servingG : mode === 'oz' ? value * OZ : value;
  const servings = !food ? value : grams! / servingG;
  const n: Nutrients = food && grams ? roundNutrients(scale(food.per100, grams)) : roundNutrients({
    kcal: base.kcal * value, protein_g: base.protein_g * value, carbs_g: base.carbs_g * value, fat_g: base.fat_g * value,
    fiber_g: base.fiber_g == null ? null : base.fiber_g * value, sugar_g: base.sugar_g == null ? null : base.sugar_g * value,
    sodium_mg: base.sodium_mg == null ? null : base.sodium_mg * value,
  });

  function switchMode(m: Mode) {
    if (m === mode || !food || grams == null) return;
    const text = String(m === 'serving' ? r2(grams / servingG) : m === 'oz' ? r2(grams / OZ) : Math.round(grams * 10) / 10);
    setPinned({ text, grams });
    setAmount(text);
    setMode(m);
  }
  const step = (d: number) => setAmount(String(Math.max(0, r2(value + d))));
  const stepSize = mode === 'serving' || !food ? 0.5 : mode === 'oz' ? 0.5 : 10;

  async function save() {
    if (food && !(grams! > 0)) { showToast('Enter an amount above 0', 'error'); return; }
    const updated: LogEntry = food
      ? {
        ...makeEntry({
          id: entry.id, date: entry.date, meal, food, grams: grams!, method: entry.entry_method, notes: entry.notes,
          food_source: entry.food_source, place: entry.place, is_estimate: entry.is_estimate,
        }),
        food_name: entry.food_name, logged_at: entry.logged_at, source_tab: entry.source_tab,
      }
      : { ...entry, meal, n };
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

  const numberField = (k: keyof Nutrients) => (
    <input type="number" inputMode="decimal" aria-label={k} value={String(base[k] ?? '')}
      onInput={(e) => { const v = e.currentTarget.value; setBase((b) => ({ ...b, [k]: v === '' ? (k === 'kcal' || k === 'protein_g' || k === 'carbs_g' || k === 'fat_g' ? 0 : null) : Number(v) })); }} />
  );
  const editing = !food && editNumbers;

  return (
    <div class="overlay entry-edit" role="dialog" aria-modal="true" aria-label="Edit food">
      <header class="overlay-head">
        <button class="icon-btn" aria-label="Back" onClick={onClose}><IconBack /></button>
        <div class="overlay-title center"><strong>Edit food</strong></div>
        <button class="icon-btn more-btn" aria-label="More options" onClick={() => setMenu(true)}>⋯</button>
      </header>

      <div class="overlay-body">
        <span class="time-pill">{timeLabel(entry)}</span>
        <div class="ee-title">
          <div class="grow">
            <h1 class="ee-name">{food?.brand ? entry.food_name.replace(` (${food.brand})`, '') : entry.food_name}{entry.is_estimate && <span class="tag">estimate</span>}</h1>
            {(food?.brand || entry.place) && <p class="muted">{food?.brand || entry.place}</p>}
          </div>
          {food && <button class={`icon-btn star ${food.favorite ? 'on' : ''}`} aria-pressed={!!food.favorite} aria-label="Favorite" onClick={toggleFav}>{food.favorite ? '★' : '☆'}</button>}
        </div>

        {food && (
          <>
            <h3>Measurement</h3>
            <div class="chips">
              <button class={`chip ${mode === 'serving' ? 'on' : ''}`} onClick={() => switchMode('serving')}>{servingWord(food)}</button>
              <button class={`chip ${mode === 'g' ? 'on' : ''}`} onClick={() => switchMode('g')}>G</button>
              <button class={`chip ${mode === 'oz' ? 'on' : ''}`} onClick={() => switchMode('oz')}>Oz</button>
            </div>
          </>
        )}

        <div class="ee-amount">
          <span>{food && mode !== 'serving' ? (mode === 'g' ? 'Grams' : 'Ounces') : 'Number of servings'}</span>
          <div class="stepper">
            <button aria-label="Less" onClick={() => step(-stepSize)}>−</button>
            <input type="number" inputMode="decimal" step="any" aria-label="Amount" value={amount} onInput={(e) => setAmount(e.currentTarget.value)} />
            <button aria-label="More" onClick={() => step(stepSize)}>+</button>
          </div>
        </div>
        <p class="muted tiny-pad">
          {food ? `${fmt(grams ?? 0, 1)} g · ${r2(servings)} × ${servingWord(food).toLowerCase()} (${fmt(servingG, 1)} g)` : 'Numbers as logged = 1 serving'}
        </p>

        <div class="card ee-kcal">
          <span class="ee-flame" aria-hidden="true">🔥</span>
          <div><small class="muted">Calories</small>{editing ? numberField('kcal') : <strong>{fmt(n.kcal)}</strong>}</div>
        </div>
        <div class="ee-macros">
          {([['Protein', 'protein_g', 'p'], ['Carbs', 'carbs_g', 'c'], ['Fat', 'fat_g', 'f']] as const).map(([label, k, cls]) => (
            <div class={`card ee-macro ${cls}`} key={k}>
              <small><i />{label}</small>
              {editing ? numberField(k) : <strong>{fmt(n[k] as number)}g</strong>}
            </div>
          ))}
        </div>

        <button class="row ee-more" onClick={() => setShowMore(!showMore)} aria-expanded={showMore}>
          <span>Other nutrition facts</span><span class={`folder-caret ${showMore ? 'open' : ''}`} aria-hidden="true">›</span>
        </button>
        {showMore && (
          <div class="card ee-facts">
            {([['Fiber', 'fiber_g', 'g'], ['Sugar', 'sugar_g', 'g'], ['Sodium', 'sodium_mg', 'mg']] as const).map(([label, k, unit]) => (
              <div class="ee-fact" key={k}>
                <span>{label}</span>
                {editing ? numberField(k) : <span class="muted">{n[k] == null ? '—' : `${fmt(n[k] as number, unit === 'g' ? 1 : 0)} ${unit}`}</span>}
              </div>
            ))}
          </div>
        )}

        <h3>Meal</h3>
        <div class="chips mb">
          {MEALS.map((m) => <button key={m} class={`chip ${meal === m ? 'on' : ''}`} onClick={() => setMeal(m)}>{MEAL_LABELS[m]}</button>)}
        </div>

        <div class="save-bar">
          <button class="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Done'}</button>
        </div>
      </div>

      {menu && (
        <ActionSheet title={entry.food_name} onClose={() => setMenu(false)} actions={[
          ...(!food ? [{ label: editNumbers ? 'Stop editing numbers' : 'Edit numbers', hint: 'Change calories and macros directly', onClick: () => { if (!editNumbers) { setBase(n); setAmount('1'); } setEditNumbers(!editNumbers); } }] : []),
          { label: 'Delete entry', danger: true, onClick: () => void remove() },
        ]} />
      )}
    </div>
  );
}
