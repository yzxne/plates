import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { MEAL_LABELS, MEALS, makeEntry, totals, type LogEntry, type Meal, type Nutrients } from '../../../shared/nutrition';
import { ApiError, errorMessage } from '../api';
import { CombineSheet, ComboPage, mealItems } from '../components/Combo';
import { EntrySheet } from '../components/EntrySheet';
import { IconBack, IconChevron, IconPlus } from '../components/Icons';
import { SwipeRow } from '../components/SwipeRow';
import { dateLabel, shiftDate, today } from '../dates';
import {
  addEntry, copyEntries, createSavedMeal, dayOutOfDate, deleteEntry, loadFoods, loadRange, loadSavedMeals, saveDay,
  restoreEntry, setEntriesDeleted, updateEntries, uuid, weekStart, type DayData, type SavedMeal, type WeekData,
} from '../foodData';
import { amountLine, fmt } from '../format';
import { queue } from '../queue';
import { safeStore } from '../storage';
import { showToast } from '../toast';
import { showUndo } from '../undo';
import { addWeight, deleteWeight, lastWeight, loadWeights, type WeighIn } from '../weightData';
import { cachedCoach, ensureCheckIn, expenditureSeries, loadCoach, subscribeCoach, targetsForDate } from '../coachData';
import { Sparkline } from '../components/UChart';
import { SkeletonCard, SkeletonRows } from '../components/Skeleton';

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
  const [combining, setCombining] = useState<Meal | null>(null);
  const [comboId, setComboId] = useState<string | null>(null);
  const [mode, setMode] = useState<'consumed' | 'remaining'>('consumed');
  const [view, setViewState] = useState<'meals' | 'timeline'>(() => (safeStore.getItem(VIEW_KEY) === 'timeline' ? 'timeline' : 'meals'));
  const setView = (v: 'meals' | 'timeline') => { setViewState(v); safeStore.setItem(VIEW_KEY, v); };
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

  // Next-morning nudge: yesterday had food but wasn't marked complete.
  const [yday, setYday] = useState<DayData | null>(null);
  const yDate = shiftDate(today(), -1);
  useEffect(() => {
    if (date !== today()) return;
    const inWeek = weekOf === start ? week?.days.get(yDate) : undefined;
    if (inWeek) { setYday(inWeek); return; }
    loadRange(yDate, yDate).then((r) => setYday(r.days.get(yDate) ?? null)).catch(() => setYday(null));
  }, [date, week, weekOf]);

  async function markYesterday() {
    if (!yday) return;
    const done = { ...yday, dayComplete: true };
    setYday(done);
    setWeek((w) => { if (!w?.days.has(yDate)) return w; const days = new Map(w.days); days.set(yDate, done); return { days }; });
    try {
      await saveDay(yDate, yday.entries, true, targetsForDate(yDate));
      showToast('Yesterday marked complete', 'ok');
    } catch (err) {
      setYday(yday);
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

  /** Optimistically swaps changed entries in, then writes them together. */
  async function writeMany(changed: LogEntry[], label: string, undoText?: string) {
    if (!day || !changed.length) return;
    const before = day.entries;
    const byId = new Map(changed.map((e) => [e.id, e]));
    replaceEntries(before.map((e) => byId.get(e.id) ?? e));
    try {
      const ok = await updateEntries(changed, label);
      if (!ok) showToast('Not saved yet — will retry', 'error');
      else if (undoText) {
        const old = before.filter((e) => byId.has(e.id));
        showUndo(undoText, { undo: async () => { await updateEntries(old, `Undo: ${label}`); replaceEntries(before); } });
      }
    } catch (err) {
      replaceEntries(before);
      showToast(errorMessage(err), 'error');
    }
  }

  const ungroup = (e: LogEntry): LogEntry => ({ ...e, group_id: '', group_name: '' });

  function combine(picked: LogEntry[], name: string) {
    setCombining(null);
    const id = uuid();
    void writeMany(picked.map((e) => ({ ...e, group_id: id, group_name: name })), `Combine: ${name}`, `Combined into ${name}`);
  }

  function changeCombo(parts: LogEntry[], next: { name: string; meal: Meal; add: LogEntry[]; out: LogEntry[] }) {
    const id = parts[0]!.group_id!;
    const outIds = new Set(next.out.map((e) => e.id));
    const keep = [...parts.filter((e) => !outIds.has(e.id)), ...next.add];
    if (keep.length < 2) {
      // One food left isn't a combo anymore.
      setComboId(null);
      void writeMany([...parts, ...next.add].map(ungroup), `Split: ${next.name}`, `Split ${next.name}`);
      return;
    }
    void writeMany([
      ...keep.map((e) => ({ ...e, meal: next.meal, group_id: id, group_name: next.name })),
      ...next.out.map(ungroup),
    ], `Edit combo: ${next.name}`);
  }

  function splitCombo(parts: LogEntry[]) {
    setComboId(null);
    void writeMany(parts.map(ungroup), `Split: ${parts[0]?.group_name}`, `Split ${parts[0]?.group_name || 'combo'}`);
  }

  async function deleteCombo(parts: LogEntry[]) {
    if (!day) return;
    setComboId(null);
    const name = parts[0]?.group_name || 'combo';
    const before = day.entries;
    const ids = new Set(parts.map((e) => e.id));
    replaceEntries(before.filter((e) => !ids.has(e.id)));
    try {
      await setEntriesDeleted(parts, true, `Delete: ${name}`);
      showUndo(`Deleted ${name}`, { undo: async () => { await setEntriesDeleted(parts, false, `Restore: ${name}`); replaceEntries(before); } });
    } catch (err) {
      replaceEntries(before);
      showToast(errorMessage(err), 'error');
    }
  }

  function mealAction(meal: Meal, action: string) {
    if (action === 'copy') void copyYesterday(meal);
    else if (action === 'saved') setPicker(meal);
    else if (action === 'save') void saveAsMeal(meal);
    else if (action === 'combine') setCombining(meal);
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

      {date === today() && yday && yday.entries.length > 0 && !yday.dayComplete && (
        <div class="card nudge" role="status">
          <span><strong>Yesterday isn't marked complete.</strong><small class="muted">Only complete days count toward your expenditure.</small></span>
          <button class="btn small-btn" onClick={markYesterday}>Mark it</button>
        </div>
      )}

      {!error && (
        <MacroBars t={t} targets={targets}>
          {day && (
            <div class="complete-bar">
              <button class={`complete-btn ${day.dayComplete ? 'on' : ''}`} aria-pressed={day.dayComplete} onClick={toggleComplete}>
                {day.dayComplete ? '✓ Day complete' : 'Mark day complete'}
              </button>
              {!day.dayComplete && <small class="muted">When everything you ate is logged</small>}
            </div>
          )}
        </MacroBars>
      )}

      {week && weekOf === start && (
        <WeekGrid week={week} start={start} selected={date} mode={mode} onMode={setMode} onPick={onDate} />
      )}

      {onOpenProgress && <TrendCards onOpen={onOpenProgress} />}

      <QuickWeigh date={date} />

      {nextWorkout}

      {day && day.entries.length > 0 && (
        <div class="seg full view-toggle">
          <button class={view === 'meals' ? 'on' : ''} onClick={() => setView('meals')}>Meals</button>
          <button class={view === 'timeline' ? 'on' : ''} onClick={() => setView('timeline')}>Timeline</button>
        </div>
      )}

      {day && view === 'timeline' && day.entries.length > 0 && (
        <Timeline entries={day.entries} pendingIds={day.pendingIds} onEdit={setEditing} onRemove={(e) => void remove(e)} />
      )}

      {day && (view === 'meals' || day.entries.length === 0) && MEALS.map((meal) => {
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
                {items.filter((e) => !e.group_id).length >= 2 && <option value="combine">Combine foods…</option>}
              </select>
              <button class="icon-btn small" aria-label={`Add to ${MEAL_LABELS[meal]}`} onClick={() => onAdd(meal)}><IconPlus size={20} /></button>
            </div>
            {items.length === 0 && <p class="muted tiny-pad">Nothing logged.</p>}
            {mealItems(items).map((it) => it.kind === 'combo' ? (
              <SwipeRow key={it.id} label={`${it.name}, ${it.parts.length} items, ${fmt(totals(it.parts).kcal)} kcal`}
                onTap={() => setComboId(it.id)} onSwipeRight={() => setComboId(it.id)} onSwipeLeft={() => void deleteCombo(it.parts)}>
                <span class="entry-main">
                  <span class="entry-name">{it.name}<span class="tag combo">{it.parts.length} items</span></span>
                  <small class="muted">{it.parts.map((p) => p.food_name).join(', ')}</small>
                </span>
                <span class="entry-kcal">{fmt(totals(it.parts).kcal)}</span>
              </SwipeRow>
            ) : ((e) => (
              <SwipeRow key={e.id} label={`${e.food_name}, ${fmt(e.n.kcal)} kcal`} onTap={() => setEditing(e)} onSwipeRight={() => setEditing(e)} onSwipeLeft={() => void remove(e)}>
                <span class="entry-main">
                  <span class="entry-name">{e.food_name}{e.is_estimate ? <span class="tag">estimate</span> : null}</span>
                  <small class="muted">{amountLine(e)}{day.pendingIds.has(e.id) ? ' · not saved yet' : ''}</small>
                </span>
                <span class="entry-kcal">{fmt(e.n.kcal)}</span>
              </SwipeRow>
            ))(it.e))}
          </div>
        );
      })}

      {!week && !error && <><SkeletonCard tall lines={1} /><SkeletonCard lines={3} /><SkeletonCard lines={2} /></>}

      {combining && day && (
        <CombineSheet meal={combining} entries={day.entries.filter((e) => e.meal === combining && !e.group_id)}
          onCombine={combine} onClose={() => setCombining(null)} />
      )}
      {comboId && day && (() => {
        const parts = day.entries.filter((e) => e.group_id === comboId);
        if (parts.length < 2) return null;
        return (
          <ComboPage name={parts[0]!.group_name || 'Combo'} parts={parts}
            others={day.entries.filter((e) => e.meal === parts[0]!.meal && !e.group_id)}
            onEditPart={setEditing} onChange={(next) => changeCombo(parts, next)}
            onSplit={() => splitCombo(parts)} onDelete={() => void deleteCombo(parts)} onClose={() => setComboId(null)} />
        );
      })()}
      {editing && day && (
        <EntrySheet entry={editing} onClose={() => setEditing(null)}
          onSaved={(e) => { setEditing(null); replaceEntries(day.entries.map((x) => (x.id === e.id ? e : x))); }}
          onDeleted={(e) => { setEditing(null); replaceEntries(day.entries.filter((x) => x.id !== e.id)); }} />
      )}
      {picker && <SavedMealPicker onPick={(m) => logSaved(picker, m)} onClose={() => setPicker(null)} />}
    </section>
  );
}

