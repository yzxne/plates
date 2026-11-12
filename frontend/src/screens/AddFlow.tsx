import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { parseLabel, type ParsedLabel } from '../../../shared/labelParser';
import {
  MEAL_LABELS, MEALS, makeEntry, per100FromServing, roundNutrients, type Food, type LogEntry, type Meal, type Nutrients,
} from '../../../shared/nutrition';
import { api, errorMessage } from '../api';
import { lookupBarcode } from '../barcodeLookup';
import { BarcodeScanner } from '../components/BarcodeScanner';
import { AiEstimate, type AiMode } from './AiEstimate';
import { EntrySheet } from '../components/EntrySheet';
import { IconBack, IconChevron, IconClose } from '../components/Icons';
import { dateLabel, today } from '../dates';
import {
  addEntry, cachedFoods, defaultGrams, deleteEntry, loadFoods, loadRecents, loadSavedMeals, rememberGrams, saveFood, setFavorite, uuid,
  type RecentFood, type SavedMeal,
} from '../foodData';
import { fmt, foodSummary, macroLine, sourceLabel } from '../format';
import { showToast } from '../toast';
import { showUndo } from '../undo';
import { SkeletonRows } from '../components/Skeleton';

type View =
  | { kind: 'home' }
  | { kind: 'label'; barcode?: string; manual?: boolean }
  | { kind: 'quick' }
  | { kind: 'scan' }
  | { kind: 'barcode'; code: string }
  | { kind: 'notfound'; code: string; errors: string[] }
  | { kind: 'detail'; food: Food; method: string }
  | { kind: 'ai'; mode: AiMode; text?: string };

interface Props {
  date: string;
  meal: Meal;
  onClose: () => void;
  onLogged: () => void; // something was logged/changed — Today reloads; the add screen stays open
}

/** One add screen (brief v2 §5): search bar with barcode/AI buttons, Recent + Favorites, one-tap logging with Undo. */
export function AddFlow({ date, meal: initialMeal, onClose, onLogged }: Props) {
  const [view, setView] = useState<View>({ kind: 'home' });
  const [meal, setMeal] = useState<Meal>(initialMeal);
  const [search, setSearch] = useState<SearchState>({ q: '', usda: null, off: null });
  const [editing, setEditing] = useState<LogEntry | null>(null);

  const back = () => {
    switch (view.kind) {
      case 'barcode': case 'notfound': setView({ kind: 'scan' }); break;
      case 'label': setView(view.barcode ? { kind: 'notfound', code: view.barcode, errors: [] } : { kind: 'home' }); break;
      default: setView({ kind: 'home' });
    }
  };

  /** Logs `grams` of a food right away and shows Undo / Edit. */
  async function quickLog(food: Food, grams: number, method: string) {
    try {
      const saved = await saveFood(food);
      const entry = makeEntry({ id: uuid(), date, meal, food: saved, grams, method });
      const ok = await addEntry(entry);
      rememberGrams(saved, grams);
      onLogged();
      showUndo(`${ok ? 'Logged' : 'Queued'} ${entry.food_name} · ${fmt(grams, 1)} g · ${MEAL_LABELS[meal]}`, {
        undo: async () => { await deleteEntry(entry); onLogged(); },
        edit: () => setEditing(entry),
      });
    } catch (err) {
      showToast(errorMessage(err), 'error');
    }
  }

  function logged(entry: LogEntry, ok: boolean, food?: Food) {
    if (food && entry.grams) rememberGrams(food, entry.grams);
    onLogged();
    setView({ kind: 'home' });
    showUndo(`${ok ? 'Logged' : 'Queued'} ${entry.food_name}`, {
      undo: async () => { await deleteEntry(entry); onLogged(); },
      edit: () => setEditing(entry),
    });
  }

  return (
    <div class="overlay" role="dialog" aria-modal="true" aria-label="Add food">
      <header class="overlay-head">
        {view.kind === 'home'
          ? <button class="icon-btn" aria-label="Close" onClick={onClose}><IconClose /></button>
          : <button class="icon-btn" aria-label="Back" onClick={back}><IconBack /></button>}
        <div class="overlay-title">
          <strong>Add food</strong>
          <small class="muted">{dateLabel(date)}</small>
        </div>
        <select class="meal-chip" aria-label="Meal" value={meal} onChange={(e) => setMeal(e.currentTarget.value as Meal)}>
          {MEALS.map((m) => <option key={m} value={m}>{MEAL_LABELS[m]}</option>)}
        </select>
      </header>

      <div class="overlay-body">
        {view.kind === 'home' && (
          <Home state={search} setState={setSearch} date={date} meal={meal} go={setView}
            onQuickLog={(f, g) => quickLog(f, g, 'recent')} onOpen={(food) => setView({ kind: 'detail', food, method: 'search' })}
            onLogged={onLogged} />
        )}
        {view.kind === 'detail' && <Detail food={view.food} method={view.method} date={date} meal={meal} onLogged={logged} />}
        {view.kind === 'label' && (
          <LabelPaste barcode={view.barcode} manual={view.manual}
            onSaved={(food) => setView({ kind: 'detail', food, method: view.barcode ? 'barcode' : view.manual ? 'manual' : 'label' })} />
        )}
        {view.kind === 'scan' && <BarcodeScanner onCode={(code) => setView({ kind: 'barcode', code })} />}
        {view.kind === 'barcode' && (
          <BarcodeLookup code={view.code}
            onFound={(food) => { setView({ kind: 'home' }); void quickLog(food, defaultGrams(food), 'barcode'); }}
            onMissing={(errors) => setView({ kind: 'notfound', code: view.code, errors })} />
        )}
        {view.kind === 'notfound' && <NotFound code={view.code} errors={view.errors} go={setView} />}
        {view.kind === 'ai' && (
          <AiEstimate key={view.mode + (view.text ?? '')} mode={view.mode} initialText={view.text} date={date} meal={meal}
            onOpenFood={(food) => setView({ kind: 'detail', food, method: 'search' })}
            onDone={() => setView({ kind: 'home' })} onChanged={onLogged} />
        )}
        {view.kind === 'quick' && <QuickAdd date={date} meal={meal} onLogged={(e, ok) => logged(e, ok)} />}
      </div>

      {editing && (
        <EntrySheet entry={editing} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); onLogged(); }}
          onDeleted={() => { setEditing(null); onLogged(); }} />
      )}
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

