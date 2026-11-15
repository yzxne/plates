// Combos: several logged foods shown as one named item ("Chipotle bowl"). Each part keeps its own numbers,
// so you can open the combo and change just the rice. Parts share group_id on their FoodLog rows.
import { useState } from 'preact/hooks';
import { MEAL_LABELS, MEALS, roundNutrients, totals, type LogEntry, type Meal } from '../../../shared/nutrition';
import { amountLine, fmt } from '../format';
import { IconBack } from './Icons';
import { AmountSlider } from './AmountSlider';
import { NutrientTable } from './NutrientTable';

const PORTIONS = [[0.5, '½'], [0.75, '¾'], [1, '1'], [1.25, '1¼'], [1.5, '1½'], [2, '2']] as const;

/** The same entry, scaled (nutrients, grams and servings are all linear in the amount). */
export function scaleEntry(e: LogEntry, f: number): LogEntry {
  const k = (v: number | null) => (v == null ? null : v * f);
  return {
    ...e,
    grams: e.grams == null ? null : Math.round(e.grams * f * 10) / 10,
    servings: e.servings == null ? null : Math.round(e.servings * f * 100) / 100,
    n: roundNutrients({ kcal: e.n.kcal * f, protein_g: e.n.protein_g * f, carbs_g: e.n.carbs_g * f, fat_g: e.n.fat_g * f, fiber_g: k(e.n.fiber_g), sugar_g: k(e.n.sugar_g), sodium_mg: k(e.n.sodium_mg) }),
  };
}

export type MealItem = { kind: 'entry'; e: LogEntry } | { kind: 'combo'; id: string; name: string; parts: LogEntry[] };

/** A meal's entries with combo parts folded into one item, in logged order. */
export function mealItems(entries: LogEntry[]): MealItem[] {
  const out: MealItem[] = [];
  const combos = new Map<string, MealItem & { kind: 'combo' }>();
  for (const e of entries) {
    if (!e.group_id) { out.push({ kind: 'entry', e }); continue; }
    let c = combos.get(e.group_id);
    if (!c) {
      c = { kind: 'combo', id: e.group_id, name: e.group_name || 'Combo', parts: [] };
      combos.set(e.group_id, c);
      out.push(c);
    }
    c.parts.push(e);
  }
  // A "combo" left with one part is just that food.
  return out.map((it) => (it.kind === 'combo' && it.parts.length === 1 ? { kind: 'entry', e: it.parts[0]! } : it));
}

