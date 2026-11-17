// Today's water: a meter toward your goal, one-tap glasses and bottles, plus diet sodas, coffee and energy drinks.
import { useEffect, useState } from 'preact/hooks';
import { roundNutrients, type LogEntry } from '../../../shared/nutrition';
import { errorMessage } from '../api';
import { addEntry, deleteEntry, uuid } from '../foodData';
import { fmt } from '../format';
import { getSettings } from '../settingsStore';
import { showToast } from '../toast';
import { showUndo } from '../undo';
import { addSip, deleteSip, kindOf, loadWater, WATER_KINDS, waterGoal, type Sip, type WaterKind } from '../waterData';
import { lastWeight } from '../weightData';

export function WaterCard({ date, onFoodLogged }: { date: string; onFoodLogged: () => void }) {
  const [sips, setSips] = useState<Sip[]>([]);
  const [more, setMore] = useState(false);
  const [custom, setCustom] = useState<string | null>(null);
  useEffect(() => { let live = true; void loadWater(date).then((s) => live && setSips(s)); return () => { live = false; }; }, [date]);

  const goal = waterGoal(getSettings().water_goal_oz, lastWeight()?.weight_lb);
  const oz = sips.reduce((s, x) => s + x.oz, 0);
  const caffeine = sips.reduce((s, x) => s + (kindOf(x.kind)?.caffeine ?? 0), 0);
  const pct = Math.min(100, (oz / goal) * 100);

  async function tap(k: WaterKind) {
    try {
      const s = await addSip(date, k);
      setSips((xs) => [...xs, s]);
      let food: LogEntry | null = null;
      if (k.kcal) {
        food = {
          id: uuid(), date, meal: 'snack', food_id: '', food_name: k.label, grams: null, servings: 1,
          n: roundNutrients({ kcal: k.kcal, protein_g: 0, carbs_g: k.carbs ?? 0, fat_g: 0, fiber_g: null, sugar_g: k.carbs ?? null, sodium_mg: null }),
          entry_method: 'drink', notes: k.note, food_source: '', place: '', is_estimate: false,
        };
        await addEntry(food);
        onFoodLogged();
      }
      showUndo(`+${fmt(k.oz, 1)} oz ${k.label.toLowerCase()}${food ? ` · ${k.kcal} kcal to Snack` : ''}`, {
        undo: async () => {
          await deleteSip(s);
          setSips((xs) => xs.filter((x) => x.id !== s.id));
          if (food) { await deleteEntry(food); onFoodLogged(); }
        },
      });
    } catch (err) {
      showToast(errorMessage(err), 'error');
    }
  }

  const quick = WATER_KINDS.slice(0, 3);
  return (
    <div class="card water">
      <div class="card-head">
        <h2>Water</h2>
        <span class="muted">{fmt(oz)} / {fmt(goal)} oz{caffeine ? ` · ☕ ${fmt(caffeine)} mg` : ''}</span>
      </div>
      <div class="water-meter" role="meter" aria-valuemin={0} aria-valuemax={goal} aria-valuenow={oz} aria-label="Water today">
        <span class={`water-fill ${oz >= goal ? 'done' : ''}`} style={{ width: `${pct}%` }} />
        <span class="water-label">{oz >= goal ? '✓ Goal hit' : `${fmt(goal - oz)} oz to go`}</span>
      </div>
      <div class="water-btns">
        {quick.map((k) => <button key={k.id} class="chip" onClick={() => void tap(k)}>+ {k.label} <small>{k.note}</small></button>)}
        <button class={`chip ${custom != null ? 'on' : ''}`} onClick={() => setCustom(custom == null ? '' : null)}>Custom</button>
        <button class={`chip ${more ? 'on' : ''}`} onClick={() => setMore(!more)}>Other drinks</button>
      </div>
      {custom != null && (
        <form class="water-custom" onSubmit={(e) => {
          e.preventDefault();
          const v = Number(custom.replace(',', '.'));
          if (!(v > 0 && v <= 128)) { showToast('Enter ounces, 1–128', 'error'); return; }
          void tap({ id: 'custom', label: 'Water', oz: Math.round(v * 10) / 10, note: `${v} oz` });
          setCustom(null);
        }}>
          <div class="with-unit">
            <input type="text" inputMode="decimal" aria-label="Ounces of water" placeholder="Ounces" value={custom} autoFocus onInput={(e) => setCustom(e.currentTarget.value)} />
            <span class="unit">oz</span>
            <button class="btn primary small-btn" type="submit">Add</button>
          </div>
        </form>
      )}
      {more && (
        <div class="list card water-more">
          {WATER_KINDS.slice(3).map((k) => (
            <button class="row" key={k.id} onClick={() => void tap(k)}>
              <span class="row-text"><span>{k.label}</span><small class="muted">{k.note}{k.caffeine ? ` · ${k.caffeine} mg caffeine` : ''}</small></span>
              <span class="add-plus" aria-hidden="true">+</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