// ---------- Home: search + Recent / Favorites / Saved meals ----------

interface SearchState { q: string; usda: Food[] | null; off: Food[] | null }

function Home({ state, setState, date, meal, go, onQuickLog, onOpen, onLogged }: {
  state: SearchState; setState: (fn: (s: SearchState) => SearchState) => void; date: string; meal: Meal;
  go: (v: View) => void; onQuickLog: (f: Food, grams: number) => void; onOpen: (f: Food) => void; onLogged: () => void;
}) {
  const { q, usda, off } = state;
  const setQ = (v: string) => setState(() => ({ q: v, usda: null, off: null }));
  const [saved, setSaved] = useState<Food[]>(cachedFoods());
  const [recents, setRecents] = useState<RecentFood[] | null>(null);
  const [savedMeals, setSavedMeals] = useState<SavedMeal[]>([]);
  const [list, setList] = useState<'recent' | 'favorites'>('recent');
  const [busy, setBusy] = useState<'' | 'usda' | 'off'>('');
  const [error, setError] = useState('');

  useEffect(() => {
    loadFoods().then(setSaved).catch((err) => setError(errorMessage(err)));
    loadRecents(today()).then(setRecents).catch(() => setRecents([]));
    loadSavedMeals().then(setSavedMeals).catch(() => {});
  }, []);

  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const savedMatches = useMemo(
    () => (words.length ? saved.filter((f) => words.every((w) => `${f.name} ${f.brand}`.toLowerCase().includes(w))).slice(0, 20) : []),
    [q, saved],
  );
  const favorites = saved.filter((f) => f.favorite);

  async function run(source: 'usda' | 'off') {
    const query = q.trim();
    if (query.length < 2) return;
    setBusy(source);
    setError('');
    try {
      const r = await api<{ foods: Food[] }>('GET', `/food/search?source=${source}&q=${encodeURIComponent(query)}`);
      setState((s) => (source === 'usda' ? { ...s, usda: r.foods, off: null } : { ...s, off: r.foods }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy('');
    }
  }

  async function logSavedMeal(m: SavedMeal) {
    try {
      const foods = new Map((await loadFoods()).map((f) => [f.id!, f]));
      const entries = m.items.flatMap((it) => {
        const f = foods.get(it.food_id);
        return f ? [makeEntry({ id: uuid(), date, meal, food: f, grams: it.grams, method: 'saved_meal' })] : [];
      });
      for (const e of entries) await addEntry(e);
      onLogged();
      showUndo(`Logged ${m.name} · ${MEAL_LABELS[meal]}`, { undo: async () => { for (const e of entries) await deleteEntry(e); onLogged(); } });
    } catch (err) {
      showToast(errorMessage(err), 'error');
    }
  }

  return (
    <>
      <form class="search-bar" onSubmit={(e) => { e.preventDefault(); void run('usda'); }}>
        <div class="search-field">
          <input type="search" placeholder="Search foods" value={q} enterKeyHint="search" onInput={(e) => setQ(e.currentTarget.value)} />
          <button type="button" class="sb-btn" aria-label="Scan barcode" onClick={() => go({ kind: 'scan' })}><BarcodeIcon /></button>
          <button type="button" class="sb-btn" aria-label="AI photo scan" onClick={() => go({ kind: 'ai', mode: 'photo', text: q.trim() })}><CameraIcon /></button>
          <button type="button" class="sb-btn" aria-label="Estimate with AI" onClick={() => go({ kind: 'ai', mode: 'text', text: q.trim() })}><SparkIcon /></button>
        </div>
      </form>
      {error && <p class="error">{error}</p>}

      {!words.length && (
        <>
          <div class="seg mb">
            <button class={list === 'recent' ? 'on' : ''} onClick={() => setList('recent')}>Recent</button>
            <button class={list === 'favorites' ? 'on' : ''} onClick={() => setList('favorites')}>Favorites</button>
          </div>
          <p class="muted tiny-pad">Tap to log your usual amount · press and hold to change it first.</p>
          {list === 'recent' && (
            recents === null ? <SkeletonRows rows={4} />
              : recents.length === 0 ? <p class="muted">Foods you log show up here.</p>
                : <FoodRows foods={recents.map((r) => r.food)} gramsFor={(f) => defaultGrams(f)} onTap={(f) => onQuickLog(f, defaultGrams(f))} onHold={onOpen} />
          )}
          {list === 'favorites' && (
            favorites.length === 0 ? <p class="muted">Star a food on its detail screen to keep it here.</p>
              : <FoodRows foods={favorites} gramsFor={(f) => defaultGrams(f)} onTap={(f) => onQuickLog(f, defaultGrams(f))} onHold={onOpen} />
          )}

          {savedMeals.length > 0 && (
            <section class="results">
              <h3>Saved meals</h3>
              <div class="list card">
                {savedMeals.map((m) => (
                  <button class="row" key={m.id} onClick={() => logSavedMeal(m)}>
                    <span class="row-text"><span>{m.name}</span><small class="muted">{m.items.length} items · tap to log</small></span>
                  </button>
                ))}
              </div>
            </section>
          )}

          <section class="results">
            <h3>Other ways</h3>
            <div class="list card">
              <button class="row" onClick={() => go({ kind: 'label' })}><span class="row-text"><span>Paste or scan label text</span><small class="muted">Live Text / Scan Text</small></span><IconChevron size={18} /></button>
              <button class="row" onClick={() => go({ kind: 'quick' })}><span class="row-text"><span>Quick add</span><small class="muted">Just calories (and macros)</small></span><IconChevron size={18} /></button>
              <button class="row" onClick={() => go({ kind: 'ai', mode: 'paste' })}><span class="row-text"><span>Paste AI result</span><small class="muted">From the Claude or Gemini app (no API cost)</small></span><IconChevron size={18} /></button>
            </div>
          </section>
        </>
      )}

      {words.length > 0 && (
        <>
          <section class="results">
            <h3>Your foods</h3>
            {savedMatches.length === 0 ? <p class="muted tiny-pad">No saved food matches. Press Search for USDA.</p>
              : <FoodRows foods={savedMatches} gramsFor={(f) => defaultGrams(f)} onTap={(f) => onQuickLog(f, defaultGrams(f))} onHold={onOpen} />}
          </section>
          {!usda && busy !== 'usda' && <button class="btn center-block" onClick={() => run('usda')} disabled={q.trim().length < 2}>Search USDA</button>}
          {busy === 'usda' && <p class="muted center">Searching USDA…</p>}
          {usda && <ResultList title="USDA FoodData Central" foods={usda} onPick={onOpen} empty="No USDA results." />}
          {usda && !off && (
            <button class="btn center-block" disabled={!!busy} onClick={() => run('off')}>{busy === 'off' ? 'Searching…' : 'Search Open Food Facts too'}</button>
          )}
          {off && <ResultList title="Open Food Facts" foods={off} onPick={onOpen} empty="No Open Food Facts results." note="Data © Open Food Facts contributors, ODbL" />}
          <button class="btn center-block" onClick={() => go({ kind: 'ai', mode: 'text', text: q.trim() })}>Estimate "{q.trim()}" with AI</button>
        </>
      )}
    </>
  );
}

/** Rows for foods you have logged before: tap = log now, press-and-hold = open the amount screen. */
function FoodRows({ foods, gramsFor, onTap, onHold }: { foods: Food[]; gramsFor: (f: Food) => number; onTap: (f: Food) => void; onHold: (f: Food) => void }) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const held = useRef(false);
  const press = (f: Food) => ({
    onPointerDown: () => { held.current = false; timer.current = setTimeout(() => { held.current = true; onHold(f); }, 500); },
    onPointerUp: () => clearTimeout(timer.current),
    onPointerLeave: () => clearTimeout(timer.current),
    onPointerCancel: () => clearTimeout(timer.current),
    onClick: () => { if (!held.current) onTap(f); },
    onContextMenu: (e: Event) => e.preventDefault(),
  });
  return (
    <div class="list card">
      {foods.map((f) => {
        const g = gramsFor(f);
        const kcal = (f.per100.kcal * g) / 100;
        return (
          <button class="row food-row" key={f.id} {...press(f)}>
            <span class="row-text">
              <span class="clip">{f.favorite ? '★ ' : ''}{f.name}</span>
              <small class="muted clip">{[f.brand, `${fmt(g, 1)} g · ${fmt(kcal)} kcal`].filter(Boolean).join(' · ')}</small>
            </span>
            <span class="plus-chip" aria-hidden="true">+</span>
          </button>
        );
      })}
    </div>
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

const BarcodeIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
    <path d="M4 6v12M7 6v12M10 6v12M14 6v12M16.5 6v12M20 6v12" />
  </svg>
);
const CameraIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M4 8h3l2-2.5h6L17 8h3v11H4z" /><circle cx="12" cy="13.5" r="3.5" />
  </svg>
);
const SparkIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /><path d="M19 16l.7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z" />
  </svg>
);

