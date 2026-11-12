// AI meal scan / text estimate / paste-AI flow (brief §6 / §6A).
// The AI only gives item names + grams. Calories always come from the matched saved or USDA food.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { correctGrams, correctionFor } from '../../../shared/accuracy';
import { pastePrompt, validateAiResult, type AiItem, type EstimateContext, type OilLevel, type Portion, type Source } from '../../../shared/ai';
import { MEAL_LABELS, type Food, type LogEntry, type Meal } from '../../../shared/nutrition';
import {
  chainLookup, estimateText, lastPlace, lastSource, loadPortions, logAiItem, matchFood, portionsFor, rememberChoice,
  saveUsualPortion, scanMeal, searchUsda, usualFor, type UsualPortion,
} from '../aiData';
import { ApiError, errorMessage } from '../api';
import { IconChevron } from '../components/Icons';
import { cachedFoods, deleteEntry } from '../foodData';
import { fmt, foodSummary, sourceLabel } from '../format';
import { resizePhoto, type ResizedImage } from '../imageResize';
import { getSettings } from '../settingsStore';
import { showToast } from '../toast';
import { showUndo } from '../undo';

export type AiMode = 'photo' | 'text' | 'paste';

const SOURCES: { v: Source; label: string }[] = [
  { v: 'restaurant', label: 'Restaurant' }, { v: 'cafeteria', label: 'Cafeteria' }, { v: 'homemade', label: 'Homemade' },
];
const PORTIONS: { v: Portion | 'grams'; label: string }[] = [
  { v: 'small', label: 'Small' }, { v: 'regular', label: 'Regular' }, { v: 'large', label: 'Large' }, { v: 'grams', label: 'Grams' },
];
const OILS: { v: OilLevel; label: string }[] = [{ v: 'light', label: 'Light' }, { v: 'normal', label: 'Normal' }, { v: 'heavy', label: 'Heavy' }];

const METHOD: Record<AiMode, string> = { photo: 'ai_photo', text: 'ai_text', paste: 'ai_paste' };

interface Props {
  mode: AiMode;
  initialText?: string;
  date: string;
  meal: Meal;
  onOpenFood: (f: Food) => void;
  onDone: () => void; // logged → back to the add screen
  onChanged: () => void; // Today reloads
}

