import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPasscode } from '../src/crypto';
import { mapOff, mapUsda, OFF_USER_AGENT } from '../src/food';
import { _resetGoogleCache } from '../src/google';
import { _resetSchemaCheck, handle } from '../src/index';
import { _resetRateLimit } from '../src/lockout';
import { applyFilters, timing } from '../src/sheets';
import { FakeGoogle, makeEnv, req } from './helpers';

// Shapes copied from live responses checked in Phase 0 (trimmed).
const usdaBranded = {
  fdcId: 2041155, description: 'CHEERIOS CEREAL', dataType: 'Branded', brandOwner: 'General Mills Sales Inc.', gtinUpc: '00016000275287',
  servingSize: 39, servingSizeUnit: 'GRM', householdServingFullText: '1.5 cup',
  foodNutrients: [
    { nutrientId: 1008, value: 359 }, { nutrientId: 1003, value: 12.8 }, { nutrientId: 1004, value: 6.41 },
    { nutrientId: 1005, value: 74.4 }, { nutrientId: 1079, value: 10.3 }, { nutrientId: 2000, value: 3.85 }, { nutrientId: 1093, value: 487 },
  ],
};
const usdaFoundation = {
  fdcId: 1105314, description: 'Bananas, overripe, raw', dataType: 'Foundation',
  foodNutrients: [{ nutrientId: 2047, value: 85 }, { nutrientId: 1003, value: 0.73 }, { nutrientId: 1004, value: 0.22 }, { nutrientId: 1005, value: 20.1 }],
};

// Everyday foods (FNDDS), in USDA's own (unhelpful) order.
const fndds = (fdcId: number, description: string, measures: { disseminationText: string; gramWeight: number }[]) => ({
  fdcId, description, dataType: 'Survey (FNDDS)', foodMeasures: measures,
  foodNutrients: [{ nutrientId: 1008, value: 130 }, { nutrientId: 1003, value: 2.7 }, { nutrientId: 1004, value: 0.3 }, { nutrientId: 1005, value: 28 }],
});
const usdaEveryday = [
  fndds(1, 'Baby food, rice cereal', [{ disseminationText: '1 tablespoon', gramWeight: 15 }]),
  fndds(2, 'Beans and white rice', [{ disseminationText: 'Quantity not specified', gramWeight: 170 }, { disseminationText: '1 cup', gramWeight: 170 }]),
  fndds(3, 'Rice, white, cooked, NS as to fat', [{ disseminationText: 'Quantity not specified', gramWeight: 130 }, { disseminationText: '1 cup, cooked', gramWeight: 174 }]),
];

describe('USDA mapping', () => {
  it('maps a branded food with serving size and tidies ALL CAPS names', () => {
    const f = mapUsda(usdaBranded)!;
    expect(f).toMatchObject({
      name: 'Cheerios Cereal', brand: 'General Mills Sales Inc.', source: 'usda', source_id: '2041155', barcode: '00016000275287',
      grams_per_serving: 39, serving_size: '1.5 cup (39 g)',
    });
    expect(f.per100).toEqual({ kcal: 359, protein_g: 12.8, carbs_g: 74.4, fat_g: 6.41, fiber_g: 10.3, sugar_g: 3.85, sodium_mg: 487 });
  });

  it('falls back to Atwater energy and leaves serving empty for generic foods', () => {
    const f = mapUsda(usdaFoundation)!;
    expect(f.per100.kcal).toBe(85);
    expect(f.grams_per_serving).toBeNull();
    expect(f.per100.fiber_g).toBeNull();
  });

  it('computes kcal from macros when energy is missing, and skips foods with nothing usable', () => {
    expect(mapUsda({ ...usdaFoundation, foodNutrients: usdaFoundation.foodNutrients.slice(1) })!.per100.kcal).toBeCloseTo(85.3, 1);
    expect(mapUsda({ ...usdaFoundation, foodNutrients: [] })).toBeNull();
  });
});

