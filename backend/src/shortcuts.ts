// iPhone Shortcuts integration: a separate revocable key (never the passcode) and three small endpoints.
// Setup guide: docs/shortcuts.md.
import { nameScore } from '../../shared/ai';
import { targetsFor, type StoredCheckIn } from '../../shared/coaching';
import { entryToRow, foodToRow, makeEntry, rowToEntry, rowToFood, totals, type Food, type LogEntry } from '../../shared/nutrition';
import { chicagoDate, mealForMinutes, type Row } from '../../shared/schema';
import { cleanContext, estimate } from './ai';
import { b64urlEncode, randomBytes, timingSafeEqual } from './crypto';
import type { Env } from './env';
import { searchUsda } from './food';
import { HttpError } from './http';
import { applyFilters, type Sheets } from './sheets';

const KEY_HASH = 'shortcut:key_hash';
const KEY_CREATED = 'shortcut:key_created';
const PREFIX = 'plk_';

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

/** Makes a new key (shown once). Only its hash is stored, so a KV leak can't be replayed. Replaces any old key. */
export async function createShortcutKey(kv: KVNamespace, nowMs = Date.now()): Promise<{ key: string; created_at: string }> {
  const key = PREFIX + b64urlEncode(randomBytes(32));
  const created_at = new Date(nowMs).toISOString();
  await kv.put(KEY_HASH, b64urlEncode(await sha256(key)));
  await kv.put(KEY_CREATED, created_at);
  return { key, created_at };
}

export async function revokeShortcutKey(kv: KVNamespace): Promise<void> {
  await kv.delete(KEY_HASH);
  await kv.delete(KEY_CREATED);
}

export async function shortcutKeyStatus(kv: KVNamespace): Promise<{ exists: boolean; created_at: string | null }> {
  const [h, c] = await Promise.all([kv.get(KEY_HASH), kv.get(KEY_CREATED)]);
  return { exists: !!h, created_at: h ? c : null };
}

export async function requireShortcutKey(request: Request, kv: KVNamespace): Promise<void> {
  const m = /^Bearer\s+(plk_[A-Za-z0-9_-]{20,100})$/.exec(request.headers.get('Authorization') ?? '');
  const stored = await kv.get(KEY_HASH);
  if (!m || !stored) throw new HttpError(401, 'bad_shortcut_key', 'Shortcuts key missing or revoked. Make a new one in Plates → Settings → Shortcuts.');
  const actual = b64urlEncode(await sha256(m[1]!));
  if (!timingSafeEqual(new TextEncoder().encode(actual), new TextEncoder().encode(stored))) {
    throw new HttpError(401, 'bad_shortcut_key', 'Shortcuts key missing or revoked. Make a new one in Plates → Settings → Shortcuts.');
  }
}

