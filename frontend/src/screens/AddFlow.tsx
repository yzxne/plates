import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { parseLabel, type ParsedLabel } from '../../../shared/labelParser';
import {
  MEAL_LABELS, MEALS, makeEntry, per100FromServing, roundNutrients, type Food, type LogEntry, type Meal, type Nutrients,
} from '../../../shared/nutrition';
import { api, errorMessage } from '../api';
import { IconBack, IconChevron, IconClose } from '../components/Icons';
import { dateLabel } from '../dates';
import { lookupBarcode } from '../barcodeLookup';
import { BarcodeScanner } from '../components/BarcodeScanner';
import { addEntry, cachedFoods, loadFoods, saveFood, uuid } from '../foodData';
import { fmt, foodSummary, macroLine, sourceLabel } from '../format';
import { showToast } from '../toast';

type View =
  | { kind: 'menu' }
  | { kind: 'search' }
  | { kind: 'label'; barcode?: string; manual?: boolean }
  | { kind: 'quick' }
  | { kind: 'scan' }
  | { kind: 'barcode'; code: string }
  | { kind: 'notfound'; code: string; errors: string[] }
  | { kind: 'detail'; food: Food; method: string };

interface Props {
  date: string;
  meal: Meal;
  onClose: () => void;
  onLogged: () => void;
}

export function AddFlow({ date, meal: initialMeal, onClose, onLogged }: Props) {
  const [view, setView] = useState<View>({ kind: 'menu' });
  const [meal, setMeal] = useState<Meal>(initialMeal);
  const [search, setSearch] = useState<SearchState>({ q: '', usda: null, off: null }); // kept when you go back from a food

  const back = () => {
    switch (view.kind) {
      case 'detail': setView(view.method === 'search' ? { kind: 'search' } : view.method === 'barcode' ? { kind: 'scan' } : { kind: 'menu' }); break;
      case 'barcode': case 'notfound': setView({ kind: 'scan' }); break;
      case 'label': setView(view.barcode ? { kind: 'notfound', code: view.barcode, errors: [] } : { kind: 'menu' }); break;
      default: setView({ kind: 'menu' });
    }
  };

  async function logged(entry: LogEntry, ok: boolean) {
    showToast(ok ? `Logged ${entry.food_name}` : 'Not saved yet — kept and will retry', ok ? 'ok' : 'error');
    onLogged();
    onClose();
  }

  return (
    <div class="overlay" role="dialog" aria-modal="true" aria-label="Add food">
      <header class="overlay-head">
        {view.kind === 'menu'
          ? <button class="icon-btn" aria-label="Close" onClick={onClose}><IconClose /></button>
          : <button class="icon-btn" aria-label="Back" onClick={back}><IconBack /></button>}
        <div class="overlay-title">
          <strong>Add food</strong>
          <small class="muted">{dateLabel(date)}</small>
        </div>
        <select class="meal-select" aria-label="Meal" value={meal} onChange={(e) => setMeal(e.currentTarget.value as Meal)}>
          {MEALS.map((m) => <option key={m} value={m}>{MEAL_LABELS[m]}</option>)}
        </select>
      </header>

      <div class="overlay-body">
        {view.kind === 'menu' && <Menu go={setView} />}
        {view.kind === 'search' && <Search state={search} setState={setSearch} onPick={(food) => setView({ kind: 'detail', food, method: 'search' })} />}
        {view.kind === 'detail' && <Detail food={view.food} method={view.method} date={date} meal={meal} onLogged={logged} />}
        {view.kind === 'label' && (
          <LabelPaste barcode={view.barcode} manual={view.manual}
            onSaved={(food) => setView({ kind: 'detail', food, method: view.barcode ? 'barcode' : view.manual ? 'manual' : 'label' })} />
        )}
        {view.kind === 'scan' && <BarcodeScanner onCode={(code) => setView({ kind: 'barcode', code })} />}
        {view.kind === 'barcode' && (
          <BarcodeLookup code={view.code}
            onFound={(food) => setView({ kind: 'detail', food, method: 'barcode' })}
            onMissing={(errors) => setView({ kind: 'notfound', code: view.code, errors })} />
        )}
        {view.kind === 'notfound' && <NotFound code={view.code} errors={view.errors} go={setView} />}
        {view.kind === 'quick' && <QuickAdd date={date} meal={meal} onLogged={logged} />}
      </div>
    </div>
  );
}