// ---------- Detail ----------

function Detail({ food: initial, method, date, meal, onLogged }: { food: Food; method: string; date: string; meal: Meal; onLogged: (e: LogEntry, ok: boolean, food?: Food) => void }) {
  const [food, setFood] = useState(initial);
  const hasServing = !!food.grams_per_serving;
  const startGrams = defaultGrams(food);
  const [unit, setUnit] = useState<'g' | 'serving'>(hasServing ? 'serving' : 'g');
  const [amount, setAmount] = useState(hasServing ? String(Math.round((startGrams / food.grams_per_serving!) * 100) / 100) : String(startGrams));
  const [busy, setBusy] = useState(false);

  const value = Number(amount);
  const grams = unit === 'serving' ? value * (food.grams_per_serving ?? 0) : value;
  const preview = grams > 0 ? makeEntry({ id: 'preview', date, meal, food, grams, method }) : null;

  function switchUnit(u: 'g' | 'serving') {
    if (u === unit || !food.grams_per_serving) return;
    setAmount(u === 'g' ? String(Math.round(grams * 10) / 10) : String(Math.round((grams / food.grams_per_serving) * 100) / 100));
    setUnit(u);
  }

  async function toggleFavorite() {
    try {
      const next = await setFavorite(food, !food.favorite);
      setFood(next);
      showToast(next.favorite ? 'Added to Favorites' : 'Removed from Favorites', 'info');
    } catch (err) {
      showToast(errorMessage(err), 'error');
    }
  }

  async function log() {
    if (!preview) return;
    setBusy(true);
    try {
      const saved = await saveFood(food);
      const entry = makeEntry({ id: uuid(), date, meal, food: saved, grams, method: food.id && method === 'search' ? 'saved' : method });
      const ok = await addEntry(entry);
      onLogged(entry, ok, saved);
    } catch (err) {
      showToast(errorMessage(err), 'error');
      setBusy(false);
    }
  }

  return (
    <div>
      <div class="card">
        <div class="ex-head">
          <h2 class="no-margin grow">{food.name}</h2>
          <button class={`icon-btn star ${food.favorite ? 'on' : ''}`} aria-pressed={!!food.favorite} aria-label="Favorite" onClick={toggleFavorite}>{food.favorite ? '★' : '☆'}</button>
        </div>
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
      entry_method: 'quick', notes: '', food_source: '', place: '', is_estimate: false,
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
