// Nutrient math shared by frontend and backend.
// Foods are stored per 100 g (source of truth) plus per serving (derived) — see docs/data-model.md.

import type { Row } from './schema';

export interface Nutrients {
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number | null;
  sugar_g: number | null;
  sodium_mg: number | null;
}

export type FoodSource = 'usda' | 'off' | 'label' | 'ai' | 'manual' | 'quick';
export type Meal = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export const MEALS: Meal[] = ['breakfast', 'lunch', 'dinner', 'snack'];
export const MEAL_LABELS: Record<Meal, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' };

export interface Food {
  id?: string; // set once saved in the Foods tab
  name: string;
  brand: string;
  source: FoodSource;
  source_id: string;
  barcode: string;
  serving_size: string; // human text, e.g. "2/3 cup (55 g)"
  grams_per_serving: number | null;
  per100: Nutrients;
  favorite?: boolean;
}

/** Where a logged food came from (brief v2 §4). Blank = not specified. */
export type FoodOrigin = 'restaurant' | 'cafeteria' | 'homemade' | 'packaged' | '';

const OPTIONAL = ['fiber_g', 'sugar_g', 'sodium_mg'] as const;

export const round1 = (n: number) => Math.round(n * 10) / 10;

export function roundNutrients(n: Nutrients): Nutrients {
  return {
    kcal: Math.round(n.kcal),
    protein_g: round1(n.protein_g),
    carbs_g: round1(n.carbs_g),
    fat_g: round1(n.fat_g),
    fiber_g: n.fiber_g == null ? null : round1(n.fiber_g),
    sugar_g: n.sugar_g == null ? null : round1(n.sugar_g),
    sodium_mg: n.sodium_mg == null ? null : Math.round(n.sodium_mg),
  };
}

/** Nutrients in `grams` of a food given its per-100 g values (unrounded). */
export function scale(per100: Nutrients, grams: number): Nutrients {
  const f = grams / 100;
  return {
    kcal: per100.kcal * f,
    protein_g: per100.protein_g * f,
    carbs_g: per100.carbs_g * f,
    fat_g: per100.fat_g * f,
    fiber_g: per100.fiber_g == null ? null : per100.fiber_g * f,
    sugar_g: per100.sugar_g == null ? null : per100.sugar_g * f,
    sodium_mg: per100.sodium_mg == null ? null : per100.sodium_mg * f,
  };
}

/** Converts label values for one serving of `gramsPerServing` into per-100 g values. */
export function per100FromServing(perServing: Nutrients, gramsPerServing: number): Nutrients {
  if (!(gramsPerServing > 0)) throw new Error('Serving size in grams must be more than 0');
  return scale(perServing, (100 * 100) / gramsPerServing);
}

export function emptyNutrients(): Nutrients {
  return { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: null, sugar_g: null, sodium_mg: null };
}

export function addNutrients(a: Nutrients, b: Nutrients): Nutrients {
  const opt = (x: number | null, y: number | null) => (x == null && y == null ? null : (x ?? 0) + (y ?? 0));
  return {
    kcal: a.kcal + b.kcal,
    protein_g: a.protein_g + b.protein_g,
    carbs_g: a.carbs_g + b.carbs_g,
    fat_g: a.fat_g + b.fat_g,
    fiber_g: opt(a.fiber_g, b.fiber_g),
    sugar_g: opt(a.sugar_g, b.sugar_g),
    sodium_mg: opt(a.sodium_mg, b.sodium_mg),
  };
}

/** kcal implied by macros (4/4/9). Used to sanity-check labels. */
export const macroKcal = (n: Pick<Nutrients, 'protein_g' | 'carbs_g' | 'fat_g'>) => 4 * n.protein_g + 4 * n.carbs_g + 9 * n.fat_g;

// ---------- Sheet row conversion ----------

const num = (v: unknown): number | null => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const blank = (v: number | null) => (v == null ? '' : v);

export function foodToRow(f: Food): Row {
  const p = roundNutrients(f.per100);
  const row: Row = {
    name: f.name,
    brand: f.brand,
    source: f.source,
    source_id: f.source_id,
    barcode: f.barcode,
    serving_size: f.serving_size,
    serving_unit: 'g',
    grams_per_serving: blank(f.grams_per_serving),
    kcal_100g: p.kcal,
    protein_g_100g: p.protein_g,
    carbs_g_100g: p.carbs_g,
    fat_g_100g: p.fat_g,
    fiber_g_100g: blank(p.fiber_g),
    sugar_g_100g: blank(p.sugar_g),
    sodium_mg_100g: blank(p.sodium_mg),
  };
  if (f.grams_per_serving) {
    const s = roundNutrients(scale(f.per100, f.grams_per_serving));
    Object.assign(row, {
      kcal_serving: s.kcal,
      protein_g_serving: s.protein_g,
      carbs_g_serving: s.carbs_g,
      fat_g_serving: s.fat_g,
      fiber_g_serving: blank(s.fiber_g),
      sugar_g_serving: blank(s.sugar_g),
      sodium_mg_serving: blank(s.sodium_mg),
    });
  } else {
    for (const k of ['kcal', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'sugar_g', 'sodium_mg']) row[`${k}_serving`] = '';
  }
  row.favorite = !!f.favorite;
  if (f.id) row.id = f.id;
  return row;
}

