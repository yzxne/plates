// AI estimate helpers: API calls, usual portions (Portions tab), food matching and logging (brief §6 / §6A).
import { nameScore, type AiItem, type EstimateContext, type Source } from '../../shared/ai';
import { makeEntry, type Food, type LogEntry, type Meal } from '../../shared/nutrition';
import { api } from './api';
import { addEntry, cachedFoods, loadFoods, readTabs, saveFood, uuid, write } from './foodData';
import type { ResizedImage } from './imageResize';
import { safeStore } from './storage';

export interface AiResponse { items: AiItem[]; skipped?: string[]; cost_usd: number; month_total: number; cap: number }
export interface AiUsage { month_total: number; count: number; cap: number; configured: boolean }

export const getUsage = () => api<AiUsage>('GET', '/ai/usage');

export function scanMeal(images: ResizedImage[], description: string, context: EstimateContext): Promise<AiResponse> {
  return api('POST', '/ai/meal-scan', { images: images.map((i) => ({ data: i.data, media_type: i.media_type })), description, context }, 60_000);
}

export function estimateText(description: string, context: EstimateContext): Promise<AiResponse> {
  return api('POST', '/ai/text-estimate', { description, context }, 60_000);
}

// ---------- Remembered choices ----------

const LAST_SOURCE = 'plates.ai.source';
const LAST_PLACE = 'plates.ai.place.';

export function lastSource(): Source {
  const s = safeStore.getItem(LAST_SOURCE);
  return s === 'cafeteria' || s === 'homemade' ? s : 'restaurant';
}
export function lastPlace(source: Source, cafeteriaDefault: string): string {
  return safeStore.getItem(LAST_PLACE + source) ?? (source === 'cafeteria' ? cafeteriaDefault : '');
}
export function rememberChoice(source: Source, place: string): void {
  safeStore.setItem(LAST_SOURCE, source);
  safeStore.setItem(LAST_PLACE + source, place);
}

// ---------- Usual portions ----------

export interface UsualPortion { id: string; source: string; place: string; label: string; grams: number; measured: boolean }

let portionsCache: UsualPortion[] | null = null;
export async function loadPortions(): Promise<UsualPortion[]> {
  if (portionsCache) return portionsCache;
  const d = await readTabs(['Portions']);
  portionsCache = (d.Portions ?? []).flatMap((r) => {
    const grams = Number(r.grams);
    return grams > 0 && r.label ? [{
      id: String(r.id), source: String(r.source ?? ''), place: String(r.place ?? ''), label: String(r.label), grams,
      measured: r.measured === true || r.measured === 'TRUE' || r.measured === 'true',
    }] : [];
  });
  return portionsCache;
}

const samePlace = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function portionsFor(all: UsualPortion[], place: string): UsualPortion[] {
  return place.trim() ? all.filter((p) => samePlace(p.place, place)) : [];
}

/** Usual portion for an AI item at this place (overrides the AI grams). */
export function usualFor(portions: UsualPortion[], name: string): UsualPortion | undefined {
  let best: UsualPortion | undefined;
  let bestScore = 0.66;
  for (const p of portions) {
    const s = nameScore(p.label, name);
    if (s > bestScore) { best = p; bestScore = s; }
  }
  return best;
}

export async function saveUsualPortion(source: Source, place: string, label: string, grams: number): Promise<void> {
  const all = await loadPortions();
  const existing = all.find((p) => samePlace(p.place, place) && p.label.toLowerCase() === label.toLowerCase());
  if (existing) {
    await write('/sheet/update', { tab: 'Portions', rows: [{ id: existing.id, grams }] }, `Usual portion: ${label}`);
    existing.grams = grams;
    return;
  }
  const p: UsualPortion = { id: uuid(), source, place, label, grams, measured: false };
  await write('/sheet/append', { tab: 'Portions', rows: [{ id: p.id, source, place, label, grams, measured: false }] }, `Usual portion: ${label}`);
  portionsCache = [...all, p];
}

