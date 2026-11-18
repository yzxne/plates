// One ranked list from every search source (FatSecret, USDA everyday foods, your saved foods).
// Scores each food on how well its name + brand match what you typed, boosts foods you've logged before,
// prefers plain foods unless you named a brand, drops duplicates and entries with impossible numbers.
import type { Food } from './nutrition';

const STOP = new Set(['a', 'an', 'the', 'of', 'with', 'and', 'w', 'in', 'on', 'for', 'to']);
const words = (s: string) => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w));

/** "eggs" ~ "egg", "berries" ~ "berry", "tomatoes" ~ "tomato"; prefix match for longer typed words ("chick" → "chicken"). */
const stem = (w: string) => w.replace(/ies$/, 'y').replace(/(ch|sh|x|o)es$/, '$1').replace(/([^s])s$/, '$1');
function hit(x: string, w: string): boolean {
  if (x === w) return true;
  const a = stem(x), b = stem(w);
  return a === b || (b.length >= 3 && a.startsWith(b));
}
const has = (list: string[], w: string) => list.some((x) => hit(x, w));

const KID = /\b(baby|toddler|infant|formula)\b/i;

/** True when a food's numbers can't be right (more than pure fat, or macros far from its calories). */
export function looksBroken(f: Food): boolean {
  const n = f.per100;
  if (!Number.isFinite(n.kcal) || n.kcal < 0 || n.kcal > 902) return true;
  const atwater = 4 * (n.protein_g || 0) + 4 * (n.carbs_g || 0) + 9 * (n.fat_g || 0);
  if (n.kcal === 0) return atwater > 20;
  if (n.kcal >= 40 && atwater > 0 && Math.abs(atwater - n.kcal) / n.kcal > 0.5) return true; // alcohol & fiber-heavy foods stay well inside 50 %
  return false;
}

export interface RankContext {
  /** Foods you've saved or logged; matching results get a boost (by source id, else by name + brand). */
  mine?: Food[];
}

const idKey = (f: Food) => (f.source_id ? `${f.source}:${f.source_id}` : '');
const nameKey = (f: Food) => `${words(f.brand).join(' ')}|${words(f.name).join(' ')}`;

/** Higher = better match for `query`. */
export function foodScore(f: Food, query: string, mineIds: Set<string>, mineNames: Set<string>): number {
  const q = words(query);
  if (!q.length) return 0;
  const name = words(f.name);
  const brand = words(f.brand);
  const all = [...name, ...brand];
  const matched = q.filter((w) => has(all, w)).length;
  const brandHits = q.filter((w) => has(brand, w) && !has(name, w)).length;
  let s = matched * 10 - (q.length - matched) * 15;
  s += q.filter((w) => all.some((x) => stem(x) === stem(w))).length * 4; // whole-word match beats a prefix ("egg" vs "eggplant")
  if (name[0] && q.some((w) => hit(name[0]!, w))) s += 6; // name leads with what you typed
  // How soon every word you typed has appeared in the name: "Rice, white" beats "Beans and white rice".
  const nameWords = q.filter((w) => has(name, w));
  if (nameWords.length) {
    let cover = name.length;
    for (let i = 0; i < name.length; i++) if (nameWords.every((w) => name.slice(0, i + 1).some((x) => hit(x, w)))) { cover = i + 1; break; }
    s -= (cover - nameWords.length) * 1.5;
  }
  s -= Math.max(0, name.length - q.length) * 0.5; // fewer extra words = closer to what you meant
  if (q.every((w) => has(name, w)) && name.length === q.length) s += 4; // exact name
  // Brand: you named it → brand foods first; you didn't → plain (generic) foods first.
  if (brandHits) s += 6 * brandHits;
  else if (brand.length) s -= 3;
  if (/\b(raw|cooked|plain|grilled|baked|boiled)\b/i.test(f.name)) s += 1;
  if (KID.test(f.name) && !q.some((w) => KID.test(w))) s -= 12;
  if (mineIds.has(idKey(f)) || mineNames.has(nameKey(f))) s += 12; // you've eaten it before
  if (f.grams_per_serving) s += 0.5; // has a real serving to log with
  return s;
}

/**
 * Merge result lists (earlier lists win ties and duplicates), score, drop broken entries and duplicates,
 * and drop weak matches (a typed word missing) when there are enough good ones.
 */
export function rankFoods(query: string, lists: Food[][], ctx: RankContext = {}): Food[] {
  const mine = ctx.mine ?? [];
  const mineIds = new Set(mine.map(idKey).filter(Boolean));
  const mineNames = new Set(mine.map(nameKey));
  const q = words(query);
  const scored = lists.flatMap((list, li) => list.map((f, i) => ({ f, order: li * 1000 + i })))
    .filter(({ f }) => !looksBroken(f))
    .map((x) => ({ ...x, s: foodScore(x.f, query, mineIds, mineNames), full: q.every((w) => has([...words(x.f.name), ...words(x.f.brand)], w)) }))
    .sort((a, b) => b.s - a.s || a.order - b.order);
  const seenIds = new Set<string>();
  const kcalByName = new Map<string, number[]>();
  const out: typeof scored = [];
  for (const x of scored) {
    // Same food from two places: same brand + name and calories within 5 %.
    const id = idKey(x.f);
    const k = nameKey(x.f);
    const kcals = kcalByName.get(k) ?? [];
    const kc = x.f.per100.kcal;
    if ((id && seenIds.has(id)) || kcals.some((c) => Math.abs(c - kc) <= Math.max(c, kc) * 0.05)) continue;
    if (id) seenIds.add(id);
    kcalByName.set(k, [...kcals, kc]);
    out.push(x);
  }
  const good = out.filter((x) => x.full);
  return (good.length >= 5 ? good : out).map((x) => x.f);
}