// ---------- Menu ----------

function Menu({ go }: { go: (v: View) => void }) {
  const rows: { label: string; hint: string; view?: View; phase?: number }[] = [
    { label: 'Search foods', hint: 'Saved foods, USDA, Open Food Facts', view: { kind: 'search' } },
    { label: 'Paste label text', hint: 'Copy a nutrition label with Live Text', view: { kind: 'label' } },
    { label: 'Quick add', hint: 'Just calories (and macros)', view: { kind: 'quick' } },
    { label: 'Scan barcode', hint: 'Camera, photo or typed number', view: { kind: 'scan' } },
    { label: 'AI meal scan', hint: '', phase: 6 },
    { label: 'Paste AI result', hint: '', phase: 6 },
  ];
  return (
    <div class="list card">
      {rows.map((r) => r.view ? (
        <button class="row" key={r.label} onClick={() => go(r.view!)}>
          <span class="row-text"><span>{r.label}</span><small class="muted">{r.hint}</small></span>
          <IconChevron size={18} />
        </button>
      ) : (
        <div class="row disabled" key={r.label}><span>{r.label}</span><small>Phase {r.phase}</small></div>
      ))}
    </div>
  );
}

// ---------- Barcode ----------

function BarcodeLookup({ code, onFound, onMissing }: { code: string; onFound: (f: Food) => void; onMissing: (errors: string[]) => void }) {
  const [step, setStep] = useState('Looking up…');
  useEffect(() => {
    let alive = true;
    void lookupBarcode(code, (s) => alive && setStep(s)).then((r) => {
      if (!alive) return;
      if (r.food) onFound(r.food);
      else onMissing(r.errors);
    });
    return () => { alive = false; };
  }, [code]);
  return (
    <div class="card center">
      <p><strong>{code}</strong></p>
      <p class="muted">{step}</p>
    </div>
  );
}

function NotFound({ code, errors, go }: { code: string; errors: string[]; go: (v: View) => void }) {
  return (
    <div>
      <div class="card">
        <h2>Not found</h2>
        <p class="muted">No saved food, Open Food Facts or USDA product has barcode <strong>{code}</strong>.</p>
        {errors.length > 0 && (
          <>
            <p class="warn">Some sources couldn't be checked:</p>
            <ul class="warn-list">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
          </>
        )}
        <p class="muted">Add it once and it will be found instantly next time.</p>
      </div>
      <div class="list card">
        <button class="row" onClick={() => go({ kind: 'label', barcode: code })}>
          <span class="row-text"><span>Paste or scan the label</span><small class="muted">Live Text / Scan Text</small></span>
          <IconChevron size={18} />
        </button>
        <button class="row" onClick={() => go({ kind: 'label', barcode: code, manual: true })}>
          <span class="row-text"><span>Enter manually</span><small class="muted">Type the numbers from the label</small></span>
          <IconChevron size={18} />
        </button>
        {errors.length > 0 && (
          <button class="row" onClick={() => go({ kind: 'barcode', code })}><span>Try the lookup again</span><IconChevron size={18} /></button>
        )}
        <button class="row" onClick={() => go({ kind: 'scan' })}><span>Scan again</span><IconChevron size={18} /></button>
      </div>
    </div>
  );
}

// ---------- Search ----------

interface SearchState { q: string; usda: Food[] | null; off: Food[] | null }

