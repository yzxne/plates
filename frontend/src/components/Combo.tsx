// Combos: several logged foods shown as one named item ("Chipotle bowl"). Each part keeps its own numbers,
// so you can open the combo and change just the rice. Parts share group_id on their FoodLog rows.
import { useState } from 'preact/hooks';
import { MEAL_LABELS, MEALS, totals, type LogEntry, type Meal } from '../../../shared/nutrition';
import { amountLine, fmt } from '../format';
import { IconBack } from './Icons';
import { NutrientTable } from './NutrientTable';

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
export function ComboPage({ name, parts, others, onEditPart, onChange, onSplit, onDelete, onClose }: {
  name: string; parts: LogEntry[]; others: LogEntry[];
  onEditPart: (e: LogEntry) => void;
  /** Rewrite parts: rename, move meal, add or take out foods. `out` loses its group. */
  onChange: (next: { name: string; meal: Meal; add: LogEntry[]; out: LogEntry[] }) => void;
  onSplit: () => void; onDelete: () => void; onClose: () => void;
}) {
  const [draft, setDraft] = useState(name);
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
          <NutrientTable n={totals(parts)} />
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
