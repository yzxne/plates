// FatSecret Platform API (free Basic edition: US data, 5,000 calls/day, attribution required).
// Big database of restaurant chains, brands and generic foods. Off until FATSECRET_CLIENT_ID / _SECRET are set.
// Search (foods.search v1) gives a one-line summary; food.get.v2 gives real servings with grams, so we fetch
// details for the top results and turn each into a normal Food (per-100 g numbers + its first gram-based serving).
import { roundNutrients, type Food, type Nutrients } from '../../shared/nutrition';
import type { Env } from './env';
import { HttpError } from './http';

const TOKEN_URL = 'https://oauth.fatsecret.com/connect/token';
const API = 'https://platform.fatsecret.com/rest/server.api';
const SEARCH = 'https://platform.fatsecret.com/rest/foods/search/v1';

let token: { value: string; until: number } | null = null;
export const _resetFatSecret = () => { token = null; };

export const fatSecretConfigured = (env: Env) => !!(env.FATSECRET_CLIENT_ID && env.FATSECRET_CLIENT_SECRET);

async function accessToken(env: Env): Promise<string> {
  if (token && token.until > Date.now() + 60_000) return token.value;
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${btoa(`${env.FATSECRET_CLIENT_ID}:${env.FATSECRET_CLIENT_SECRET}`)}`,
    },
    body: 'grant_type=client_credentials&scope=basic',
  });
  if (!res.ok) throw new HttpError(502, 'fatsecret_auth', `FatSecret sign-in failed (${res.status}). Check the keys and that IP restrictions allow any address.`);
  const t = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: t.access_token, until: Date.now() + t.expires_in * 1000 };
  return token.value;
}

async function call<T>(env: Env, url: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${await accessToken(env)}` } });
  if (!res.ok) throw new HttpError(502, 'fatsecret_error', `FatSecret search failed (${res.status})`);
  const data = (await res.json()) as T & { error?: { code: number; message: string } };
  if (data.error) throw new HttpError(502, 'fatsecret_error', `FatSecret: ${data.error.message}`);
  return data;
}

const arr = <T>(x: T | T[] | undefined): T[] => (x == null ? [] : Array.isArray(x) ? x : [x]);
const num = (s: unknown) => { const n = parseFloat(String(s ?? '')); return Number.isFinite(n) ? n : null; };

interface FsServing {
  serving_description?: string; metric_serving_amount?: string; metric_serving_unit?: string;
  calories?: string; protein?: string; carbohydrate?: string; fat?: string; fiber?: string; sugar?: string; sodium?: string;
}
interface FsFood { food_id: string; food_name: string; brand_name?: string; food_type?: string; servings?: { serving?: FsServing | FsServing[] } }
interface FsHit { food_id: string; food_name: string; brand_name?: string; food_description?: string }

/** A FatSecret food → our Food, using the first serving measured in grams (or ml, treated as g). */
export function mapFatSecret(f: FsFood): Food | null {
  const servings = arr(f.servings?.serving);
  const s = servings.find((x) => (x.metric_serving_unit === 'g' || x.metric_serving_unit === 'ml') && num(x.metric_serving_amount)! > 0);
  const kcal = num(s?.calories);
  if (!s || kcal == null) return null;
  const grams = num(s.metric_serving_amount)!;
  const k = 100 / grams;
  const per = (v: unknown) => { const n = num(v); return n == null ? null : n * k; };
  const per100: Nutrients = roundNutrients({
    kcal: kcal * k, protein_g: per(s.protein) ?? 0, carbs_g: per(s.carbohydrate) ?? 0, fat_g: per(s.fat) ?? 0,
    fiber_g: per(s.fiber), sugar_g: per(s.sugar), sodium_mg: per(s.sodium),
  });
  const desc = (s.serving_description ?? '').trim();
  return {
    name: f.food_name.trim(), brand: (f.brand_name ?? '').trim(), source: 'fatsecret', source_id: String(f.food_id), barcode: '',
    serving_size: desc && !/^\d+(\.\d+)?\s*g$/i.test(desc) ? `${desc} (${Math.round(grams)} ${s.metric_serving_unit})` : `${Math.round(grams)} g`,
    grams_per_serving: Math.round(grams * 10) / 10, per100,
  };
}

/** Search, then load details for the top results (each is one more call; 10 results ≈ 11 of the 5,000/day). */
export async function searchFatSecret(env: Env, query: string, max = 10): Promise<Food[]> {
  if (!fatSecretConfigured(env)) throw new HttpError(503, 'fatsecret_off', 'FatSecret is not set up yet.');
  const u = new URL(SEARCH);
  u.searchParams.set('search_expression', query);
  u.searchParams.set('max_results', String(max));
  u.searchParams.set('format', 'json');
  const hits = arr((await call<{ foods?: { food?: FsHit | FsHit[] } }>(env, u.toString())).foods?.food);
  const details = await Promise.all(hits.map(async (h) => {
    const g = new URL(API);
    g.searchParams.set('method', 'food.get.v2');
    g.searchParams.set('food_id', h.food_id);
    g.searchParams.set('format', 'json');
    try { return mapFatSecret((await call<{ food: FsFood }>(env, g.toString())).food); } catch { return null; }
  }));
  return details.filter((f): f is Food => f !== null);
}