// ---------- Food matching ----------

const norm = (s: string) => s.trim().toLowerCase();

/** Best saved food for an AI item name: a cached AI food with the same name first, then a close saved match. */
export function matchSaved(name: string, foods: Food[], place = ''): Food | undefined {
  const exact = foods.filter((f) => norm(f.name) === norm(name));
  const exactAi = exact.find((f) => f.source === 'ai' && norm(f.brand) === norm(place)) ?? exact.find((f) => f.source === 'ai');
  if (exactAi || exact[0]) return exactAi ?? exact[0];
  const words = name.split(/[\s,]+/).filter(Boolean).length;
  let best: Food | undefined;
  for (const f of foods) {
    if (f.source === 'quick') continue;
    const fw = f.name.split(/[\s,]+/).filter(Boolean).length;
    if (Math.abs(fw - words) <= 1 && nameScore(f.name, name) === 1 && nameScore(name, f.name) === 1) { best = f; break; }
  }
  return best;
}

export async function searchUsda(q: string, brands = false): Promise<Food[]> {
  return (await api<{ foods: Food[] }>('GET', `/food/search?source=${brands ? 'usda_brands' : 'usda'}&q=${encodeURIComponent(q)}`)).foods;
}

/** Saved food first, else the first generic (unbranded) USDA result. */
export async function matchFood(name: string, place = ''): Promise<Food | null> {
  const saved = matchSaved(name, await loadFoods().catch(() => cachedFoods()), place);
  if (saved) return saved;
  const usda = await searchUsda(name).catch(() => [] as Food[]);
  return usda.find((f) => !f.brand) ?? usda[0] ?? null;
}

/** Chain-menu lookup before using AI for restaurants: saved foods and USDA branded items mentioning the place. */
export async function chainLookup(place: string, description: string): Promise<Food[]> {
  const placeWords = place.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const mentionsPlace = (f: Food) => placeWords.some((w) => `${f.brand} ${f.name}`.toLowerCase().includes(w.replace(/'s$/, '')));
  const saved = (await loadFoods().catch(() => cachedFoods())).filter((f) => mentionsPlace(f) && nameScore(f.name, description) >= 0.5);
  const usda = await searchUsda(`${place} ${description}`, true).catch(() => [] as Food[]);
  return [...saved, ...usda.filter((f) => f.brand && mentionsPlace(f))].slice(0, 12);
}

// ---------- Logging ----------

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Caches the confirmed result as a Foods row (source "ai") so the same item is instant next time. */
export async function cacheAiFood(name: string, place: string, matched: Food): Promise<Food> {
  // An AI food cached for another place is reused for its nutrition only, never its place label.
  if (matched.source === 'ai' && matched.id && norm(matched.brand) === norm(place)) return matched;
  const display = titleCase(name.trim());
  const existing = cachedFoods().find((f) => f.source === 'ai' && norm(f.name) === norm(display) && norm(f.brand) === norm(place));
  if (existing) return existing;
  return saveFood({
    name: display, brand: place.trim(), source: 'ai', source_id: matched.source_id || matched.id || '', barcode: '',
    serving_size: '', grams_per_serving: null, per100: matched.per100,
  });
}

export async function logAiItem(args: {
  date: string; meal: Meal; name: string; grams: number; matched: Food; source: Source; place: string; method: string;
  /** Log as part of a combo (several foods shown as one item). */
  group?: { id: string; name: string };
}): Promise<{ entry: LogEntry; ok: boolean }> {
  const food = await cacheAiFood(args.name, args.place, args.matched);
  const entry = makeEntry({
    id: uuid(), date: args.date, meal: args.meal, food, grams: args.grams, method: args.method,
    food_source: args.source, place: args.place.trim(), is_estimate: true,
  });
  if (args.group) Object.assign(entry, { group_id: args.group.id, group_name: args.group.name });
  return { entry, ok: await addEntry(entry) };
}
