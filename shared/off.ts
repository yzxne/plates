// Maps an Open Food Facts product (API v2/v3 or search) to a Plates Food. Shared by phone and backend.
import type { Food } from './nutrition';

export interface OffProduct {
  code?: string;
  product_name?: string;
  brands?: string | string[];
  serving_size?: string;
  serving_quantity?: number | string;
  nutriments?: Record<string, number | string | undefined>;
  /** API v3.6+: nutrients moved here and `nutriments` comes back empty. */
  nutrition?: {
    aggregated_set?: {
      nutrients?: Record<string, { value?: number; unit?: string; source_per?: string } | undefined>;
    };
  };
}

const offNum = (v: unknown): number | null => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Returns old-style `name_100g` keys from either the old `nutriments` or the v3.6 `nutrition` structure. */
export function per100Nutriments(p: OffProduct): Record<string, number | string | undefined> {
  const old = p.nutriments ?? {};
  if (Object.keys(old).some((k) => k.endsWith('_100g'))) return old;
  const out: Record<string, number> = {};
  for (const [name, n] of Object.entries(p.nutrition?.aggregated_set?.nutrients ?? {})) {
    if (!n || typeof n.value !== 'number' || n.source_per !== '100g') continue;
    const unit = (n.unit ?? '').toLowerCase();
    // Old format keeps masses in grams (sodium too); convert mg/µg so mapOff's g→mg logic stays the same.
    const value = unit === 'mg' ? n.value / 1000 : unit === 'µg' || unit === 'mcg' ? n.value / 1e6 : n.value;
    out[`${name}_100g`] = value;
  }
  return out;
}

export function mapOff(p: OffProduct): Food | null {
  const nm = per100Nutriments(p);
  let kcal = offNum(nm['energy-kcal_100g']);
  if (kcal == null) {
    const kj = offNum(nm['energy-kj_100g']) ?? offNum(nm['energy_100g']);
    if (kj != null) kcal = Math.round(kj / 4.184);
  }
  const name = (p.product_name ?? '').trim();
  if (kcal == null || !name) return null;
  const sodiumG = offNum(nm['sodium_100g']);
  const sq = offNum(p.serving_quantity);
  const brand = Array.isArray(p.brands) ? p.brands[0] ?? '' : (p.brands ?? '').split(',')[0]!.trim();
  return {
    name,
    brand,
    source: 'off',
    source_id: p.code ?? '',
    barcode: p.code ?? '',
    serving_size: sq ? (p.serving_size?.trim() || `${sq} g`) : '',
    grams_per_serving: sq && sq > 0 ? sq : null,
    per100: {
      kcal,
      protein_g: offNum(nm['proteins_100g']) ?? 0,
      carbs_g: offNum(nm['carbohydrates_100g']) ?? 0,
      fat_g: offNum(nm['fat_100g']) ?? 0,
      fiber_g: offNum(nm['fiber_100g']),
      sugar_g: offNum(nm['sugars_100g']),
      sodium_mg: sodiumG == null ? null : Math.round(sodiumG * 1000 * 10) / 10,
    },
  };
}

