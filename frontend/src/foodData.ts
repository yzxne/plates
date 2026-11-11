// Reads/writes food data in the Sheet. Failed writes go to the retry queue (never dropped).
import {
  entryToRow, foodToRow, rowToEntry, rowToFood, totals, type Food, type LogEntry,
} from '../../shared/nutrition';
import type { Row } from '../../shared/schema';
import { api, ApiError, errorMessage } from './api';
import { queue } from './queue';

export const uuid = () => crypto.randomUUID();

interface ReadResult { data: Record<string, Row[]> }

export async function readTabs(tabs: string[], filters: Record<string, Record<string, string | number>> = {}): Promise<Record<string, Row[]>> {
  return (await api<ReadResult>('POST', '/sheet/read', { tabs, filters })).data;
}

/** Sends a write; on a retryable failure queues it and returns false. Throws on rejected writes. */
export async function write(path: string, body: unknown, label: string): Promise<boolean> {
  try {
    await api('POST', path, body);
    return true;
  } catch (err) {
    if (err instanceof ApiError && !err.retryable) throw err;
    queue.add({ method: 'POST', path, body, label, error: errorMessage(err) });
    return false;
  }
}

// ---------- Foods ----------

let foodsCache: Food[] | null = null;
let foodsLoading: Promise<Food[]> | null = null;

export function loadFoods(force = false): Promise<Food[]> {
  if (foodsCache && !force) return Promise.resolve(foodsCache);
  if (!foodsLoading) {
    foodsLoading = readTabs(['Foods'])
      .then((d) => {
        const rows = [...(d.Foods ?? [])].sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')));
        foodsCache = rows.map(rowToFood);
        return foodsCache;
      })
      .finally(() => { foodsLoading = null; });
  }
  return foodsLoading;
}

export function cachedFoods(): Food[] {
  return foodsCache ?? [];
}

export function findFood(id: string): Food | undefined {
  return foodsCache?.find((f) => f.id === id);
}

/** Finds an already-saved copy of a USDA/OFF food so it isn't saved twice. */
export function findSaved(food: Food): Food | undefined {
  if (food.id) return food;
  if (!food.source_id || !['usda', 'off'].includes(food.source)) return undefined;
  return foodsCache?.find((f) => f.source === food.source && f.source_id === food.source_id);
}

/** Saves a food to the Foods tab (if not already saved) and returns it with an id. */
export async function saveFood(food: Food): Promise<Food> {
  const existing = findSaved(food);
  if (existing) return existing;
  const saved: Food = { ...food, id: uuid() };
  await write('/sheet/append', { tab: 'Foods', rows: [foodToRow(saved)] }, `Save food: ${food.name}`);
  foodsCache = [saved, ...(foodsCache ?? [])];
  return saved;
}

export async function deleteFood(food: Food): Promise<void> {
  if (!food.id) return;
  await write('/sheet/update', { tab: 'Foods', rows: [{ id: food.id, deleted_at: new Date().toISOString() }] }, `Delete food: ${food.name}`);
  foodsCache = (foodsCache ?? []).filter((f) => f.id !== food.id);
}

// ---------- Food log ----------

export interface DayData {
  entries: LogEntry[];
  pendingIds: Set<string>;
  dayComplete: boolean;
  dayRow: Row | null;
}

/** Log entries that failed to save and are waiting in the retry queue. */
function pendingEntries(date: string): LogEntry[] {
  const out: LogEntry[] = [];
  for (const w of queue.list()) {
    const b = w.body as { tab?: string; rows?: Row[] };
    if (w.path === '/sheet/append' && b?.tab === 'FoodLog') {
      for (const r of b.rows ?? []) if (r.date === date) out.push(rowToEntry(r));
    }
  }
  return out;
}

export async function loadDay(date: string): Promise<DayData> {
  const d = await readTabs(['FoodLog', 'Days'], { FoodLog: { date }, Days: { date } });
  const entries = (d.FoodLog ?? []).map(rowToEntry);
  const seen = new Set(entries.map((e) => e.id));
  const pending = pendingEntries(date).filter((e) => !seen.has(e.id));
  const dayRow = d.Days?.[0] ?? null;
  return {
    entries: [...entries, ...pending],
    pendingIds: new Set(pending.map((e) => e.id)),
    dayComplete: dayRow?.day_complete === true || dayRow?.day_complete === 'TRUE',
    dayRow,
  };
}

export async function addEntry(e: LogEntry): Promise<boolean> {
  return write('/sheet/append', { tab: 'FoodLog', rows: [entryToRow(e)] }, `Log: ${e.food_name}`);
}

export async function updateEntry(e: LogEntry): Promise<boolean> {
  return write('/sheet/update', { tab: 'FoodLog', rows: [entryToRow(e)] }, `Edit: ${e.food_name}`);
}

export async function deleteEntry(e: LogEntry): Promise<boolean> {
  return write('/sheet/update', { tab: 'FoodLog', rows: [{ id: e.id, deleted_at: new Date().toISOString() }] }, `Delete: ${e.food_name}`);
}

/** Writes the day's totals and "day complete" flag to the Days tab. */
export async function saveDay(date: string, entries: LogEntry[], dayComplete: boolean): Promise<boolean> {
  const t = totals(entries);
  return write('/sheet/upsert', {
    tab: 'Days',
    key: 'date',
    rows: [{
      date, day_complete: dayComplete,
      total_kcal: t.kcal, total_protein_g: t.protein_g, total_carbs_g: t.carbs_g, total_fat_g: t.fat_g,
    }],
  }, `Day totals ${date}`);
}

/** True when the Days row doesn't match what the log adds up to (so it should be rewritten). */
export function dayOutOfDate(day: DayData): boolean {
  const t = totals(day.entries);
  const r = day.dayRow;
  if (!r) return day.entries.length > 0;
  return Number(r.total_kcal) !== t.kcal || Number(r.total_protein_g) !== t.protein_g
    || Number(r.total_carbs_g) !== t.carbs_g || Number(r.total_fat_g) !== t.fat_g;
}