function Search({ state, setState, onPick }: { state: SearchState; setState: (fn: (s: SearchState) => SearchState) => void; onPick: (f: Food) => void }) {
  const { q, usda, off } = state;
  const setQ = (v: string) => setState(() => ({ q: v, usda: null, off: null }));
  const setUsda = (v: Food[]) => setState((s) => ({ ...s, usda: v, off: null }));
  const setOff = (v: Food[]) => setState((s) => ({ ...s, off: v }));
  const [saved, setSaved] = useState<Food[]>(cachedFoods());
  const [busy, setBusy] = useState<'' | 'usda' | 'off'>('');
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    loadFoods().then(setSaved).catch((err) => setError(errorMessage(err)));
  }, []);

  const savedMatches = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const list = words.length
      ? saved.filter((f) => words.every((w) => `${f.name} ${f.brand}`.toLowerCase().includes(w)))
      : saved;
    return list.slice(0, words.length ? 20 : 10);
  }, [q, saved]);

  async function run(source: 'usda' | 'off') {
    const query = q.trim();
    if (query.length < 2) return;
    setBusy(source);
    setError('');
    try {
      const r = await api<{ foods: Food[] }>('GET', `/food/search?source=${source}&q=${encodeURIComponent(query)}`);
      if (source === 'usda') setUsda(r.foods); else setOff(r.foods);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy('');
    }
  }

  return (
    <>
      <form class="search-bar" onSubmit={(e) => { e.preventDefault(); void run('usda'); }}>
        <input ref={input} type="search" placeholder="Search foods" value={q} enterKeyHint="search"
          onInput={(e) => setQ(e.currentTarget.value)} />
        <button class="btn" type="submit" disabled={q.trim().length < 2 || !!busy}>Search</button>
      </form>
      {error && <p class="error">{error}</p>}

      <ResultList title={q.trim() ? 'Your saved foods' : 'Recent saved foods'} foods={savedMatches} onPick={onPick}
        empty={q.trim() ? 'No saved food matches.' : 'Foods you log are saved here for next time.'} />

      {busy === 'usda' && <p class="muted center">Searching USDA…</p>}
      {usda && <ResultList title="USDA FoodData Central" foods={usda} onPick={onPick} empty="No USDA results." />}

      {usda && !off && (
        <button class="btn center-block" disabled={!!busy} onClick={() => run('off')}>
          {busy === 'off' ? 'Searching…' : 'Search Open Food Facts too'}
        </button>
      )}
      {off && <ResultList title="Open Food Facts" foods={off} onPick={onPick} empty="No Open Food Facts results." note="Data © Open Food Facts contributors, ODbL" />}
    </>
  );
}

function ResultList({ title, foods, onPick, empty, note }: { title: string; foods: Food[]; onPick: (f: Food) => void; empty: string; note?: string }) {
  return (
    <section class="results">
      <h3>{title}</h3>
      {foods.length === 0 && <p class="muted tiny-pad">{empty}</p>}
      {foods.length > 0 && (
        <div class="list card">
          {foods.map((f, i) => (
            <button class="row" key={`${f.source}-${f.id || f.source_id}-${i}`} onClick={() => onPick(f)}>
              <span class="row-text">
                <span class="clip">{f.name}</span>
                <small class="muted clip">{[f.brand, foodSummary(f)].filter(Boolean).join(' · ')}</small>
              </span>
              <IconChevron size={18} />
            </button>
          ))}
        </div>
      )}
      {note && <p class="muted tiny">{note}</p>}
    </section>
  );
}

// ---------- Detail ----------

