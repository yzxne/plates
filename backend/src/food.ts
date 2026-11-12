// Food search proxies: USDA FoodData Central (needs the API key) and Open Food Facts text search.
import { sameProduct, upcEToUpcA } from '../../shared/barcode';
import type { Food, Nutrients } from '../../shared/nutrition';
import { mapOff, type OffProduct } from '../../shared/off';
export { mapOff };
import { pickPortion, rankUsda, tidyUsdaName, type UsdaMeasure } from '../../shared/usdaRank';
import { HttpError } from './http';

export const OFF_USER_AGENT = 'Plates/0.2 (personal tracker; https://github.com/yzxne/plates)';
const USDA_SEARCH = 'https://api.nal.usda.gov/fdc/v1/foods/search';
const OFF_SEARCH = 'https://search.openfoodfacts.org/search';

// USDA nutrient IDs (verified in Phase 0 against live API).
const N = { kcal: [1008, 2047, 2048], protein: [1003], fat: [1004], carbs: [1005], fiber: [1079], sugar: [2000], sodium: [1093] };

interface UsdaNutrient { nutrientId?: number; value?: number }
interface UsdaFood {
  fdcId: number;
  description: string;
  dataType: string;
  brandOwner?: string;
  brandName?: string;
  gtinUpc?: string;
  servingSize?: number;
  servingSizeUnit?: string;
  householdServingFullText?: string;
  foodNutrients?: UsdaNutrient[];
  foodMeasures?: UsdaMeasure[]; // FNDDS household portions
}

function pick(list: UsdaNutrient[], ids: number[]): number | null {
  for (const id of ids) {
    const n = list.find((x) => x.nutrientId === id);
    if (n && typeof n.value === 'number') return n.value;
  }
  return null;
}

function tidyName(s: string): string {
  const t = s.trim();
  if (t === t.toUpperCase() && /[A-Z]/.test(t)) {
    return t.toLowerCase().replace(/(^|[\s,(/-])(\p{L})/gu, (_m, p: string, c: string) => p + c.toUpperCase());
  }
  return t;
}

export function mapUsda(f: UsdaFood): Food | null {
  const list = f.foodNutrients ?? [];
  const protein = pick(list, N.protein);
  const fat = pick(list, N.fat);
  const carbs = pick(list, N.carbs);
  let kcal = pick(list, N.kcal);
  if (kcal == null && protein != null && fat != null && carbs != null) kcal = 4 * protein + 4 * carbs + 9 * fat;
  if (kcal == null) return null;

  const unit = (f.servingSizeUnit ?? '').toLowerCase();
  const gramsUnit = ['g', 'grm', 'ml', 'mlt'].includes(unit);
  const portion = f.dataType?.startsWith('Survey') ? pickPortion(f.foodMeasures) : null;
  const grams = portion ? portion.grams
    : f.dataType === 'Branded' && gramsUnit && f.servingSize && f.servingSize > 0 ? Math.round(f.servingSize * 10) / 10 : null;
  const household = portion ? portion.label : f.householdServingFullText?.trim();
  const unitLabel = !portion && unit.startsWith('m') ? 'mL' : 'g';

  const per100: Nutrients = {
    kcal,
    protein_g: protein ?? 0,
    carbs_g: carbs ?? 0,
    fat_g: fat ?? 0,
    fiber_g: pick(list, N.fiber),
    sugar_g: pick(list, N.sugar),
    sodium_mg: pick(list, N.sodium),
  };
  return {
    name: tidyUsdaName(tidyName(f.description)),
    brand: tidyName(f.brandName || f.brandOwner || ''),
    source: 'usda',
    source_id: String(f.fdcId),
    barcode: f.gtinUpc ?? '',
    serving_size: grams ? (household ? `${household} (${grams} ${unitLabel})` : `${grams} ${unitLabel}`) : '',
    grams_per_serving: grams,
    per100,
  };
}

/**
 * USDA search. "everyday" = the survey list of foods as people eat them (FNDDS: plain names, real portions),
 * ranked so plain matches come first; "brands" = branded products. Uses the JSON (POST) form of the search:
 * the URL form returns 400 for some FNDDS queries (verified 2026-11-12).
 */
export async function searchUsda(query: string, apiKey: string | undefined, kind: 'everyday' | 'brands' = 'everyday'): Promise<Food[]> {
  const u = new URL(USDA_SEARCH);
  u.searchParams.set('api_key', apiKey || 'DEMO_KEY');
  const res = await fetch(u.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, dataType: kind === 'brands' ? ['Branded'] : ['Survey (FNDDS)'], pageSize: kind === 'brands' ? 25 : 50 }),
  });
  if (res.status === 429) throw new HttpError(429, 'usda_rate_limited', 'USDA search limit reached. Try again later.');
  if (res.status === 403) throw new HttpError(502, 'usda_key', 'USDA rejected the API key. Check USDA_API_KEY.');
  if (!res.ok) throw new HttpError(502, 'usda_error', `USDA search failed (${res.status})`);
  const data = (await res.json()) as { foods?: UsdaFood[] };
  const out: Food[] = [];
  for (const f of data.foods ?? []) {
    const m = mapUsda(f);
    if (m) out.push(m);
  }
  return kind === 'brands' ? out : rankUsda(out, query).slice(0, 25);
}

