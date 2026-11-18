import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { _resetFatSecret, mapFatSecret, oauth1Sign, pct, searchFatSecret } from '../src/fatsecret';
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

  it('signs requests with OAuth 1.0 HMAC-SHA1 (matches an independent signature)', async () => {
    const params = { method: 'foods.search', search_expression: "mac & cheese (kraft)!", oauth_consumer_key: 'id', oauth_nonce: 'n', oauth_timestamp: '1', oauth_signature_method: 'HMAC-SHA1', oauth_version: '1.0', format: 'json' };
    const norm = Object.keys(params).sort().map((k) => `${pct(k)}=${pct((params as Record<string, string>)[k]!)}`).join('&');
    const base = `GET&${pct('https://platform.fatsecret.com/rest/server.api')}&${pct(norm)}`;
    const expected = createHmac('sha1', 'sec&').update(base).digest('base64');
    expect(await oauth1Sign('GET', 'https://platform.fatsecret.com/rest/server.api', params, 'sec')).toBe(expected);
    expect(pct("a b!*'()")).toBe('a%20b%21%2A%27%28%29');
  });

  it('searches, loads details (signed, no token or IP list), and is off without keys', async () => {
    await expect(searchFatSecret(makeEnv(), 'bowl')).rejects.toThrow(/not set up/);
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
      const u = String(input); calls.push(u);
      if (u.includes('method=foods.search')) return Response.json({ foods: { food: { food_id: '123', food_name: 'Chicken Burrito Bowl' } } });
      return Response.json({ food: bowl });
    }));
    const env = makeEnv({ FATSECRET_CLIENT_ID: 'id', FATSECRET_CLIENT_SECRET: 'secret' });
    const foods = await searchFatSecret(env, 'chipotle bowl');
    expect(foods).toHaveLength(1);
    expect(calls).toHaveLength(2);
    expect(calls.some((c) => c.includes('oauth.fatsecret.com'))).toBe(false);
    expect(calls[0]).toMatch(/oauth_consumer_key=id/);
    expect(calls[0]).toMatch(/oauth_signature=/);
    expect(calls[1]).toMatch(/method=food.get.v2/);
    expect(calls[1]).toMatch(/food_id=123/);
  });
});