const VIEW_KEY = 'plates.today.view';
const MEAL_DEFAULT_MIN: Record<Meal, number> = { breakfast: 8 * 60, lunch: 12 * 60, dinner: 18 * 60, snack: 15 * 60 };

/** Minutes after midnight (Chicago) when an entry was eaten, as best we know. */
function entryMinutes(e: LogEntry): number {
  const cal = /(\d{1,2}):(\d{2})\s*([ap])m/i.exec(e.entry_method.startsWith('import') ? e.notes : '');
  if (cal) return (Number(cal[1]) % 12 + (cal[3]!.toLowerCase() === 'p' ? 12 : 0)) * 60 + Number(cal[2]);
  if (e.logged_at) {
    const at = new Date(e.logged_at);
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(at).map((p) => [p.type, p.value]));
    // Logged on the same day → use that time; logged later (catch-up) → the meal's usual time.
    if (`${parts.year}-${parts.month}-${parts.day}` === e.date) return Number(parts.hour) * 60 + Number(parts.minute);
  }
  return MEAL_DEFAULT_MIN[e.meal];
}
const hourLabel = (h: number) => `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`;

/** Entries grouped by the hour they were eaten (inspired by timeline-style logs). */
function Timeline({ entries, pendingIds, onEdit, onRemove }: {
  entries: LogEntry[]; pendingIds: Set<string>; onEdit: (e: LogEntry) => void; onRemove: (e: LogEntry) => void;
}) {
  const sorted = entries.map((e) => ({ e, m: entryMinutes(e) })).sort((a, b) => a.m - b.m);
  const hours = [...new Set(sorted.map((x) => Math.floor(x.m / 60)))];
  return (
    <div class="timeline">
      {hours.map((h) => {
        const items = sorted.filter((x) => Math.floor(x.m / 60) === h);
        const t = totals(items.map((x) => x.e));
        return (
          <div class="tl-hour" key={h}>
            <div class="tl-head">
              <span class="tl-pill">{hourLabel(h)}</span>
              <span class="tl-tot">{fmt(t.kcal)} kcal · <b class="p">{fmt(t.protein_g)}P</b> <b class="f">{fmt(t.fat_g)}F</b> <b class="c">{fmt(t.carbs_g)}C</b></span>
            </div>
            <div class="card tl-card">
              {items.map(({ e, m }) => (
                <SwipeRow key={e.id} label={`${e.food_name}, ${fmt(e.n.kcal)} kcal`} onTap={() => onEdit(e)} onSwipeRight={() => onEdit(e)} onSwipeLeft={() => onRemove(e)}>
                  <span class="entry-main">
                    <span class="entry-name">{e.food_name}{e.is_estimate ? <span class="tag">estimate</span> : null}</span>
                    <small class="muted">
                      {`${Math.floor(m / 60) % 12 || 12}:${String(m % 60).padStart(2, '0')}`} · {e.group_id ? e.group_name : MEAL_LABELS[e.meal]} · {amountLine(e)}
                      {pendingIds.has(e.id) ? ' · not saved yet' : ''}
                    </small>
                  </span>
                  <span class="entry-kcal">{fmt(e.n.kcal)}</span>
                </SwipeRow>
              ))}
            </div>
          </div>
        );
      })}
    </div>
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

function MacroBars({ t, targets, children }: { t: Nutrients | null; targets: { kcal: number; protein_g: number; carbs_g: number; fat_g: number } | null; children?: ComponentChildren }) {
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
            <div class="macro-track"><span class={`macro-fill k-${key}`} style={{ width: `${pct}%` }} />{target ? <span class="macro-mark" /> : null}</div>
          </div>
        );
      })}
      {!targets && <small class="muted">Targets appear after your first weigh-in and profile (sex, birth date, height in Settings).</small>}
      {children}
    </div>
  );
}