describe('Open Food Facts mapping', () => {
  it('converts sodium from g to mg and reads serving quantity', () => {
    const f = mapOff({
      code: '0894700010137', product_name: 'Nonfat Greek Yogurt', brands: 'Chobani, Chobani Inc', serving_size: '1 cup (227 g)', serving_quantity: '227',
      nutriments: { 'energy-kcal_100g': 52.9, proteins_100g: 10.1, carbohydrates_100g: 3.5, fat_100g: 0, sodium_100g: 0.036 },
    })!;
    expect(f).toMatchObject({ brand: 'Chobani', barcode: '0894700010137', grams_per_serving: 227, serving_size: '1 cup (227 g)' });
    expect(f.per100.sodium_mg).toBe(36);
    expect(f.per100.fiber_g).toBeNull();
  });

  it('uses kJ when kcal is missing and drops nameless or energy-less products', () => {
    expect(mapOff({ product_name: 'X', nutriments: { 'energy-kj_100g': 418.4 } })!.per100.kcal).toBe(100);
    expect(mapOff({ product_name: '', nutriments: { 'energy-kcal_100g': 1 } })).toBeNull();
    expect(mapOff({ product_name: 'X', nutriments: {} })).toBeNull();
  });
});

describe('row filters', () => {
  const rows = [
    { id: 'a', date: '2026-11-09', meal: 'lunch', kcal: 100, deleted_at: '' },
    { id: 'b', date: '2026-11-10', meal: 'dinner', kcal: 300, deleted_at: '' },
    { id: 'c', date: '2026-11-10', meal: 'lunch', kcal: 200, deleted_at: '2026-11-10T01:00:00Z' },
  ];
  it('filters by equality and ranges and hides deleted rows', () => {
    expect(applyFilters(rows, { date: '2026-11-10' }).map((r) => r.id)).toEqual(['b']);
    expect(applyFilters(rows, { date: '2026-11-10' }, true).map((r) => r.id)).toEqual(['b', 'c']);
    expect(applyFilters(rows, { date__gte: '2026-11-10' }).map((r) => r.id)).toEqual(['b']);
    expect(applyFilters(rows, { kcal__lte: 150 }).map((r) => r.id)).toEqual(['a']);
  });
});