export function AiEstimate({ mode: initialMode, initialText = '', date, meal, onOpenFood, onDone, onChanged }: Props) {
  const settings = getSettings();
  const [mode, setMode] = useState<AiMode>(initialMode);
  const [source, setSource] = useState<Source>(lastSource());
  const [place, setPlace] = useState(() => lastPlace(lastSource(), settings.cafeteria_name ?? ''));
  const [portion, setPortion] = useState<Portion | 'grams'>('');
  const [portionGrams, setPortionGrams] = useState('');
  const [oil, setOil] = useState<OilLevel>('');
  const [description, setDescription] = useState(initialText);
  const [ingredients, setIngredients] = useState<{ name: string; grams: string }[]>([{ name: '', grams: '' }]);
  const [photos, setPhotos] = useState<{ top: ResizedImage | null; side: ResizedImage | null }>({ top: null, side: null });
  const [portions, setPortions] = useState<UsualPortion[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState<{ text: string; capReached?: boolean } | null>(null);
  const [chain, setChain] = useState<Food[] | null>(null);
  const [pasted, setPasted] = useState('');
  const [review, setReview] = useState<{ items: AiItem[]; skipped?: string[]; cost?: number; month?: number; cap?: number } | null>(null);

  useEffect(() => { loadPortions().then(setPortions).catch(() => {}); }, []);

  function pickSource(s: Source) {
    setSource(s);
    setPlace(lastPlace(s, settings.cafeteria_name ?? ''));
    setChain(null);
  }

  const knownHere = useMemo(() => portionsFor(portions, place), [portions, place]);
  const places = useMemo(() => [...new Set([settings.cafeteria_name, ...portions.map((p) => p.place)].filter(Boolean))], [portions]);

  function context(): EstimateContext {
    const plate = Number(settings.plate_diameter_in);
    return {
      source, place: place.trim(),
      portion: portion === 'grams' ? '' : portion,
      portionGrams: portion === 'grams' && Number(portionGrams) > 0 ? Number(portionGrams) : null,
      oil,
      plateIn: mode === 'photo' && plate > 0 ? plate : null,
      hasSide: mode === 'photo' && !!photos.side,
      knownPortions: knownHere.map((p) => ({ label: p.label, grams: p.grams })),
      ingredients: source === 'homemade'
        ? ingredients.filter((i) => i.name.trim()).map((i) => ({ name: i.name.trim(), grams: Number(i.grams) > 0 ? Number(i.grams) : null }))
        : [],
    };
  }

  async function addPhoto(which: 'top' | 'side', file: File | undefined) {
    if (!file) return;
    setBusy('Preparing photo…');
    setError(null);
    try {
      const img = await resizePhoto(file);
      setPhotos((p) => ({ ...p, [which]: img }));
    } catch (err) {
      setError({ text: errorMessage(err) });
    } finally {
      setBusy('');
    }
  }

  async function estimate(skipChain = false) {
    setError(null);
    rememberChoice(source, place.trim());
    const desc = description.trim();
    if (mode === 'text' && desc.length < 3) { setError({ text: 'Describe the food first (e.g. "chicken fried steak with gravy").' }); return; }
    if (mode === 'photo' && !photos.top) { setError({ text: 'Add a top-down photo first.' }); return; }
    try {
      if (mode === 'text' && source === 'restaurant' && place.trim() && !skipChain && chain === null) {
        setBusy(`Checking ${place.trim()} menu items…`);
        const hits = await chainLookup(place.trim(), desc);
        setChain(hits);
        if (hits.length) return;
      }
      setBusy(mode === 'photo' ? 'Looking at your photo…' : 'Estimating…');
      const r = mode === 'photo'
        ? await scanMeal([photos.top!, ...(photos.side ? [photos.side] : [])], desc, context())
        : await estimateText(desc, context());
      setReview({ items: r.items, skipped: r.skipped, cost: r.cost_usd, month: r.month_total, cap: r.cap });
    } catch (err) {
      const cap = err instanceof ApiError && (err.code === 'ai_cap_reached' || err.code === 'ai_not_configured' || err.code === 'ai_no_credit');
      setError({ text: errorMessage(err), capReached: cap });
    } finally {
      setBusy('');
    }
  }

  const prompt = pastePrompt(mode === 'paste' || mode === 'text' ? description.trim() : '', { ...context(), plateIn: Number(settings.plate_diameter_in) || null });

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt);
      showToast('Prompt copied — paste it into the Claude or Gemini app', 'info');
    } catch {
      showToast("Couldn't copy. Press and hold the prompt to select it.", 'error');
    }
  }

  function readPasted() {
    const v = validateAiResult(pasted);
    if (!v.ok) { setError({ text: v.error }); return; }
    setError(null);
    rememberChoice(source, place.trim());
    setReview({ items: v.items, skipped: v.skipped });
  }

  if (review) {
    return (
      <AiReview items={review.items} skipped={review.skipped ?? []} cost={review.cost} month={review.month} cap={review.cap} source={source} place={place.trim()}
        portions={knownHere} date={date} meal={meal} method={METHOD[mode]} onBack={() => setReview(null)} onDone={onDone} onChanged={onChanged} />
    );
  }

  return (
    <div>
      <div class="seg mb full">
        <button class={mode === 'photo' ? 'on' : ''} onClick={() => setMode('photo')}>Photo</button>
        <button class={mode === 'text' ? 'on' : ''} onClick={() => setMode('text')}>Describe</button>
        <button class={mode === 'paste' ? 'on' : ''} onClick={() => setMode('paste')}>Paste AI</button>
      </div>

      {mode === 'photo' && (
        <div class="card">
          <h3 class="no-margin">Photos</h3>
          <p class="muted tiny-pad">Top-down, whole plate in frame. A side photo helps with height (optional).</p>
          <div class="photo-row">
            <PhotoSlot label="Top-down" required img={photos.top} onPick={(f) => addPhoto('top', f)} onClear={() => setPhotos((p) => ({ ...p, top: null }))} />
            <PhotoSlot label="Side" img={photos.side} onPick={(f) => addPhoto('side', f)} onClear={() => setPhotos((p) => ({ ...p, side: null }))} />
          </div>
          <div class="field">
            <label for="ai-note">Note (optional)</label>
            <input id="ai-note" placeholder="e.g. gravy on the side" value={description} onInput={(e) => setDescription(e.currentTarget.value)} />
          </div>
        </div>
      )}

      {(mode === 'text' || mode === 'paste') && (
        <div class="card">
          <div class="field no-mb">
            <label for="ai-desc">What did you eat?</label>
            <textarea id="ai-desc" rows={2} maxLength={500} placeholder="e.g. chicken fried steak with gravy and mashed potatoes"
              value={description} onInput={(e) => { setDescription(e.currentTarget.value); setChain(null); }} />
          </div>
        </div>
      )}

      <div class="card">
        <label class="lbl">Where from</label>
        <div class="chips mb">
          {SOURCES.map((s) => <button key={s.v} type="button" class={`chip ${source === s.v ? 'on' : ''}`} onClick={() => pickSource(s.v)}>{s.label}</button>)}
        </div>
        {source !== 'homemade' && (
          <div class="field">
            <label for="ai-place">{source === 'cafeteria' ? 'Cafeteria' : 'Restaurant'}</label>
            <input id="ai-place" list="ai-places" placeholder={source === 'cafeteria' ? 'e.g. McMindes dining hall' : 'e.g. Golden Corral'}
              value={place} onInput={(e) => { setPlace(e.currentTarget.value); setChain(null); }} />
            <datalist id="ai-places">{places.map((p) => <option key={p} value={p} />)}</datalist>
            {knownHere.length > 0 && <small class="muted">{knownHere.length} usual portion{knownHere.length > 1 ? 's' : ''} saved here — used automatically.</small>}
          </div>
        )}

        <label class="lbl">Portion</label>
        <div class="chips mb">
          {PORTIONS.map((p) => (
            <button key={p.v} type="button" class={`chip ${portion === p.v ? 'on' : ''}`} onClick={() => setPortion(portion === p.v ? '' : p.v)}>{p.label}</button>
          ))}
        </div>
        {portion === 'grams' && (
          <div class="field">
            <div class="with-unit">
              <input type="number" inputMode="decimal" aria-label="Total grams" placeholder="Total weight" value={portionGrams} onInput={(e) => setPortionGrams(e.currentTarget.value)} />
              <span class="unit">g</span>
            </div>
          </div>
        )}

        <label class="lbl">Oil / butter</label>
        <div class="chips">
          {OILS.map((o) => <button key={o.v} type="button" class={`chip ${oil === o.v ? 'on' : ''}`} onClick={() => setOil(oil === o.v ? '' : o.v)}>{o.label}</button>)}
        </div>

        {source === 'homemade' && (
          <div class="ingredients">
            <label class="lbl">Ingredients (optional)</label>
            <p class="muted tiny-pad">Fill in grams you know. The AI only estimates the blanks.</p>
            {ingredients.map((ing, i) => (
              <div class="ing-row" key={i}>
                <input placeholder="Ingredient" aria-label={`Ingredient ${i + 1}`} value={ing.name}
                  onInput={(e) => { const v = e.currentTarget.value; setIngredients((list) => list.map((x, j) => (j === i ? { ...x, name: v } : x))); }} />
                <input type="number" inputMode="decimal" placeholder="g" aria-label={`Grams for ingredient ${i + 1}`} value={ing.grams}
                  onInput={(e) => { const v = e.currentTarget.value; setIngredients((list) => list.map((x, j) => (j === i ? { ...x, grams: v } : x))); }} />
              </div>
            ))}
            {ingredients.length < 20 && <button type="button" class="btn link" onClick={() => setIngredients((l) => [...l, { name: '', grams: '' }])}>+ Add ingredient</button>}
          </div>
        )}
      </div>

      {error && (
        <div class="card warn">
          <p class="no-margin">{error.text}</p>
          {error.capReached && mode !== 'paste' && <button class="btn mt" onClick={() => { setMode('paste'); setError(null); }}>Use Paste AI instead</button>}
        </div>
      )}

      {chain && chain.length > 0 && (
        <section class="results">
          <h3>Menu matches</h3>
          <p class="muted tiny-pad">Chain nutrition is more accurate than an estimate. Tap one if it matches.</p>
          <div class="list card">
            {chain.map((f, i) => (
              <button class="row" key={`${f.source_id}-${i}`} onClick={() => onOpenFood(f)}>
                <span class="row-text"><span class="clip">{f.name}</span><small class="muted clip">{[f.brand, foodSummary(f)].filter(Boolean).join(' · ')}</small></span>
                <IconChevron size={18} />
              </button>
            ))}
          </div>
          <button class="btn center-block" onClick={() => estimate(true)} disabled={!!busy}>Not listed — estimate with AI</button>
        </section>
      )}

      {mode === 'paste' ? (
        <>
          <div class="card">
            <h3 class="no-margin">1. Copy the prompt</h3>
            <p class="muted tiny-pad">Paste it into the Claude or Gemini app (attach your photo there if you have one).</p>
            <pre class="prompt-box">{prompt}</pre>
            <button class="btn" onClick={copyPrompt}>Copy prompt</button>
          </div>
          <div class="card">
            <h3 class="no-margin">2. Paste the answer</h3>
            <textarea rows={5} aria-label="AI answer" placeholder='{"items":[...]}' value={pasted} onInput={(e) => setPasted(e.currentTarget.value)} />
            <button class="btn primary mt" disabled={!pasted.trim()} onClick={readPasted}>Read answer</button>
          </div>
        </>
      ) : (
        !(chain && chain.length > 0) && (
          <button class="btn primary" disabled={!!busy} onClick={() => estimate()}>
            {busy || (mode === 'photo' ? 'Estimate from photo' : 'Estimate with AI')}
          </button>
        )
      )}
      {busy && mode === 'paste' && <p class="muted center">{busy}</p>}
      <p class="muted tiny">AI gives portion sizes only; calories come from USDA or your saved foods. Results are estimates.</p>
    </div>
  );
}

