// Reads/writes food data in the Sheet. Failed writes go to the retry queue (never dropped).
import {
  entryToRow, foodToRow, rowToEntry, rowToFood, totals, type Food, type LogEntry,
} from '../../shared/nutrition';
import type { Row } from '../../shared/schema';
import { api, ApiError, errorMessage } from './api';
import { queue } from './queue';
import { getSettings } from './settingsStore';

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

// ---------- Imported history (FoodArchive tab) ----------

/** Imported entries live in FoodArchive; everything logged in Plates lives in FoodLog. */
export const logTab = (e: Pick<LogEntry, 'entry_method'>): 'FoodLog' | 'FoodArchive' =>
  e.entry_method.startsWith('import') ? 'FoodArchive' : 'FoodLog';

/** True when dates on or before `from` may have imported entries. */
const needsArchive = (from: string) => {
  const through = getSettings().archive_through ?? '';
  return !!through && from <= through;
};

export async function loadDay(date: string): Promise<DayData> {
  const archive = needsArchive(date);
  const d = await readTabs(archive ? ['FoodLog', 'FoodArchive', 'Days'] : ['FoodLog', 'Days'],
    { FoodLog: { date }, FoodArchive: { date }, Days: { date } });
  const entries = [...(d.FoodArchive ?? []), ...(d.FoodLog ?? [])].map(rowToEntry);
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
  return write('/sheet/update', { tab: logTab(e), rows: [entryToRow(e)] }, `Edit: ${e.food_name}`);
}

export async function deleteEntry(e: LogEntry): Promise<boolean> {
  return write('/sheet/update', { tab: logTab(e), rows: [{ id: e.id, deleted_at: new Date().toISOString() }] }, `Delete: ${e.food_name}`);
}

export async function restoreEntry(e: LogEntry): Promise<boolean> {
  return write('/sheet/update', { tab: logTab(e), rows: [{ id: e.id, deleted_at: '' }] }, `Restore: ${e.food_name}`);
}

