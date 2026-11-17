import { afterEach, describe, expect, it, vi } from 'vitest';
import { _resetFatSecret, mapFatSecret, searchFatSecret } from '../src/fatsecret';
import { makeEnv } from './helpers';

afterEach(() => { vi.unstubAllGlobals(); _resetFatSecret(); });

const bowl = {
  food_id: '123', food_name: 'Chicken Burrito Bowl', brand_name: 'Chipotle', food_type: 'Brand',
  servings: { serving: [
    { serving_description: '1 serving', metric_serving_amount: '', calories: '665' },
    { serving_description: '1 bowl', metric_serving_amount: '510.000', metric_serving_unit: 'g', calories: '665', protein: '48', carbohydrate: '62', fat: '24', fiber: '12', sodium: '1810' },
  ] },
};

describe('FatSecret', () => {
  it('turns a food with a gram serving into per-100 g numbers', () => {
    const f = mapFatSecret(bowl)!;
    expect(f).toMatchObject({ name: 'Chicken Burrito Bowl', brand: 'Chipotle', source: 'fatsecret', source_id: '123', grams_per_serving: 510, serving_size: '1 bowl (510 g)' });
    expect(f.per100.kcal).toBe(130);
    expect(f.per100.protein_g).toBe(9.4);
    expect(mapFatSecret({ food_id: '1', food_name: 'x', servings: { serving: { serving_description: '1 serving', calories: '100' } } })).toBeNull();
  });

  it('signs in, searches, loads details, and is off without keys', async () => {
    await expect(searchFatSecret(makeEnv(), 'bowl')).rejects.toThrow(/not set up/);
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
      const u = String(input); calls.push(u);
      if (u.includes('oauth.fatsecret.com')) return Response.json({ access_token: 't', expires_in: 86400 });
      if (u.includes('/foods/search/v1')) return Response.json({ foods: { food: { food_id: '123', food_name: 'Chicken Burrito Bowl' } } });
      return Response.json({ food: bowl });
    }));
    const env = makeEnv({ FATSECRET_CLIENT_ID: 'id', FATSECRET_CLIENT_SECRET: 'secret' });
    const foods = await searchFatSecret(env, 'chipotle bowl');
    expect(foods).toHaveLength(1);
    expect(calls[0]).toMatch(/oauth/);
    expect(calls[2]).toMatch(/method=food\.get\.v2&food_id=123/);
    await searchFatSecret(env, 'again'); // token reused
    expect(calls.filter((c) => c.includes('oauth'))).toHaveLength(1);
  });
});