/** Forms USDA might store a barcode in (it only matches the exact digits). */
export function usdaCodeCandidates(code: string): string[] {
  const d = code.replace(/\D/g, '');
  const base = d.length === 8 ? upcEToUpcA(d) ?? d : d;
  const stripped = base.replace(/^0+/, '');
  const out = new Set<string>([d]);
  if (stripped.length <= 12) out.add(stripped.padStart(12, '0'));
  if (stripped.length <= 13) out.add(stripped.padStart(13, '0'));
  if (stripped.length <= 14) out.add(stripped.padStart(14, '0'));
  return [...out];
}

/** Finds a USDA branded food by barcode. Returns null when not found. */
export async function lookupUsdaBarcode(code: string, apiKey: string | undefined): Promise<Food | null> {
  for (const candidate of usdaCodeCandidates(code).slice(0, 4)) {
    const u = new URL(USDA_SEARCH);
    u.searchParams.set('api_key', apiKey || 'DEMO_KEY');
    u.searchParams.set('query', candidate);
    u.searchParams.set('dataType', 'Branded');
    u.searchParams.set('pageSize', '5');
    const res = await fetch(u.toString());
    if (res.status === 429) throw new HttpError(429, 'usda_rate_limited', 'USDA search limit reached. Try again later.');
    if (!res.ok) throw new HttpError(502, 'usda_error', `USDA lookup failed (${res.status})`);
    const data = (await res.json()) as { foods?: UsdaFood[] };
    const hit = (data.foods ?? []).find((f) => f.gtinUpc && sameProduct(f.gtinUpc, code));
    if (hit) {
      const food = mapUsda(hit);
      if (food) return { ...food, barcode: code };
    }
  }
  return null;
}

// ---------- Open Food Facts ----------
export async function searchOff(query: string): Promise<Food[]> {
  const u = new URL(OFF_SEARCH);
  u.searchParams.set('q', query);
  u.searchParams.set('page_size', '20');
  u.searchParams.set('fields', 'code,product_name,brands,serving_size,serving_quantity,nutriments');
  const res = await fetch(u.toString(), { headers: { 'User-Agent': OFF_USER_AGENT } });
  if (res.status === 429 || res.status === 503) throw new HttpError(429, 'off_busy', 'Open Food Facts is busy. Try again in a minute.');
  if (!res.ok) throw new HttpError(502, 'off_error', `Open Food Facts search failed (${res.status})`);
  const data = (await res.json()) as { hits?: OffProduct[] };
  return (data.hits ?? []).map(mapOff).filter((f): f is Food => f !== null);
}
