// FatSecret Platform API (free Basic edition: US data, 5,000 calls/day, attribution required).
// Big database of restaurant chains, brands and generic foods. Off until FATSECRET_CLIENT_ID / _SECRET are set.
// Search (foods.search v1) gives a one-line summary; food.get.v2 gives real servings with grams, so we fetch
// details for the top results and turn each into a normal Food (per-100 g numbers + its first gram-based serving).
import { roundNutrients, type Food, type Nutrients } from '../../shared/nutrition';
import type { Env } from './env';
import { HttpError } from './http';

const API = 'https://platform.fatsecret.com/rest/server.api';

// Signed with OAuth 1.0 (HMAC-SHA1) instead of OAuth 2.0: FatSecret's OAuth 2.0 tokens only work from
// whitelisted IP addresses, and the free plan can't allow "any address" — which a Cloudflare Worker needs.
// OAuth 1.0 uses the same Client ID / Secret (as consumer key / secret) with no IP list.
export const _resetFatSecret = () => {};

export const fatSecretConfigured = (env: Env) => !!(env.FATSECRET_CLIENT_ID && env.FATSECRET_CLIENT_SECRET);

/** RFC 3986 percent-encoding (encodeURIComponent leaves !'()* alone). */
export const pct = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

/** Base string = METHOD&url&sorted params; key = consumer secret + '&' (no access token). */
export async function oauth1Sign(method: string, url: string, params: Record<string, string>, secret: string): Promise<string> {
  const norm = Object.entries(params).map(([k, v]) => [pct(k), pct(v)] as const)
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`).join('&');
  const base = [method.toUpperCase(), pct(url), pct(norm)].join('&');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(`${pct(secret)}&`), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(base)));
  return btoa(String.fromCharCode(...sig));
}

async function call<T>(env: Env, params: Record<string, string>): Promise<T> {
  const all: Record<string, string> = {
    ...params, format: 'json',
    oauth_consumer_key: env.FATSECRET_CLIENT_ID!, oauth_signature_method: 'HMAC-SHA1', oauth_version: '1.0',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)), oauth_nonce: crypto.randomUUID().replace(/-/g, ''),
  };
  all.oauth_signature = await oauth1Sign('GET', API, all, env.FATSECRET_CLIENT_SECRET!);
  const qs = Object.entries(all).map(([k, v]) => `${pct(k)}=${pct(v)}`).join('&');
  const res = await fetch(`${API}?${qs}`);
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
  const found = await call<{ foods?: { food?: FsHit | FsHit[] } }>(env, { method: 'foods.search', search_expression: query, max_results: String(max) });
  const hits = arr(found.foods?.food);
  const details = await Promise.all(hits.map(async (h) => {
    try { return mapFatSecret((await call<{ food: FsFood }>(env, { method: 'food.get.v2', food_id: h.food_id })).food); } catch { return null; }
  }));
  return details.filter((f): f is Food => f !== null);
}
