import { describe, expect, it } from 'vitest';
import type { Food } from '../../shared/nutrition';
import { looksBroken, rankFoods } from '../../shared/searchRank';

const food = (name: string, kcal: number, extra: Partial<Food> = {}): Food => ({
  name, brand: '', source: 'usda', source_id: name, barcode: '', serving_size: '100 g', grams_per_serving: 100,
  per100: { kcal, protein_g: kcal / 16, carbs_g: kcal / 16, fat_g: kcal / 36, fiber_g: null, sugar_g: null, sodium_mg: null },
  ...extra,
});
const names = (fs: Food[]) => fs.map((f) => f.name);

describe('search ranking', () => {
  it('puts the plain food first and dishes that merely contain it later', () => {
    const r = rankFoods('white rice', [[
      food('Beans and white rice', 150), food('Rice pudding', 120), food('Rice, white, cooked', 130), food('Fried rice with chicken', 170),
    ]]);
    expect(names(r)[0]).toBe('Rice, white, cooked');
    expect(names(r).indexOf('Beans and white rice')).toBeLessThan(names(r).indexOf('Fried rice with chicken'));
  });

  it('matches plurals and the brand when you name it, and prefers generic foods when you do not', () => {
    const lists = [[
      food('Chicken Burrito Bowl', 130, { brand: 'Chipotle', source: 'fatsecret', source_id: '1' }),
      food('Burrito Bowl', 140),
      food('Chicken Burrito Bowl', 125, { brand: 'Qdoba', source: 'fatsecret', source_id: '2' }),
    ]];
    expect(rankFoods('chipotle bowl', lists)[0]).toMatchObject({ brand: 'Chipotle' });
    expect(names(rankFoods('burrito bowls', lists))[0]).toBe('Burrito Bowl');
    expect(names(rankFoods('eggs', [[food('Egg, whole, boiled', 155), food('Eggplant, raw', 25)]]))[0]).toBe('Egg, whole, boiled');
  });

  it("boosts foods you've logged before", () => {
    const greek = food('Greek Yogurt, Plain, Nonfat', 59, { brand: 'Fage', source: 'fatsecret', source_id: '77' });
    const r = rankFoods('greek yogurt', [[food('Yogurt, Greek, plain, whole milk', 97), greek]], { mine: [{ ...greek, id: 'saved-1' }] });
    expect(r[0]).toBe(greek);
  });

  it('drops duplicates across sources and impossible numbers', () => {
    const fs = food('Banana', 89, { source: 'fatsecret', source_id: 'b1' });
    const usda = food('Banana', 90);
    const broken = food('Banana chips', 2000);
    const r = rankFoods('banana', [[fs], [usda, broken]]);
    expect(r).toEqual([fs]);
    expect(looksBroken(food('Diet soda', 0))).toBe(false);
    expect(looksBroken({ ...food('x', 400), per100: { kcal: 400, protein_g: 0, carbs_g: 2, fat_g: 0, fiber_g: null, sugar_g: null, sodium_mg: null } })).toBe(true);
  });

  it('hides results missing a typed word when there are enough full matches', () => {
    const full = ['Chicken breast, grilled', 'Chicken breast, baked', 'Chicken breast, fried', 'Chicken breast, raw', 'Chicken breast, roasted'].map((n, i) => food(n, 160 + i * 25));
    const r = rankFoods('chicken breast', [[...full, food('Chicken thigh', 210), food('Turkey breast', 135)]]);
    expect(r).toHaveLength(5);
    expect(rankFoods('chicken breast', [[full[0]!, food('Chicken thigh', 210)]])).toHaveLength(2); // too few full matches: keep the rest
  });
});