describe('food endpoints (fake services)', () => {
  let env: ReturnType<typeof makeEnv>;
  let google: FakeGoogle;
  let token: string;
  const seen: Request[] = [];

  beforeEach(async () => {
    env = makeEnv({ PASSCODE_HASH: await hashPasscode('pass-1234', 1000), USDA_API_KEY: 'usda-test-key' });
    google = new FakeGoogle();
    google.otherHosts = (r) => {
      const u = new URL(r.url);
      if (u.hostname === 'api.nal.usda.gov' && r.method === 'POST') {
        // Text search (JSON form): everyday foods (FNDDS) or brands.
        seen.push(r);
        return (async () => {
          const b = (await r.clone().json()) as { query: string; dataType: string[] };
          if (b.query === 'busy') return new Response('{}', { status: 429 });
          return new Response(JSON.stringify({ foods: b.dataType.includes('Branded') ? [usdaBranded] : usdaEveryday }), { status: 200 });
        })() as unknown as Response;
      }
      if (u.hostname === 'api.nal.usda.gov') {
        seen.push(r);
        if (u.searchParams.get('query') === 'busy') return new Response('{}', { status: 429 });
        if (/^\d+$/.test(u.searchParams.get('query') ?? '')) {
          // Barcode search: USDA only matches the exact stored digits.
          const hit = u.searchParams.get('query') === usdaBranded.gtinUpc;
          return new Response(JSON.stringify({ foods: hit ? [usdaBranded] : [] }), { status: 200 });
        }
        return new Response(JSON.stringify({ foods: [usdaBranded, usdaFoundation] }), { status: 200 });
      }
      if (u.hostname === 'search.openfoodfacts.org') {
        seen.push(r);
        return new Response(JSON.stringify({ hits: [{ code: '1', product_name: 'Bar', brands: ['Acme'], nutriments: { 'energy-kcal_100g': 400 } }] }), { status: 200 });
      }
      return undefined;
    };
    google.install();
    _resetGoogleCache();
    _resetRateLimit();
    _resetSchemaCheck();
    timing.sleep = async () => {};
    const res = await handle(req('POST', '/auth/login', { body: { passcode: 'pass-1234' } }), env);
    token = ((await res.json()) as { token: string }).token;
    seen.length = 0;
  });

  afterEach(() => vi.unstubAllGlobals());

  const get = async (path: string) => {
    const res = await handle(req('GET', path, { token }), env);
    return { status: res.status, body: (await res.json()) as any };
  };

  it('searches USDA everyday foods: plain match first, real portion as the serving, tidy names', async () => {
    const r = await get('/food/search?q=white%20rice&source=usda');
    expect(r.status).toBe(200);
    expect(r.body.foods.map((f: any) => f.name)).toEqual(['Rice, white, cooked', 'Beans and white rice', 'Baby food, rice cereal']);
    expect(r.body.foods[0]).toMatchObject({ serving_size: '1 cup, cooked (174 g)', grams_per_serving: 174 });
    expect(new URL(seen[0]!.url).searchParams.get('api_key')).toBe('usda-test-key');
    expect(((await seen[0]!.clone().json()) as any).dataType).toEqual(['Survey (FNDDS)']);
  });

  it('searches USDA brands separately', async () => {
    const r = await get('/food/search?q=cheerios&source=usda_brands');
    expect(r.body.foods.map((f: any) => f.name)).toEqual(['Cheerios Cereal']);
    expect(((await seen[0]!.clone().json()) as any).dataType).toEqual(['Branded']);
  });

  it('searches Open Food Facts with an identifying User-Agent', async () => {
    const r = await get('/food/search?q=bar&source=off');
    expect(r.body.foods[0]).toMatchObject({ name: 'Bar', brand: 'Acme', source: 'off' });
    expect(seen[0]!.headers.get('User-Agent')).toBe(OFF_USER_AGENT);
  });

  it('validates queries and reports USDA rate limits', async () => {
    expect((await get('/food/search?q=a')).status).toBe(400);
    expect((await get('/food/search?q=ok&source=nope')).status).toBe(400);
    const busy = await get('/food/search?q=busy');
    expect(busy.status).toBe(429);
    expect(busy.body.error).toBe('usda_rate_limited');
  });

  it('finds a USDA branded food by barcode in any code form', async () => {
    const r = await get('/food/barcode/016000275287'); // UPC-A; USDA stores the 14-digit form
    expect(r.status).toBe(200);
    expect(r.body.food).toMatchObject({ name: 'Cheerios Cereal', barcode: '016000275287', grams_per_serving: 39 });
    const miss = await get('/food/barcode/3017624010701');
    expect(miss.body.food).toBeNull();
    expect((await get('/food/barcode/3017624010709')).status).toBe(400);
  });

  it('upserts one row per date in Days', async () => {
    const start = await handle(req('POST', '/oauth/google/start', { token }), env);
    const state = new URL(((await start.json()) as any).url).searchParams.get('state')!;
    await handle(req('GET', `/oauth/google/callback?code=good-code&state=${encodeURIComponent(state)}`, { origin: null }), env);
    const setup = (await (await handle(req('POST', '/sheet/setup', { token }), env)).json()) as any;

    const post = async (body: unknown) => (await handle(req('POST', '/sheet/upsert', { token, body }), env)).json() as Promise<any>;
    await post({ tab: 'Days', key: 'date', rows: [{ date: '2026-11-11', day_complete: false, total_kcal: 500 }] });
    await post({ tab: 'Days', key: 'date', rows: [{ date: '2026-11-11', day_complete: true }, { date: '2026-11-12', total_kcal: 10 }] });
    const rows = google.tabValues(setup.spreadsheet_id, 'Days').slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]![1]).toBe('2026-11-11');
    expect(rows[0]![2]).toBe(true);
    expect(rows[0]![3]).toBe(500); // kept from first write

    const bad = await post({ tab: 'Days', key: 'id', rows: [{ id: 'x' }] });
    expect(bad.error).toBe('bad_key');
  });
});

describe('Open Food Facts v3.6 nutrition format', () => {
  it('reads nutrients from nutrition.aggregated_set when nutriments is empty', () => {
    // Shape observed live on 2026-11-12 for barcode 3017624010701 (API v3.6).
    const f = mapOff({
      code: '3017624010701', product_name: 'Nutella', brands: 'Ferrero', nutriments: {},
      nutrition: { aggregated_set: { nutrients: {
        'energy-kcal': { value: 539, unit: 'kcal', source_per: '100g' },
        proteins: { value: 6.3, unit: 'g', source_per: '100g' },
        carbohydrates: { value: 57.5, unit: 'g', source_per: '100g' },
        fat: { value: 30.9, unit: 'g', source_per: '100g' },
        sugars: { value: 56.3, unit: 'g', source_per: '100g' },
        sodium: { value: 41, unit: 'mg', source_per: '100g' },
        fiber: { value: 2, unit: 'g', source_per: 'serving' }, // per-serving values are ignored
      } } },
    })!;
    expect(f.per100).toEqual({ kcal: 539, protein_g: 6.3, carbs_g: 57.5, fat_g: 30.9, fiber_g: null, sugar_g: 56.3, sodium_mg: 41 });
  });
});
