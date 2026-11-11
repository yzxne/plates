import { useEffect, useRef, useState } from 'preact/hooks';
import { MEAL_LABELS, MEALS, makeEntry, totals, type LogEntry, type Meal, type Nutrients } from '../../../shared/nutrition';
import { ApiError, errorMessage } from '../api';
import { EntrySheet } from '../components/EntrySheet';
import { IconBack, IconChevron, IconPlus } from '../components/Icons';
import { SwipeRow } from '../components/SwipeRow';
import { dateLabel, shiftDate, today } from '../dates';
import {
  addEntry, copyEntries, createSavedMeal, dayOutOfDate, deleteEntry, loadFoods, loadRange, loadSavedMeals, saveDay,
  restoreEntry, uuid, weekStart, type DayData, type SavedMeal, type WeekData,
} from '../foodData';
import { amountLine, fmt } from '../format';
import { queue } from '../queue';
import { showToast } from '../toast';
import { showUndo } from '../undo';
import { addWeight, deleteWeight, lastWeight, loadWeights, type WeighIn } from '../weightData';
import { cachedCoach, ensureCheckIn, expenditureSeries, loadCoach, subscribeCoach, targetsForDate } from '../coachData';
import { Sparkline } from '../components/UChart';

type Targets = { kcal: number; protein_g: number; carbs_g: number; fat_g: number };

/** Targets for a date: the check-in plan, else whatever was saved on that day's row. */
function targetFor(date: string, day?: DayData): Targets | null {
  const plan = targetsForDate(date);
  if (plan) return plan;
  const r = day?.dayRow;
  return r && Number(r.target_kcal) > 0
    ? { kcal: Number(r.target_kcal), protein_g: Number(r.target_protein_g), carbs_g: Number(r.target_carbs_g), fat_g: Number(r.target_fat_g) }
    : null;
}