/** Writes the day's totals and "day complete" flag to the Days tab. */
export async function saveDay(
  date: string, entries: LogEntry[], dayComplete: boolean,
  targets?: { kcal: number; protein_g: number; carbs_g: number; fat_g: number } | null,
): Promise<boolean> {
  const t = totals(entries);
  return write('/sheet/upsert', {
    tab: 'Days',
    key: 'date',
    rows: [{
      date, day_complete: dayComplete,
      total_kcal: t.kcal, total_protein_g: t.protein_g, total_carbs_g: t.carbs_g, total_fat_g: t.fat_g,
      ...(targets ? { target_kcal: targets.kcal, target_protein_g: targets.protein_g, target_carbs_g: targets.carbs_g, target_fat_g: targets.fat_g } : {}),
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

// ---------- Week view (Today screen) ----------

export interface WeekData {
  days: Map<string, DayData>; // every date in the range, even empty ones
}

/** Loads FoodLog + Days for a date range in one request. */
export async function loadRange(from: string, to: string): Promise<WeekData> {
  const range = { date__gte: from, date__lte: to };
  const d = await readTabs(needsArchive(from) ? ['FoodLog', 'FoodArchive', 'Days'] : ['FoodLog', 'Days'],
    { FoodLog: range, FoodArchive: range, Days: range });
  const days = new Map<string, DayData>();
  for (let cur = from; cur <= to; cur = nextDate(cur)) {
    days.set(cur, { entries: [], pendingIds: new Set(), dayComplete: false, dayRow: null });
  }
  for (const r of [...(d.FoodArchive ?? []), ...(d.FoodLog ?? [])]) days.get(String(r.date))?.entries.push(rowToEntry(r));
  for (const r of d.Days ?? []) {
    const day = days.get(String(r.date));
    if (day && !day.dayRow) {
      day.dayRow = r;
      day.dayComplete = r.day_complete === true || r.day_complete === 'TRUE';
    }
  }
  for (const [date, day] of days) {
    const seen = new Set(day.entries.map((e) => e.id));
    const pending = pendingEntries(date).filter((e) => !seen.has(e.id));
    day.entries.push(...pending);
    day.pendingIds = new Set(pending.map((e) => e.id));
  }
  return { days };
}

function nextDate(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Monday of the week containing `date`. */
export function weekStart(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Mon = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

/** Copies a meal's entries from one date to another (new ids). Returns the new entries. */
export async function copyEntries(entries: LogEntry[], toDate: string): Promise<{ copied: LogEntry[]; ok: boolean }> {
  const copied = entries.map((e) => ({ ...e, id: uuid(), date: toDate, entry_method: 'copy' }));
  if (!copied.length) return { copied, ok: true };
  const ok = await write('/sheet/append', { tab: 'FoodLog', rows: copied.map(entryToRow) }, `Copy ${copied.length} item(s)`);
  return { copied, ok };
}

// ---------- Recents and last-used amounts ----------

export interface RecentFood { food: Food; grams: number; lastLogged: string }

/** Distinct foods from the last 60 days of the log, newest first, with the last amount used. */
export async function loadRecents(today: string): Promise<RecentFood[]> {
  const from = new Date(`${today}T12:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 60);
  const [d, foods] = await Promise.all([
    readTabs(['FoodLog'], { FoodLog: { date__gte: from.toISOString().slice(0, 10) } }),
    loadFoods(),
  ]);
  const byId = new Map(foods.map((f) => [f.id!, f]));
  const rows = [...(d.FoodLog ?? [])].sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));
  const out: RecentFood[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const id = String(r.food_id ?? '');
    const food = byId.get(id);
    if (!id || !food || seen.has(id) || !(Number(r.grams) > 0)) continue;
    seen.add(id);
    out.push({ food, grams: Number(r.grams), lastLogged: String(r.date) });
    lastGrams.set(id, Number(r.grams));
    if (out.length >= 30) break;
  }
  return out;
}

const lastGrams = new Map<string, number>();

/** Last amount used for a food, else one serving, else 100 g. */
export function defaultGrams(food: Food): number {
  return (food.id && lastGrams.get(food.id)) || food.grams_per_serving || 100;
}

export function rememberGrams(food: Food, grams: number): void {
  if (food.id) lastGrams.set(food.id, grams);
}

export async function setFavorite(food: Food, favorite: boolean): Promise<Food> {
  const saved = await saveFood(food);
  const next = { ...saved, favorite };
  await write('/sheet/update', { tab: 'Foods', rows: [{ id: next.id!, favorite }] }, `${favorite ? 'Favorite' : 'Unfavorite'}: ${food.name}`);
  foodsCache = (foodsCache ?? []).map((f) => (f.id === next.id ? next : f));
  return next;
}

// ---------- Saved meals ----------

export interface SavedMealItem { food_id: string; grams: number }
export interface SavedMeal { id: string; name: string; items: SavedMealItem[] }

export async function loadSavedMeals(): Promise<SavedMeal[]> {
  const d = await readTabs(['SavedMeals']);
  return (d.SavedMeals ?? []).map((r) => {
    let items: SavedMealItem[] = [];
    try { items = JSON.parse(String(r.items_json || '[]')); } catch { items = []; }
    return { id: String(r.id), name: String(r.name ?? ''), items: Array.isArray(items) ? items : [] };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

export async function createSavedMeal(name: string, entries: LogEntry[]): Promise<SavedMeal> {
  const meal: SavedMeal = {
    id: uuid(),
    name,
    items: entries.filter((e) => e.food_id && e.grams).map((e) => ({ food_id: e.food_id, grams: e.grams! })),
  };
  await write('/sheet/append', { tab: 'SavedMeals', rows: [{ id: meal.id, name, items_json: JSON.stringify(meal.items) }] }, `Saved meal: ${name}`);
  return meal;
}

export async function deleteSavedMeal(m: SavedMeal): Promise<void> {
  await write('/sheet/update', { tab: 'SavedMeals', rows: [{ id: m.id, deleted_at: new Date().toISOString() }] }, `Delete saved meal: ${m.name}`);
}