const chicagoTime = (at: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
const live = (rows: Row[]) => applyFilters(rows, undefined, false);

// ---------- Weight (Apple Health → Plates) ----------

export async function shortcutWeight(sheets: Sheets, body: { weight?: unknown; unit?: unknown; date?: unknown }, now = new Date()) {
  let w = typeof body.weight === 'string' ? parseFloat(body.weight) : Number(body.weight);
  const unit = String(body.unit ?? 'lb').toLowerCase();
  if (unit.startsWith('kg')) w *= 2.2046226218;
  if (!(w > 50 && w < 800)) throw new HttpError(400, 'bad_weight', 'Send a weight between 50 and 800 lb (or the same in kg with "unit": "kg").');
  const date = typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : chicagoDate(now);
  const weight_lb = Math.round(w * 10) / 10;
  const today = live((await sheets.readTabs(['Weights'])).Weights!.rows.map((r) => r.data)).filter((r) => String(r.date) === date);
  // Health often re-sends the same reading; don't log it twice.
  if (today.some((r) => Math.abs(Number(r.weight_lb) - weight_lb) < 0.05)) {
    return { ok: true, added: false, message: `Already logged ${weight_lb} lb for ${date}.` };
  }
  await sheets.append('Weights', [{ id: crypto.randomUUID(), date, time: chicagoTime(now), weight_lb, notes: 'Apple Health (Shortcut)' }]);
  return { ok: true, added: true, message: `Logged ${weight_lb} lb.` };
}

// ---------- Today's totals (for the evening nudge) ----------

function rowToCheckIn(r: Row): StoredCheckIn {
  let plan = {};
  try { plan = JSON.parse(String(r.day_targets_json || '{}')); } catch { plan = {}; }
  return { date: String(r.date), plan, avg: 0, expenditure: Number(r.expenditure_kcal), confidence: String(r.confidence ?? ''), reason: '', trend: Number(r.trend_weight_lb) };
}

async function dayTotals(sheets: Sheets, date: string) {
  const d = await sheets.readTabs(['FoodLog', 'Days', 'CheckIns']);
  const entries = live(d.FoodLog!.rows.map((r) => r.data)).filter((r) => String(r.date) === date).map(rowToEntry);
  const day = live(d.Days!.rows.map((r) => r.data)).find((r) => String(r.date) === date);
  const target = targetsFor(date, d.CheckIns!.rows.map((r) => rowToCheckIn(r.data)));
  return { entries, t: totals(entries), target, complete: day?.day_complete === true || day?.day_complete === 'TRUE' };
}

export async function shortcutSummary(sheets: Sheets, now = new Date()) {
  const date = chicagoDate(now);
  const { entries, t, target, complete } = await dayTotals(sheets, date);
  const left = target ? target.kcal - t.kcal : null;
  const k = (n: number) => Math.round(n).toLocaleString('en-US');
  const text = !entries.length
    ? 'Nothing logged today yet.'
    : `${k(t.kcal)}${target ? ` of ${k(target.kcal)}` : ''} kcal${left != null ? ` · ${left >= 0 ? `${k(left)} left` : `${k(-left)} over`}` : ''} · protein ${k(t.protein_g)}${target ? `/${k(target.protein_g)}` : ''} g.${complete ? '' : ' Day not marked complete.'}`;
  return {
    date, kcal: t.kcal, protein_g: t.protein_g, carbs_g: t.carbs_g, fat_g: t.fat_g,
    kcal_target: target?.kcal ?? null, kcal_left: left, items: entries.length, day_complete: complete, text,
  };
}

// ---------- Quick log ("2 eggs and toast") ----------

const norm = (s: string) => s.trim().toLowerCase();

function matchSaved(name: string, foods: Food[]): Food | undefined {
  return foods.find((f) => norm(f.name) === norm(name))
    ?? foods.find((f) => f.source !== 'quick' && nameScore(f.name, name) === 1 && nameScore(name, f.name) === 1);
}

export async function shortcutLog(env: Env, sheets: Sheets, body: { text?: unknown; meal?: unknown }, now = new Date()) {
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (text.length < 2 || text.length > 300) throw new HttpError(400, 'bad_text', 'Say what you ate, e.g. "2 eggs and a slice of toast".');
  const date = chicagoDate(now);
  const settings = await sheets.readSettings();
  const [h, m] = chicagoTime(now).split(':').map(Number) as [number, number];
  const meal = (['breakfast', 'lunch', 'dinner', 'snack'] as const).find((x) => x === body.meal) ?? mealForMinutes(h * 60 + m, settings);

  const est = await estimate(env, sheets, { description: text, images: [], context: { ...cleanContext({}), hasSide: false } }, now.getTime());
  const foods = live((await sheets.readTabs(['Foods'])).Foods!.rows.map((r) => r.data)).map(rowToFood);
  const logged: LogEntry[] = [];
  const missed: string[] = [...est.skipped];
  const newFoods: Food[] = [];
  for (const item of est.items) {
    let food = matchSaved(item.name, foods);
    if (!food) {
      const usda = await searchUsda(item.name, env.USDA_API_KEY).catch(() => [] as Food[]);
      const hit = usda.find((f) => !f.brand) ?? usda[0];
      if (hit) {
        food = foods.find((f) => f.source === hit.source && f.source_id === hit.source_id) ?? { ...hit, id: crypto.randomUUID() };
        if (!foods.includes(food)) { foods.push(food); newFoods.push(food); }
      }
    }
    if (!food) { missed.push(item.name); continue; }
    logged.push(makeEntry({ id: crypto.randomUUID(), date, meal, food, grams: item.grams, method: 'shortcut', notes: `"${text}"`, is_estimate: true }));
  }
  if (newFoods.length) await sheets.append('Foods', newFoods.map(foodToRow).map((r, i) => ({ ...r, id: newFoods[i]!.id! })));
  if (logged.length) await sheets.append('FoodLog', logged.map(entryToRow));

  // Keep the day's totals current so coaching sees them even if the app isn't opened today.
  const day = await dayTotals(sheets, date);
  await sheets.upsertBy('Days', 'date', [{
    date, total_kcal: day.t.kcal, total_protein_g: day.t.protein_g, total_carbs_g: day.t.carbs_g, total_fat_g: day.t.fat_g,
  }]);

  const kcal = Math.round(logged.reduce((s, e) => s + e.n.kcal, 0));
  const label = meal.charAt(0).toUpperCase() + meal.slice(1);
  const message = logged.length
    ? `Logged ${logged.map((e) => e.food_name.split(',')[0]!.toLowerCase()).join(', ')} to ${label}, about ${kcal.toLocaleString('en-US')} kcal.${missed.length ? ` Couldn't find: ${missed.join(', ')}.` : ''}`
    : `Couldn't match any food in "${text}". Try different words or log it in the app.`;
  return { ok: logged.length > 0, message, meal, kcal, items: logged.map((e) => ({ name: e.food_name, grams: e.grams, kcal: e.n.kcal })), missed };
}