interface Props {
  date: string;
  onDate: (d: string) => void;
  onAdd: (meal: Meal) => void;
  onSettings: () => void;
  version: number;
  nextWorkout?: preact.ComponentChildren;
  onOpenProgress?: (section: 'weight' | 'expenditure' | 'calories') => void;
}

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function Today({ date, onDate, onAdd, onSettings, version, nextWorkout, onOpenProgress }: Props) {
  const [week, setWeek] = useState<WeekData | null>(null);
  const [weekOf, setWeekOf] = useState('');
  const [error, setError] = useState<Error | null>(null);
  const [editing, setEditing] = useState<LogEntry | null>(null);
  const [picker, setPicker] = useState<Meal | null>(null);
  const [mode, setMode] = useState<'consumed' | 'remaining'>('consumed');
  const [, setCoachTick] = useState(0);
  useEffect(() => {
    void loadCoach().catch(() => {});
    return subscribeCoach(() => setCoachTick((n) => n + 1));
  }, []);

  const start = weekStart(date);
  async function load() {
    setError(null);
    try {
      const w = await loadRange(start, shiftDate(start, 6));
      setWeek(w);
      setWeekOf(start);
      const d = w.days.get(date);
      if (d && !d.pendingIds.size && dayOutOfDate(d)) void saveDay(date, d.entries, d.dayComplete, targetsForDate(date));
    } catch (err) {
      setError(err as Error);
    }
  }
  useEffect(() => { void load(); }, [start, version]);
  useEffect(() => queue.subscribe(() => { if (!queue.list().length) void load(); }), [start]);

  // Header swipe: left = next day, right = previous day.
  const sx = useRef<number | null>(null);
  const headerSwipe = {
    onTouchStart: (e: TouchEvent) => { sx.current = e.touches[0]?.clientX ?? null; },
    onTouchEnd: (e: TouchEvent) => {
      const x0 = sx.current;
      const x1 = e.changedTouches[0]?.clientX;
      sx.current = null;
      if (x0 == null || x1 == null || Math.abs(x1 - x0) < 60) return;
      onDate(shiftDate(date, x1 < x0 ? 1 : -1));
    },
  };

  const day: DayData | undefined = weekOf === start ? week?.days.get(date) : undefined;
  const setDay = (fn: (d: DayData) => DayData) => setWeek((w) => {
    if (!w) return w;
    const days = new Map(w.days);
    const d = days.get(date);
    if (d) days.set(date, fn(d));
    return { days };
  });

  function replaceEntries(next: LogEntry[]) {
    if (!day) return;
    setDay((d) => ({ ...d, entries: next }));
    void saveDay(date, next, day.dayComplete, targetsForDate(date));
  }

  async function remove(e: LogEntry) {
    if (!day) return;
    const before = day.entries;
    replaceEntries(before.filter((x) => x.id !== e.id));
    try {
      await deleteEntry(e);
      showUndo(`Deleted ${e.food_name}`, {
        undo: async () => {
          await restoreEntry(e);
          replaceEntries([...before]);
        },
      });
    } catch (err) {
      replaceEntries(before);
      showToast(errorMessage(err), 'error');
    }
  }

  async function toggleComplete() {
    if (!day) return;
    const next = !day.dayComplete;
    setDay((d) => ({ ...d, dayComplete: next }));
    try {
      if (!(await saveDay(date, day.entries, next, targetsForDate(date)))) showToast('Not saved yet — will retry', 'error');
    } catch (err) {
      setDay((d) => ({ ...d, dayComplete: !next }));
      showToast(errorMessage(err), 'error');
    }
  }

  async function copyYesterday(meal: Meal) {
    try {
      const y = shiftDate(date, -1);
      const prev = await loadRange(y, y);
      const items = (prev.days.get(y)?.entries ?? []).filter((e) => e.meal === meal);
      if (!items.length) { showToast(`Nothing logged for ${MEAL_LABELS[meal]} yesterday`, 'info'); return; }
      const { copied } = await copyEntries(items, date);
      const before = day?.entries ?? [];
      replaceEntries([...before, ...copied]);
      showUndo(`Copied ${copied.length} item${copied.length > 1 ? 's' : ''} from yesterday`, {
        undo: async () => { for (const c of copied) await deleteEntry(c); replaceEntries(before); },
      });
    } catch (err) {
      showToast(errorMessage(err), 'error');
    }
  }

  async function saveAsMeal(meal: Meal) {
    const items = (day?.entries ?? []).filter((e) => e.meal === meal && e.food_id && e.grams);
    if (!items.length) { showToast('Nothing to save in this meal (quick adds can’t be saved)', 'info'); return; }
    const name = prompt('Name this saved meal', `My ${MEAL_LABELS[meal].toLowerCase()}`)?.trim();
    if (!name) return;
    try {
      await createSavedMeal(name, items);
      showToast(`Saved "${name}"`, 'ok');
    } catch (err) {
      showToast(errorMessage(err), 'error');
    }
  }

  async function logSaved(meal: Meal, m: SavedMeal) {
    setPicker(null);
    try {
      const foods = new Map((await loadFoods()).map((f) => [f.id!, f]));
      const entries = m.items.flatMap((it) => {
        const f = foods.get(it.food_id);
        return f ? [makeEntry({ id: uuid(), date, meal, food: f, grams: it.grams, method: 'saved_meal' })] : [];
      });
      if (!entries.length) { showToast('The foods in this saved meal no longer exist', 'error'); return; }
      const before = day?.entries ?? [];
      for (const e of entries) await addEntry(e);
      replaceEntries([...before, ...entries]);
      showUndo(`Logged ${m.name}`, { undo: async () => { for (const e of entries) await deleteEntry(e); replaceEntries(before); } });
    } catch (err) {
      showToast(errorMessage(err), 'error');
    }
  }

  function mealAction(meal: Meal, action: string) {
    if (action === 'copy') void copyYesterday(meal);
    else if (action === 'saved') setPicker(meal);
    else if (action === 'save') void saveAsMeal(meal);
  }

  const notReady = error instanceof ApiError && ['sheet_not_set_up', 'google_not_connected', 'google_reconnect'].includes(error.code);
  const t = day ? totals(day.entries) : null;
  const targets = targetFor(date, day);

  return (
    <section>
      <header class="screen-head today-head" {...headerSwipe}>
        <button class="icon-btn" aria-label="Previous day" onClick={() => onDate(shiftDate(date, -1))}><IconBack /></button>
        <label class="date-pick grow">
          <span class="date-title">{dateLabel(date)}</span>
          <input type="date" value={date} aria-label="Pick a date" onChange={(e) => e.currentTarget.value && onDate(e.currentTarget.value)} />
        </label>
        <button class="icon-btn" aria-label="Next day" onClick={() => onDate(shiftDate(date, 1))}><IconChevron /></button>
        <button class="icon-btn gear" aria-label="Settings" onClick={onSettings}><GearIcon /></button>
      </header>
      {date !== today() && <button class="btn link center" onClick={() => onDate(today())}>Back to today</button>}

      {error && (
        <div class="card">
          <p class={notReady ? 'muted' : 'error'}>{notReady ? 'Connect Google and create the spreadsheet (gear icon → Google connection).' : errorMessage(error)}</p>
          {!notReady && <button class="btn" onClick={load}>Try again</button>}
        </div>
      )}

      {!error && <MacroBars t={t} targets={targets} />}

      {week && weekOf === start && (
        <WeekGrid week={week} start={start} selected={date} mode={mode} onMode={setMode} onPick={onDate} />
      )}

      {onOpenProgress && <TrendCards onOpen={onOpenProgress} />}

      <QuickWeigh date={date} />

      {nextWorkout}

      {day && MEALS.map((meal) => {
        const items = day.entries.filter((e) => e.meal === meal);
        const mt = totals(items);
        return (
          <div class="card meal" key={meal}>
            <div class="meal-head">
              <h2>{MEAL_LABELS[meal]}</h2>
              <span class="muted">{items.length ? `${fmt(mt.kcal)} kcal` : ''}</span>
              <select class="ex-menu" aria-label={`${MEAL_LABELS[meal]} options`} value="" onChange={(e) => { mealAction(meal, e.currentTarget.value); e.currentTarget.value = ''; }}>
                <option value="" disabled>⋯</option>
                <option value="copy">Copy from yesterday</option>
                <option value="saved">Log saved meal</option>
                {items.length > 0 && <option value="save">Save as a meal</option>}
              </select>
              <button class="icon-btn small" aria-label={`Add to ${MEAL_LABELS[meal]}`} onClick={() => onAdd(meal)}><IconPlus size={20} /></button>
            </div>
            {items.length === 0 && <p class="muted tiny-pad">Nothing logged.</p>}
            {items.map((e) => (
              <SwipeRow key={e.id} label={`${e.food_name}, ${fmt(e.n.kcal)} kcal`} onTap={() => setEditing(e)} onSwipeRight={() => setEditing(e)} onSwipeLeft={() => void remove(e)}>
                <span class="entry-main">
                  <span class="entry-name">{e.food_name}{e.is_estimate ? <span class="tag">estimate</span> : null}</span>
                  <small class="muted">{amountLine(e)}{day.pendingIds.has(e.id) ? ' · not saved yet' : ''}</small>
                </span>
                <span class="entry-kcal">{fmt(e.n.kcal)}</span>
              </SwipeRow>
            ))}
          </div>
        );
      })}

      {day && (
        <label class="card complete-row">
          <input type="checkbox" checked={day.dayComplete} onChange={toggleComplete} />
          <span>
            <strong>Day complete</strong>
            <small class="muted">Tick when everything you ate is logged. Only complete days are used to estimate expenditure.</small>
          </span>
        </label>
      )}
      {!week && !error && <p class="muted center">Loading…</p>}

      {editing && day && (
        <EntrySheet entry={editing} onClose={() => setEditing(null)}
          onSaved={(e) => { setEditing(null); replaceEntries(day.entries.map((x) => (x.id === e.id ? e : x))); }}
          onDeleted={(e) => { setEditing(null); replaceEntries(day.entries.filter((x) => x.id !== e.id)); }} />
      )}
      {picker && <SavedMealPicker onPick={(m) => logSaved(picker, m)} onClose={() => setPicker(null)} />}
    </section>
  );
}

function GearIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6" />
      <circle cx="12" cy="12" r="6.5" />
    </svg>
  );
}

function MacroBars({ t, targets }: { t: Nutrients | null; targets: { kcal: number; protein_g: number; carbs_g: number; fat_g: number } | null }) {
  const rows: [string, keyof Nutrients, string][] = [['Calories', 'kcal', ''], ['Protein', 'protein_g', 'g'], ['Fat', 'fat_g', 'g'], ['Carbs', 'carbs_g', 'g']];
  return (
    <div class="card macros">
      {rows.map(([label, key, unit]) => {
        const v = (t?.[key] as number | null) ?? 0;
        const target = targets?.[key as 'kcal'] ?? 0;
        const pct = target ? Math.min(100, (v / target) * 100) : 0;
        return (
          <div class="macro-row" key={key}>
            <div class="macro-label">
              <span>{label}</span>
              <span class="muted">{fmt(v)}{unit}{target ? ` of ${fmt(target)}${unit}` : ''}</span>
            </div>
            <div class="macro-track"><span class="macro-fill" style={{ width: `${pct}%` }} />{target ? <span class="macro-mark" /> : null}</div>
          </div>
        );
      })}
      {!targets && <small class="muted">Targets appear after your first weigh-in and profile (sex, birth date, height in Settings).</small>}
    </div>
  );
}