function WeekGrid({ week, start, selected, mode, onMode, onPick }: {
  week: WeekData; start: string; selected: string; mode: 'consumed' | 'remaining'; onMode: (m: 'consumed' | 'remaining') => void; onPick: (d: string) => void;
}) {
  const dates = DOW.map((_, i) => shiftDate(start, i));
  const rows: [string, 'kcal' | 'protein_g' | 'fat_g' | 'carbs_g'][] = [['kcal', 'kcal'], ['P', 'protein_g'], ['F', 'fat_g'], ['C', 'carbs_g']];
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
      <div class="wk">
        <div class="wk-cols">
          {dates.map((d, i) => {
            const day = week.days.get(d);
            const t = day ? totals(day.entries) : null;
            const tg = targetFor(d, day);
            return (
              <button key={d} class={`wk-col ${d === selected ? 'on' : ''} ${d === today() ? 'today' : ''}`} onClick={() => onPick(d)}
                aria-label={`${DOW[i]} ${t ? fmt(t.kcal) : 0} kcal`}>
                {rows.map(([, k]) => {
                  const v = (t?.[k] as number) ?? 0;
                  const target = tg?.[k] ?? 0;
                  if (mode === 'remaining') {
                    return <span key={k} class={`wk-num k-${k}`}>{target ? fmt(target - v) : '·'}</span>;
                  }
                  // Fill = share of the day's target (or of the week's highest day when there's no target yet).
                  const scaleTo = target || Math.max(1, ...dates.map((x) => (week.days.get(x) ? (totals(week.days.get(x)!.entries)[k] as number) : 0)));
                  const pct = Math.min(100, (v / scaleTo) * 100);
                  return (
                    <span key={k} class="wk-bar">
                      {v > 0 ? <span class={`wk-fill k-${k}`} style={{ height: `${Math.max(8, pct)}%` }} /> : <span class="wk-dash" />}
                      {target ? <span class="wk-tick" /> : null}
                    </span>
                  );
                })}
                <span class="wk-dow">{DOW[i]}</span>
              </button>
            );
          })}
        </div>
        <div class="wk-sum">
          {rows.map(([label, k], i) => {
            const sel = week.days.get(selected);
            const v = sel ? (totals(sel.entries)[k] as number) : 0;
            const target = targetFor(selected, sel)?.[k] ?? 0;
            return (
              <div key={k} class="wk-sum-row">
                <strong>{fmt(mode === 'remaining' && target ? target - v : v)}<span class={`wk-unit k-${k}`}>{i === 0 ? ' kcal' : ` ${label}`}</span></strong>
                <small class="muted">{target ? `${mode === 'remaining' ? 'left of' : 'of'} ${fmt(target)}` : '—'}</small>
              </div>
            );
          })}
        </div>
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
          <input id="weigh" ref={input} type="text" inputMode="decimal" step="0.1" value={value} onInput={(e) => setValue(e.currentTarget.value)} />
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
        {!meals && <SkeletonRows rows={3} />}
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
        <Sparkline values={exp.map((e) => e.kcal)} color="#ff8a65" />
      </button>
      <button class="trend-card" onClick={() => onOpen('weight')}>
        <small>Weight trend</small>
        <strong>{fmt(lastTrend.trend, 1)}</strong>
        <small>{delta >= 0 ? '+' : '−'}{fmt(Math.abs(delta), 1)} lb / 7 d</small>
        <Sparkline values={tr.map((p) => p.trend)} color="#b49cff" />
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
