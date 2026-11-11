// Barcode → food: your saved foods, then Open Food Facts (straight from the phone), then USDA branded foods.
import { lookupCode, sameProduct } from '../../shared/barcode';
import type { Food } from '../../shared/nutrition';
import { mapOff, type OffProduct } from '../../shared/off';
import { api, errorMessage } from './api';
import { loadFoods } from './foodData';

const OFF_FIELDS = 'code,product_name,brands,serving_size,serving_quantity,nutriments,nutrition';

export interface LookupResult {
  food: Food | null;
  from: 'saved' | 'off' | 'usda' | null;
  errors: string[]; // sources that failed (network etc.), so "not found" may be incomplete
}

async function fromOff(code: string): Promise<Food | null> {
  const url = `https://world.openfoodfacts.org/api/v3.6/product/${lookupCode(code)}.json?fields=${OFF_FIELDS}&app_name=Plates&app_version=0.3`;
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Open Food Facts error (${res.status})`);
  const data = (await res.json()) as { status?: string; product?: OffProduct };
  if (!data.product || data.status === 'failure') return null;
  const food = mapOff({ ...data.product, code: data.product.code || code });
  return food ? { ...food, barcode: food.barcode || code } : null;
}

export async function lookupBarcode(code: string, step?: (msg: string) => void): Promise<LookupResult> {
  const errors: string[] = [];

  step?.('Checking your saved foods…');
  try {
    const saved = (await loadFoods()).find((f) => f.barcode && sameProduct(f.barcode, code));
    if (saved) return { food: saved, from: 'saved', errors };
  } catch (err) {
    errors.push(`Saved foods: ${errorMessage(err)}`);
  }

  step?.('Checking Open Food Facts…');
  try {
    const f = await fromOff(code);
    if (f) return { food: f, from: 'off', errors };
  } catch (err) {
    errors.push(`Open Food Facts: ${errorMessage(err)}`);
  }

  step?.('Checking USDA branded foods…');
  try {
    const r = await api<{ food: Food | null }>('GET', `/food/barcode/${code}`);
    if (r.food) return { food: r.food, from: 'usda', errors };
  } catch (err) {
    errors.push(`USDA: ${errorMessage(err)}`);
  }

  return { food: null, from: null, errors };
}