function WeekGrid({ week, start, selected, mode, onMode, onPick }: {
  week: WeekData; start: string; selected: string; mode: 'consumed' | 'remaining'; onMode: (m: 'consumed' | 'remaining') => void; onPick: (d: string) => void;
}) {
  const dates = DOW.map((_, i) => shiftDate(start, i));
  const rows: [string, 'kcal' | 'protein_g' | 'fat_g' | 'carbs_g'][] = [['Cal', 'kcal'], ['P', 'protein_g'], ['F', 'fat_g'], ['C', 'carbs_g']];
  const hasTargets = dates.some((d) => !!targetFor(d, week.days.get(d)));
  const weekTotals = rows.map(([, k]) => {
    let sum = 0;
    let target = 0;
    for (const d of dates) {
      const day = week.days.get(d);
      if (!day) continue;
      sum += totals(day.entries)[k] as number;
      target += targetFor(d, day)?.[k] ?? 0;
    }
    return { sum, target };
  });
  return (
    <div class="card week">
      <div class="week-top">
        <h2>This week</h2>
        <div class="seg">
          <button class={mode === 'consumed' ? 'on' : ''} onClick={() => onMode('consumed')}>Consumed</button>
          <button class={mode === 'remaining' ? 'on' : ''} disabled={!hasTargets} onClick={() => onMode('remaining')}>Remaining</button>
        </div>
      </div>
      <div class="week-grid">
        <span />
        {dates.map((d, i) => (
          <button key={d} class={`wg-day ${d === selected ? 'on' : ''} ${d === today() ? 'today' : ''}`} onClick={() => onPick(d)}>{DOW[i]}</button>
        ))}
        {rows.map(([label, k]) => (
          <>
            <span class="wg-label" key={label}>{label}</span>
            {dates.map((d) => {
              const day = week.days.get(d);
              const v = day ? (totals(day.entries)[k] as number) : 0;
              const target = targetFor(d, day)?.[k] ?? 0;
              const shown = mode === 'remaining' && target ? target - v : v;
              return <span key={d + k} class={`wg-cell ${d === selected ? 'on' : ''}`}>{v || (mode === 'remaining' && target) ? fmt(shown) : '·'}</span>;
            })}
          </>
        ))}
      </div>
      <small class="muted">
        Week: {fmt(weekTotals[0]!.sum)} kcal{weekTotals[0]!.target ? ` of ${fmt(weekTotals[0]!.target)}` : ''} · P {fmt(weekTotals[1]!.sum)} g · F {fmt(weekTotals[2]!.sum)} g · C {fmt(weekTotals[3]!.sum)} g
      </small>
    </div>
  );
}