function PhotoSlot({ label, required, img, onPick, onClear }: {
  label: string; required?: boolean; img: ResizedImage | null; onPick: (f: File | undefined) => void; onClear: () => void;
}) {
  return (
    <div class="photo-slot">
      {img ? (
        <>
          <img src={img.preview} alt={`${label} photo`} />
          <button type="button" class="btn link danger" onClick={onClear}>Remove</button>
        </>
      ) : (
        <label class="photo-pick">
          <span>{label}{required ? '' : ' (optional)'}</span>
          <small class="muted">Camera or library</small>
          <input type="file" accept="image/*" class="visually-hidden" onChange={(e) => { onPick(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }} />
        </label>
      )}
    </div>
  );
}

// ---------- Review ----------

interface Line {
  item: AiItem;
  grams: string;
  food: Food | null;
  matching: boolean;
  include: boolean;
  usual: UsualPortion | undefined;
  saveUsual: boolean;
  changing: boolean;
}

function AiReview({ items, skipped, cost, month, cap, source, place, portions, date, meal, method, onBack, onDone, onChanged }: {
  items: AiItem[]; skipped: string[]; cost?: number; month?: number; cap?: number; source: Source; place: string; portions: UsualPortion[];
  date: string; meal: Meal; method: string; onBack: () => void; onDone: () => void; onChanged: () => void;
}) {
  // Your chosen correction for this source (Settings / Progress → Estimate accuracy); usual portions are never corrected.
  const factor = correctionFor(source, getSettings());
  const [lines, setLines] = useState<Line[]>(() => items.map((item) => {
    const usual = usualFor(portions, item.name);
    return { item, grams: String(usual?.grams ?? correctGrams(item.grams, factor)), food: null, matching: true, include: true, usual, saveUsual: false, changing: false };
  }));
  const [busy, setBusy] = useState(false);

  const update = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  useEffect(() => {
    items.forEach((item, i) => {
      matchFood(item.name, place).then((food) => update(i, { food, matching: false })).catch(() => update(i, { matching: false }));
    });
  }, []);

  const kcal = (l: Line, g: number) => (l.food ? (l.food.per100.kcal * g) / 100 : 0);
  const scaleRange = (l: Line) => {
    const g = Number(l.grams) || 0;
    const ratio = l.item.grams > 0 ? g / l.item.grams : 1;
    return l.usual ? [g, g] : [l.item.grams_low * ratio, l.item.grams_high * ratio];
  };
  const included = lines.filter((l) => l.include);
  const total = included.reduce((s, l) => s + kcal(l, Number(l.grams) || 0), 0);
  const low = included.reduce((s, l) => s + kcal(l, scaleRange(l)[0]!), 0);
  const high = included.reduce((s, l) => s + kcal(l, scaleRange(l)[1]!), 0);
  const ready = included.length > 0 && included.every((l) => l.food && Number(l.grams) > 0);

  async function logAll() {
    setBusy(true);
    const done: LogEntry[] = [];
    let allOk = true;
    try {
      for (const l of included) {
        const g = Number(l.grams);
        const r = await logAiItem({ date, meal, name: l.item.name, grams: g, matched: l.food!, source, place, method });
        done.push(r.entry);
        allOk &&= r.ok;
        if (l.saveUsual && place) await saveUsualPortion(source, place, l.item.name, g);
      }
      onChanged();
      showUndo(`${allOk ? 'Logged' : 'Queued'} ${done.length} item${done.length > 1 ? 's' : ''} · ~${fmt(total)} kcal · ${MEAL_LABELS[meal]}`, {
        undo: async () => { for (const e of done) await deleteEntry(e); onChanged(); },
      });
      onDone();
    } catch (err) {
      showToast(errorMessage(err), 'error');
      if (done.length) onChanged();
      setBusy(false);
    }
  }

  return (
    <div>
      <div class="card">
        <div class="ex-head">
          <h2 class="no-margin grow">Estimate</h2>
          <span class="badge">AI estimate</span>
        </div>
        <p class="big-num">~{fmt(total)} kcal</p>
        <p class="muted tiny-pad">Likely {fmt(low)}–{fmt(high)} kcal · {place || source}</p>
        {skipped.length > 0 && <p class="warn tiny-pad">Left out (no amount given): {skipped.join(', ')}. Add them with search if you had them.</p>}
        {factor !== 1 && <p class="muted tiny-pad">Includes your ×{factor} {source} correction (Settings → Advanced).</p>}
        {cost != null && <p class="muted tiny-pad">Cost ${cost.toFixed(4)} · this month ${(month ?? 0).toFixed(2)} of ${(cap ?? 0).toFixed(2)}</p>}
      </div>

      {lines.map((l, i) => {
        const g = Number(l.grams) || 0;
        const [lo, hi] = scaleRange(l);
        return (
          <div class={`card ai-item ${l.include ? '' : 'off'}`} key={i}>
            <div class="ex-head">
              <label class="tick grow">
                <input type="checkbox" checked={l.include} onChange={(e) => update(i, { include: e.currentTarget.checked })} />
                <strong class="clip">{l.item.name}</strong>
              </label>
              <span class={`conf ${l.item.confidence}`}>{l.item.confidence}</span>
            </div>
            {l.item.notes && <p class="muted tiny-pad">{l.item.notes}</p>}
            <div class="field">
              <div class="with-unit">
                <input type="number" inputMode="decimal" aria-label={`Grams of ${l.item.name}`} value={l.grams} onInput={(e) => update(i, { grams: e.currentTarget.value })} />
                <span class="unit">g</span>
              </div>
              <small class="muted">
                {l.usual ? `Your usual portion here (${fmt(l.usual.grams)} g)` : `AI range ${fmt(l.item.grams_low)}–${fmt(l.item.grams_high)} g`}
                {l.food && ` · ${fmt(kcal(l, g))} kcal`}
                {l.food && !l.usual && ` (${fmt(kcal(l, lo!))}–${fmt(kcal(l, hi!))})`}
              </small>
            </div>
            <div class="match-line">
              {l.matching ? <span class="muted">Finding nutrition…</span>
                : l.food ? <span class="clip grow">Matched: {l.food.name} <small class="muted">({sourceLabel(l.food)})</small></span>
                  : <span class="warn grow">No match — pick one</span>}
              <button type="button" class="btn link" onClick={() => update(i, { changing: !l.changing })}>{l.changing ? 'Close' : 'Change'}</button>
            </div>
            {l.changing && <MatchPicker initial={l.item.name} onPick={(food) => update(i, { food, changing: false })} />}
            {place && l.include && !l.usual && (
              <label class="tick save-usual">
                <input type="checkbox" checked={l.saveUsual} onChange={(e) => update(i, { saveUsual: e.currentTarget.checked })} />
                <span>Save as my usual portion at {place}</span>
              </label>
            )}
          </div>
        );
      })}

      <button class="btn primary" disabled={!ready || busy} onClick={logAll}>{busy ? 'Logging…' : `Log ${included.length} item${included.length === 1 ? '' : 's'} to ${MEAL_LABELS[meal]}`}</button>
      <button class="btn center-block" disabled={busy} onClick={onBack}>Back</button>
    </div>
  );
}

function MatchPicker({ initial, onPick }: { initial: string; onPick: (f: Food) => void }) {
  const [q, setQ] = useState(initial);
  const [results, setResults] = useState<Food[] | null>(null);
  const [busy, setBusy] = useState(false);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const saved = words.length ? cachedFoods().filter((f) => words.every((w) => `${f.name} ${f.brand}`.toLowerCase().includes(w))).slice(0, 8) : [];

  async function run() {
    if (q.trim().length < 2) return;
    setBusy(true);
    try { setResults(await searchUsda(q.trim())); } catch (err) { showToast(errorMessage(err), 'error'); } finally { setBusy(false); }
  }
  useEffect(() => { void run(); }, []);

  const all = [...saved, ...(results ?? [])];
  return (
    <div class="match-picker">
      <form class="search-field" onSubmit={(e) => { e.preventDefault(); void run(); }}>
        <input type="search" aria-label="Search for a match" value={q} onInput={(e) => setQ(e.currentTarget.value)} enterKeyHint="search" />
      </form>
      {busy && <p class="muted tiny-pad">Searching…</p>}
      <div class="list">
        {all.slice(0, 15).map((f, i) => (
          <button class="row" key={`${f.source}-${f.id || f.source_id}-${i}`} onClick={() => onPick(f)}>
            <span class="row-text"><span class="clip">{f.name}</span><small class="muted clip">{[f.brand, sourceLabel(f), foodSummary(f)].filter(Boolean).join(' · ')}</small></span>
          </button>
        ))}
        {!busy && results && all.length === 0 && <p class="muted tiny-pad">No matches. Try a simpler name.</p>}
      </div>
    </div>
  );
}