/** Pick foods in a meal and name them. */
export function CombineSheet({ meal, entries, onCombine, onClose }: {
  meal: Meal; entries: LogEntry[]; onCombine: (picked: LogEntry[], name: string) => void; onClose: () => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [name, setName] = useState('');
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const chosen = entries.filter((e) => picked.has(e.id));
  const ready = chosen.length >= 2 && name.trim().length > 0;
  return (
    <div class="sheet-backdrop" onClick={onClose}>
      <div class="sheet" role="dialog" aria-modal="true" aria-label="Combine foods" onClick={(e) => e.stopPropagation()}>
        <h2>Combine foods</h2>
        <p class="muted tiny">Pick 2 or more from {MEAL_LABELS[meal]}. They show as one item; open it to change any part.</p>
        <div class="list card">
          {entries.map((e) => (
            <label class="row pick-row" key={e.id}>
              <input type="checkbox" checked={picked.has(e.id)} onChange={() => toggle(e.id)} />
              <span class="row-text"><span class="entry-name">{e.food_name}</span><small>{amountLine(e)}</small></span>
              <span class="entry-kcal">{fmt(e.n.kcal)}</span>
            </label>
          ))}
        </div>
        <div class="field">
          <label for="combo-name">Name</label>
          <input id="combo-name" type="text" placeholder="e.g. Chipotle bowl" value={name} onInput={(e) => setName(e.currentTarget.value)} />
        </div>
        <button class="btn primary" disabled={!ready} onClick={() => onCombine(chosen, name.trim())}>
          {chosen.length >= 2 ? `Combine ${chosen.length} · ${fmt(totals(chosen).kcal)} kcal` : 'Combine'}
        </button>
      </div>
    </div>
  );
}

/** One combo: totals, its parts (tap one to edit it), add/remove parts, rename, move, split, delete. */
export function ComboPage({ name, parts, others, onEditPart, onChange, onScale, onSplit, onDelete, onClose }: {
  name: string; parts: LogEntry[]; others: LogEntry[];
  onEditPart: (e: LogEntry) => void;
  /** Rewrite parts: rename, move meal, add or take out foods. `out` loses its group. */
  onChange: (next: { name: string; meal: Meal; add: LogEntry[]; out: LogEntry[] }) => void;
  /** Scale every part by this factor (1.5 = one and a half of what is logged). */
  onScale: (factor: number) => void;
  onSplit: () => void; onDelete: () => void; onClose: () => void;
}) {
  const [draft, setDraft] = useState(name);
  const [portion, setPortion] = useState('1');
  const factor = Math.max(0, Number(portion) || 0);
  const preview = factor > 0 && factor !== 1 ? totals(parts.map((e) => scaleEntry(e, factor))) : null;
  const meal = parts[0]?.meal ?? 'snack';
  const rename = () => { const n = draft.trim(); if (n && n !== name) onChange({ name: n, meal, add: [], out: [] }); else setDraft(name); };
  return (
    <div class="overlay" role="dialog" aria-modal="true" aria-label={name}>
      <header class="overlay-head">
        <button class="icon-btn" aria-label="Back" onClick={onClose}><IconBack /></button>
        <div class="overlay-title"><strong>{name}</strong><small class="muted">{MEAL_LABELS[meal]} · {parts.length} items</small></div>
      </header>
      <div class="overlay-body">
        <div class="card">
          <div class="field no-mb">
            <label for="combo-rename">Name</label>
            <input id="combo-rename" type="text" value={draft} onInput={(e) => setDraft(e.currentTarget.value)} onBlur={rename}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }} />
          </div>
          <NutrientTable n={preview ?? totals(parts)} />
          <div class="field amount mt no-mb">
            <label for="combo-portion">How much you had</label>
            <div class="with-unit">
              <input id="combo-portion" type="text" inputMode="decimal" value={portion} onInput={(e) => setPortion(e.currentTarget.value)} />
              <span class="unit">× {name}</span>
            </div>
            <AmountSlider label="Portion" value={factor} max={2} step={0.05} marks={PORTIONS} onChange={(v) => setPortion(String(v))} />
            <small class="muted">1 = what is logged now. Every food inside scales together.</small>
          </div>
          {preview && <button class="btn primary mt" onClick={() => { onScale(factor); setPortion('1'); }}>Update to {fmt(preview.kcal)} kcal</button>}
        </div>

        <h3 class="group-label">In this combo</h3>
        <div class="list card">
          {parts.map((e) => (
            <div class="row combo-part" key={e.id}>
              <button class="row-text plain" onClick={() => onEditPart(e)}>
                <span class="entry-name">{e.food_name}{e.is_estimate ? <span class="tag">estimate</span> : null}</span>
                <small>{amountLine(e)} · {fmt(e.n.kcal)} kcal · P {fmt(e.n.protein_g)} · C {fmt(e.n.carbs_g)} · F {fmt(e.n.fat_g)}</small>
              </button>
              <button class="btn link small-link" aria-label={`Take ${e.food_name} out`} onClick={() => onChange({ name, meal, add: [], out: [e] })}>Take out</button>
            </div>
          ))}
        </div>
        <p class="muted tiny">Tap a food to change its amount or numbers.</p>

        {others.length > 0 && (
          <>
            <h3 class="group-label">Add from {MEAL_LABELS[meal]}</h3>
            <div class="list card">
              {others.map((e) => (
                <button class="row" key={e.id} onClick={() => onChange({ name, meal, add: [e], out: [] })}>
                  <span class="row-text"><span class="entry-name">{e.food_name}</span><small>{amountLine(e)} · {fmt(e.n.kcal)} kcal</small></span>
                  <span class="add-plus" aria-hidden="true">+</span>
                </button>
              ))}
            </div>
          </>
        )}

        <h3 class="group-label">Meal</h3>
        <div class="seg full mb">
          {MEALS.map((m) => <button key={m} class={meal === m ? 'on' : ''} onClick={() => m !== meal && onChange({ name, meal: m, add: [], out: [] })}>{MEAL_LABELS[m]}</button>)}
        </div>

        <button class="btn" onClick={onSplit}>Split into separate foods</button>
        <button class="btn link danger center" onClick={onDelete}>Delete combo</button>
      </div>
    </div>
  );
}