export function rowToFood(r: Row): Food {
  return {
    id: String(r.id ?? ''),
    name: String(r.name ?? ''),
    brand: String(r.brand ?? ''),
    source: (String(r.source || 'manual') as FoodSource),
    source_id: String(r.source_id ?? ''),
    barcode: String(r.barcode ?? ''),
    serving_size: String(r.serving_size ?? ''),
    grams_per_serving: num(r.grams_per_serving),
    favorite: r.favorite === true || r.favorite === 'TRUE',
    per100: {
      kcal: num(r.kcal_100g) ?? 0,
      protein_g: num(r.protein_g_100g) ?? 0,
      carbs_g: num(r.carbs_g_100g) ?? 0,
      fat_g: num(r.fat_g_100g) ?? 0,
      fiber_g: num(r.fiber_g_100g),
      sugar_g: num(r.sugar_g_100g),
      sodium_mg: num(r.sodium_mg_100g),
    },
  };
}

export interface LogEntry {
  id: string;
  date: string;
  meal: Meal;
  food_id: string;
  food_name: string;
  grams: number | null;
  servings: number | null;
  n: Nutrients; // rounded totals for this entry
  entry_method: string;
  notes: string;
  food_source: FoodOrigin;
  place: string;
  is_estimate: boolean;
  /** When it was logged (ISO, from the row's created_at). Not written back; used for the timeline view. */
  logged_at?: string;
  /** Which tab the row was read from (frontend only), so edits go back to the same place. */
  source_tab?: 'FoodLog' | 'FoodArchive';
}

/** Builds a FoodLog entry for `grams` of `food`. */
export function makeEntry(args: {
  id: string; date: string; meal: Meal; food: Food; grams: number; method: string; notes?: string;
  food_source?: FoodOrigin; place?: string; is_estimate?: boolean;
}): LogEntry {
  const { food, grams } = args;
  return {
    id: args.id,
    date: args.date,
    meal: args.meal,
    food_id: food.id ?? '',
    food_name: food.brand ? `${food.name} (${food.brand})` : food.name,
    grams: round1(grams),
    servings: food.grams_per_serving ? Math.round((grams / food.grams_per_serving) * 100) / 100 : null,
    n: roundNutrients(scale(food.per100, grams)),
    entry_method: args.method,
    notes: args.notes ?? '',
    food_source: args.food_source ?? (food.source === 'off' || (food.source === 'usda' && !!food.brand) || food.barcode ? 'packaged' : ''),
    place: args.place ?? '',
    is_estimate: args.is_estimate ?? food.source === 'ai',
  };
}

export function entryToRow(e: LogEntry): Row {
  return {
    id: e.id,
    date: e.date,
    meal: e.meal,
    food_id: e.food_id,
    food_name: e.food_name,
    grams: blank(e.grams),
    servings: blank(e.servings),
    kcal: e.n.kcal,
    protein_g: e.n.protein_g,
    carbs_g: e.n.carbs_g,
    fat_g: e.n.fat_g,
    fiber_g: blank(e.n.fiber_g),
    sugar_g: blank(e.n.sugar_g),
    sodium_mg: blank(e.n.sodium_mg),
    entry_method: e.entry_method,
    notes: e.notes,
    food_source: e.food_source,
    place: e.place,
    is_estimate: e.is_estimate,
  };
}

export function rowToEntry(r: Row): LogEntry {
  const meal = String(r.meal) as Meal;
  return {
    id: String(r.id),
    date: String(r.date),
    meal: MEALS.includes(meal) ? meal : 'snack',
    food_id: String(r.food_id ?? ''),
    food_name: String(r.food_name ?? ''),
    grams: num(r.grams),
    servings: num(r.servings),
    n: {
      kcal: num(r.kcal) ?? 0,
      protein_g: num(r.protein_g) ?? 0,
      carbs_g: num(r.carbs_g) ?? 0,
      fat_g: num(r.fat_g) ?? 0,
      fiber_g: num(r.fiber_g),
      sugar_g: num(r.sugar_g),
      sodium_mg: num(r.sodium_mg),
    },
    entry_method: String(r.entry_method ?? ''),
    notes: String(r.notes ?? ''),
    food_source: (['restaurant', 'cafeteria', 'homemade', 'packaged'].includes(String(r.food_source)) ? String(r.food_source) : '') as FoodOrigin,
    place: String(r.place ?? ''),
    is_estimate: r.is_estimate === true || r.is_estimate === 'TRUE',
    ...(r.created_at ? { logged_at: String(r.created_at) } : {}),
  };
}

export function totals(entries: LogEntry[]): Nutrients {
  return roundNutrients(entries.reduce((acc, e) => addNutrients(acc, e.n), emptyNutrients()));
}

/** Default meal for "now" (America/Chicago clock time passed in as hours). */
export function defaultMeal(hour: number): Meal {
  if (hour < 10.5) return 'breakfast';
  if (hour < 15) return 'lunch';
  if (hour < 21) return 'dinner';
  return 'snack';
}

export { OPTIONAL as OPTIONAL_NUTRIENTS };