function Detail({ food, method, date, meal, onLogged }: { food: Food; method: string; date: string; meal: Meal; onLogged: (e: LogEntry, ok: boolean) => void }) {
  const hasServing = !!food.grams_per_serving;
  const [unit, setUnit] = useState<'g' | 'serving'>(hasServing ? 'serving' : 'g');
  const [amount, setAmount] = useState(hasServing ? '1' : '100');
  const [busy, setBusy] = useState(false);

  const value = Number(amount);
  const grams = unit === 'serving' ? value * (food.grams_per_serving ?? 0) : value;
  const preview = grams > 0 ? makeEntry({ id: 'preview', date, meal, food, grams, method }) : null;

  function switchUnit(u: 'g' | 'serving') {
    if (u === unit || !food.grams_per_serving) return;
    setAmount(u === 'g' ? String(Math.round(grams * 10) / 10) : String(Math.round((grams / food.grams_per_serving) * 100) / 100));
    setUnit(u);
  }

  async function log() {
    if (!preview) return;
    setBusy(true);
    try {
      const saved = await saveFood(food);
      const entry = makeEntry({ id: uuid(), date, meal, food: saved, grams, method: food.id ? 'saved' : method });
      const ok = await addEntry(entry);
      onLogged(entry, ok);
    } catch (err) {
      showToast(errorMessage(err), 'error');
      setBusy(false);
    }
  }

  return (
    <div>
      <div class="card">
        <h2 class="no-margin">{food.name}</h2>
        <p class="muted">{[food.brand, sourceLabel(food)].filter(Boolean).join(' · ')}</p>
        {food.serving_size && <p class="muted tiny-pad">Serving: {food.serving_size}</p>}

        <div class="field">
          <label for="amount">Amount</label>
          <div class="with-unit">
            <input id="amount" type="number" inputMode="decimal" min="0" step="any" value={amount} onInput={(e) => setAmount(e.currentTarget.value)} />
            {hasServing ? (
              <div class="seg">
                <button type="button" class={unit === 'g' ? 'on' : ''} onClick={() => switchUnit('g')}>g</button>
                <button type="button" class={unit === 'serving' ? 'on' : ''} onClick={() => switchUnit('serving')}>serving</button>
              </div>
            ) : <span class="unit">g</span>}
          </div>
          {unit === 'serving' && grams > 0 && <small class="muted">= {fmt(grams, 1)} g</small>}
        </div>

        {preview && <NutrientTable n={preview.n} />}
        {food.source === 'off' && <p class="muted tiny">Data © Open Food Facts contributors, ODbL</p>}
        {food.source === 'usda' && <p class="muted tiny">Source: USDA FoodData Central</p>}
      </div>
      <button class="btn primary" disabled={!preview || busy} onClick={log}>{busy ? 'Logging…' : `Log to ${MEAL_LABELS[meal]}`}</button>
    </div>
  );
}

function NutrientTable({ n }: { n: Nutrients }) {
  return (
    <div class="nutrients">
      <div class="kcal"><strong>{fmt(n.kcal)}</strong> kcal</div>
      <div class="macro-grid">
        <div><strong>{fmt(n.protein_g, 1)}</strong><span>Protein g</span></div>
        <div><strong>{fmt(n.carbs_g, 1)}</strong><span>Carbs g</span></div>
        <div><strong>{fmt(n.fat_g, 1)}</strong><span>Fat g</span></div>
      </div>
      <small class="muted">Fiber {fmt(n.fiber_g, 1)} g · Sugar {fmt(n.sugar_g, 1)} g · Sodium {fmt(n.sodium_mg)} mg</small>
    </div>
  );
}

// ---------- Paste label ----------

type LabelForm = Record<'name' | 'brand' | 'servingText' | 'servingGrams' | 'kcal' | 'protein_g' | 'carbs_g' | 'fat_g' | 'fiber_g' | 'sugar_g' | 'sodium_mg', string>;

function fromParsed(p: ParsedLabel): LabelForm {
  const s = (v: number | null) => (v == null ? '' : String(v));
  return {
    name: '', brand: '', servingText: p.servingText ?? '', servingGrams: s(p.servingGrams),
    kcal: s(p.kcal), protein_g: s(p.protein_g), carbs_g: s(p.carbs_g), fat_g: s(p.fat_g),
    fiber_g: s(p.fiber_g), sugar_g: s(p.sugar_g), sodium_mg: s(p.sodium_mg),
  };
}

