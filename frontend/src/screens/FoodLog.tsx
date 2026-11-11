import { useEffect, useState } from 'preact/hooks';
import { MEAL_LABELS, MEALS, totals, type LogEntry, type Meal } from '../../../shared/nutrition';
import { ApiError, errorMessage } from '../api';
import { EntrySheet } from '../components/EntrySheet';
import { IconBack, IconChevron, IconPlus } from '../components/Icons';
import { dateLabel, shiftDate, today } from '../dates';
import { dayOutOfDate, loadDay, saveDay, type DayData } from '../foodData';
import { amountLine, fmt } from '../format';
import { queue } from '../queue';
import { showToast } from '../toast';

interface Props {
  date: string;
  onDate: (d: string) => void;
  onAdd: (meal: Meal) => void;
  version: number; // bump to reload after adding food
}

export function FoodLog({ date, onDate, onAdd, version }: Props) {
  const [day, setDay] = useState<DayData | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<LogEntry | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const d = await loadDay(date);
      setDay(d);
      // Keep the Days tab totals in step with the log (self-healing after any edit).
      if (!d.pendingIds.size && dayOutOfDate(d)) void saveDay(date, d.entries, d.dayComplete);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [date, version]);
  useEffect(() => queue.subscribe(() => { if (!queue.list().length) void load(); }), [date]);

  async function toggleComplete() {
    if (!day) return;
    const next = !day.dayComplete;
    setDay({ ...day, dayComplete: next });
    try {
      const ok = await saveDay(date, day.entries, next);
      if (!ok) showToast('Not saved yet — will retry', 'error');
    } catch (err) {
      setDay({ ...day, dayComplete: !next });
      showToast(errorMessage(err), 'error');
    }
  }

  function afterEdit(updated: LogEntry[]) {
    if (!day) return;
    setDay({ ...day, entries: updated });
    setEditing(null);
    void saveDay(date, updated, day.dayComplete);
  }

  const t = day ? totals(day.entries) : null;
  const notReady = error instanceof ApiError && ['sheet_not_set_up', 'google_not_connected', 'google_reconnect'].includes(error.code);

  return (
    <section>
      <header class="screen-head">
        <h1>Food Log</h1>
        <div class="date-nav">
          <button class="icon-btn" aria-label="Previous day" onClick={() => onDate(shiftDate(date, -1))}><IconBack /></button>
          <label class="date-pick">
            <span>{dateLabel(date)}</span>
            <input type="date" value={date} aria-label="Pick a date" onChange={(e) => e.currentTarget.value && onDate(e.currentTarget.value)} />
          </label>
          <button class="icon-btn" aria-label="Next day" onClick={() => onDate(shiftDate(date, 1))}><IconChevron /></button>
          {date !== today() && <button class="btn link" onClick={() => onDate(today())}>Today</button>}
        </div>
      </header>

      {error && (
        <div class="card">
          <p class={notReady ? 'muted' : 'error'}>
            {notReady ? 'Connect Google and create the spreadsheet in More first.' : errorMessage(error)}
          </p>
          {!notReady && <button class="btn" onClick={load}>Try again</button>}
        </div>
      )}

      {!error && (
        <div class="card totals">
          <div class="big">{t ? fmt(t.kcal) : '–'}<small> kcal</small></div>
          <div class="macro-grid">
            <div><strong>{t ? fmt(t.protein_g) : '–'}</strong><span>Protein g</span></div>
            <div><strong>{t ? fmt(t.carbs_g) : '–'}</strong><span>Carbs g</span></div>
            <div><strong>{t ? fmt(t.fat_g) : '–'}</strong><span>Fat g</span></div>
          </div>
        </div>
      )}

      {loading && !day && !error && <p class="muted center">Loading…</p>}

      {day && MEALS.map((meal) => {
        const items = day.entries.filter((e) => e.meal === meal);
        const mt = totals(items);
        return (
          <div class="card meal" key={meal}>
            <div class="meal-head">
              <h2>{MEAL_LABELS[meal]}</h2>
              <span class="muted">{items.length ? `${fmt(mt.kcal)} kcal` : ''}</span>
              <button class="icon-btn small" aria-label={`Add to ${MEAL_LABELS[meal]}`} onClick={() => onAdd(meal)}><IconPlus size={20} /></button>
            </div>
            {items.length === 0 && <p class="muted tiny-pad">Nothing logged.</p>}
            {items.map((e) => (
              <button class="entry" key={e.id} onClick={() => setEditing(e)}>
                <span class="entry-main">
                  <span class="entry-name">{e.food_name}</span>
                  <small class="muted">{amountLine(e)}{day.pendingIds.has(e.id) ? ' · not saved yet' : ''}</small>
                </span>
                <span class="entry-kcal">{fmt(e.n.kcal)}</span>
              </button>
            ))}
          </div>
        );
      })}

      {day && (
        <label class="card complete-row">
          <input type="checkbox" checked={day.dayComplete} onChange={toggleComplete} />
          <span>
            <strong>Day complete</strong>
            <small class="muted">Tick when everything you ate today is logged. Only complete days are used to estimate expenditure.</small>
          </span>
        </label>
      )}

      {editing && day && (
        <EntrySheet
          entry={editing}
          onClose={() => setEditing(null)}
          onSaved={(e) => afterEdit(day.entries.map((x) => (x.id === e.id ? e : x)))}
          onDeleted={(e) => afterEdit(day.entries.filter((x) => x.id !== e.id))}
        />
      )}
    </section>
  );
}