function QuickWeigh({ date }: { date: string }) {
  const [last, setLast] = useState<WeighIn | null>(lastWeight());
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { loadWeights().then((w) => setLast(w[0] ?? null)).catch(() => {}); }, []);
  useEffect(() => { if (open) setTimeout(() => input.current?.focus(), 50); }, [open]);

  async function save(e: Event) {
    e.preventDefault();
    const v = Number(value);
    if (!(v > 50 && v < 800)) { showToast('Enter your weight in lb', 'error'); return; }
    setOpen(false);
    try {
      const { w, ok } = await addWeight(v, date);
      setLast(w);
      void loadCoach(true).then(() => (cachedCoach()?.checkins.length ? null : ensureCheckIn())).catch(() => {});
      showUndo(`Weighed in ${fmt(w.weight_lb, 1)} lb${ok ? '' : ' (will retry)'}`, {
        undo: async () => { await deleteWeight(w); setLast(lastWeight()); },
      });
    } catch (err) {
      showToast(errorMessage(err), 'error');
    }
  }

  if (open) {
    return (
      <form class="card weigh" onSubmit={save}>
        <label for="weigh">Weight</label>
        <div class="with-unit">
          <input id="weigh" ref={input} type="number" inputMode="decimal" step="0.1" value={value} onInput={(e) => setValue(e.currentTarget.value)} />
          <span class="unit">lb</span>
          <button class="btn primary small-btn" type="submit">Save</button>
        </div>
      </form>
    );
  }
  return (
    <button class="card weigh-row" onClick={() => { setValue(last ? String(last.weight_lb) : ''); setOpen(true); }}>
      <span><strong>Weigh in</strong><small class="muted">{last ? `Last: ${fmt(last.weight_lb, 1)} lb · ${last.date === today() ? 'today' : last.date}` : 'No weigh-ins yet'}</small></span>
      <span class="weigh-plus" aria-hidden="true">+</span>
    </button>
  );
}

function SavedMealPicker({ onPick, onClose }: { onPick: (m: SavedMeal) => void; onClose: () => void }) {
  const [meals, setMeals] = useState<SavedMeal[] | null>(null);
  useEffect(() => { loadSavedMeals().then(setMeals).catch((err) => { showToast(errorMessage(err), 'error'); onClose(); }); }, []);
  return (
    <div class="sheet-backdrop" onClick={onClose}>
      <div class="sheet" role="dialog" aria-modal="true" aria-label="Saved meals" onClick={(e) => e.stopPropagation()}>
        <h2>Log a saved meal</h2>
        {!meals && <p class="muted">Loading…</p>}
        {meals?.length === 0 && <p class="muted">No saved meals yet. Log a meal, then use ⋯ → Save as a meal.</p>}
        <div class="list">
          {meals?.map((m) => (
            <button class="row" key={m.id} onClick={() => onPick(m)}>
              <span class="row-text"><span>{m.name}</span><small class="muted">{m.items.length} item{m.items.length === 1 ? '' : 's'}</small></span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Expenditure · Weight trend · Scale weight, each with a 2-week sparkline. Tap → full chart in Progress. */
function TrendCards({ onOpen }: { onOpen: (s: 'weight' | 'expenditure') => void }) {
  const c = cachedCoach();
  if (!c || !c.trend.length) return null;
  const from = shiftDate(today(), -13);
  const exp = expenditureSeries(from);
  const tr = c.trend.filter((p) => p.date >= from);
  const lastTrend = c.trend.at(-1)!;
  const weekAgo = c.trend.find((p) => p.date === shiftDate(today(), -7)) ?? c.trend[0]!;
  const delta = lastTrend.trend - weekAgo.trend;
  const lastScale = [...c.trend].reverse().find((p) => p.scale != null);
  return (
    <div class="trend-cards">
      <button class="trend-card" onClick={() => onOpen('expenditure')}>
        <small>Expenditure</small>
        <strong>{exp.length ? fmt(exp.at(-1)!.kcal) : '–'}</strong>
        <small>{exp.at(-1)?.confidence ?? 'needs profile'}</small>
        <Sparkline values={exp.map((e) => e.kcal)} color="var(--warn)" />
      </button>
      <button class="trend-card" onClick={() => onOpen('weight')}>
        <small>Weight trend</small>
        <strong>{fmt(lastTrend.trend, 1)}</strong>
        <small>{delta >= 0 ? '+' : '−'}{fmt(Math.abs(delta), 1)} lb / 7 d</small>
        <Sparkline values={tr.map((p) => p.trend)} />
      </button>
      <button class="trend-card" onClick={() => onOpen('weight')}>
        <small>Scale weight</small>
        <strong>{lastScale ? fmt(lastScale.scale, 1) : '–'}</strong>
        <small>{lastScale ? (lastScale.date === today() ? 'today' : lastScale.date.slice(5).replace('-', '/')) : ''}</small>
        <Sparkline values={tr.map((p) => p.scale)} color="var(--muted)" dots />
      </button>
    </div>
  );
}