const EMPTY_LABEL: ParsedLabel = {
  basis: 'serving', servingText: null, servingGrams: null, kcal: null, protein_g: null, carbs_g: null, fat_g: null,
  fiber_g: null, sugar_g: null, sodium_mg: null, warnings: [],
};

function LabelPaste({ onSaved, barcode, manual }: { onSaved: (f: Food) => void; barcode?: string; manual?: boolean }) {
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<ParsedLabel | null>(manual ? EMPTY_LABEL : null);
  const [form, setForm] = useState<LabelForm | null>(manual ? fromParsed(EMPTY_LABEL) : null);
  const [busy, setBusy] = useState(false);

  function read() {
    const p = parseLabel(text);
    setParsed(p);
    setForm(fromParsed(p));
  }

  const set = (k: keyof LabelForm) => (e: Event) => setForm((f) => (f ? { ...f, [k]: (e.currentTarget as HTMLInputElement).value } : f));

  async function save() {
    if (!form || !parsed) return;
    const num = (v: string) => (v.trim() === '' ? null : Number(v));
    const grams = num(form.servingGrams);
    const req = [num(form.kcal), num(form.protein_g), num(form.carbs_g), num(form.fat_g)];
    if (!form.name.trim()) { showToast('Give the food a name', 'error'); return; }
    if (req.some((v) => v == null || !Number.isFinite(v) || v < 0)) { showToast('Calories, protein, carbs and fat are required', 'error'); return; }
    if (!grams || grams <= 0) { showToast('Serving size in grams is required', 'error'); return; }
    const values: Nutrients = {
      kcal: req[0]!, protein_g: req[1]!, carbs_g: req[2]!, fat_g: req[3]!,
      fiber_g: num(form.fiber_g), sugar_g: num(form.sugar_g), sodium_mg: num(form.sodium_mg),
    };
    const per100 = parsed.basis === 'per100g' ? values : per100FromServing(values, grams);
    const food: Food = {
      name: form.name.trim(), brand: form.brand.trim(), source: manual ? 'manual' : 'label', source_id: '', barcode: barcode ?? '',
      serving_size: parsed.basis === 'per100g' ? '' : (form.servingText.trim() || `${grams} g`),
      grams_per_serving: parsed.basis === 'per100g' ? null : grams,
      per100: roundNutrients(per100),
    };
    setBusy(true);
    try {
      const saved = await saveFood(food);
      showToast('Food saved', 'ok');
      onSaved(saved);
    } catch (err) {
      showToast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!form || !parsed) {
    return (
      <div class="card">
        <p class="muted"><strong>Scan it live:</strong> tap the box below twice → <strong>Scan Text</strong> (may show as a small icon or under ›) → point at the label → <strong>Insert</strong>.</p>
        <p class="muted"><strong>Too dark?</strong> Scan Text has no flash. Take the photo with the iPhone Camera app (flash on), open it in Photos, press and hold the text → <strong>Select All</strong> → <strong>Copy</strong>, then paste here.</p>
        <textarea rows={10} placeholder="Paste label text" value={text} onInput={(e) => setText(e.currentTarget.value)} />
        <button class="btn primary" disabled={text.trim().length < 10} onClick={read}>Read label</button>
      </div>
    );
  }

  const field = (k: keyof LabelForm, label: string, opts: { unit?: string; numeric?: boolean } = {}) => (
    <div class="field">
      <label for={`lf-${k}`}>{label}</label>
      <div class="with-unit">
        {opts.numeric
          ? <input id={`lf-${k}`} type="number" inputMode="decimal" step="any" value={form[k]} onInput={set(k)} />
          : <input id={`lf-${k}`} type="text" value={form[k]} onInput={set(k)} />}
        {opts.unit && <span class="unit">{opts.unit}</span>}
      </div>
    </div>
  );

  return (
    <div class="card form">
      <h2>{manual ? 'Enter the label' : 'Check the numbers'}</h2>
      {barcode && <p class="muted">Will be saved with barcode {barcode}.</p>}
      <p class="muted">{parsed.basis === 'per100g' ? 'Values are per 100 g.' : 'Values are per serving.'}</p>
      {parsed.warnings.length > 0 && <ul class="warn-list">{parsed.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
      {field('name', 'Name')}
      {field('brand', 'Brand (optional)')}
      {parsed.basis === 'serving' && field('servingText', 'Serving description')}
      {parsed.basis === 'serving' && field('servingGrams', 'Serving size', { unit: 'g', numeric: true })}
      {field('kcal', 'Calories', { unit: 'kcal', numeric: true })}
      {field('protein_g', 'Protein', { unit: 'g', numeric: true })}
      {field('carbs_g', 'Carbs', { unit: 'g', numeric: true })}
      {field('fat_g', 'Fat', { unit: 'g', numeric: true })}
      {field('fiber_g', 'Fiber (optional)', { unit: 'g', numeric: true })}
      {field('sugar_g', 'Sugar (optional)', { unit: 'g', numeric: true })}
      {field('sodium_mg', 'Sodium (optional)', { unit: 'mg', numeric: true })}
      <button class="btn primary" disabled={busy} onClick={save}>Save food</button>
      <button class="btn link center" onClick={() => { setParsed(null); setForm(null); }}>Paste again</button>
    </div>
  );
}

// ---------- Quick add ----------

function QuickAdd({ date, meal, onLogged }: { date: string; meal: Meal; onLogged: (e: LogEntry, ok: boolean) => void }) {
  const [name, setName] = useState('');
  const [kcal, setKcal] = useState('');
  const [p, setP] = useState('');
  const [c, setC] = useState('');
  const [f, setF] = useState('');
  const [busy, setBusy] = useState(false);

  async function log() {
    const k = Number(kcal);
    if (!(k > 0)) { showToast('Enter calories', 'error'); return; }
    const entry: LogEntry = {
      id: uuid(), date, meal, food_id: '', food_name: name.trim() || 'Quick add', grams: null, servings: 1,
      n: roundNutrients({ kcal: k, protein_g: Number(p) || 0, carbs_g: Number(c) || 0, fat_g: Number(f) || 0, fiber_g: null, sugar_g: null, sodium_mg: null }),
      entry_method: 'quick', notes: '',
    };
    setBusy(true);
    try {
      onLogged(entry, await addEntry(entry));
    } catch (err) {
      showToast(errorMessage(err), 'error');
      setBusy(false);
    }
  }

  return (
    <div class="card form">
      <div class="field"><label for="qa-name">Name (optional)</label><input id="qa-name" value={name} onInput={(e) => setName(e.currentTarget.value)} /></div>
      <div class="field"><label for="qa-k">Calories</label><div class="with-unit"><input id="qa-k" type="number" inputMode="decimal" value={kcal} onInput={(e) => setKcal(e.currentTarget.value)} /><span class="unit">kcal</span></div></div>
      <div class="grid3">
        <div class="field"><label for="qa-p">Protein g</label><input id="qa-p" type="number" inputMode="decimal" value={p} onInput={(e) => setP(e.currentTarget.value)} /></div>
        <div class="field"><label for="qa-c">Carbs g</label><input id="qa-c" type="number" inputMode="decimal" value={c} onInput={(e) => setC(e.currentTarget.value)} /></div>
        <div class="field"><label for="qa-f">Fat g</label><input id="qa-f" type="number" inputMode="decimal" value={f} onInput={(e) => setF(e.currentTarget.value)} /></div>
      </div>
      <button class="btn primary" disabled={busy || !(Number(kcal) > 0)} onClick={log}>Log to {MEAL_LABELS[meal]}</button>
    </div>
  );
}
