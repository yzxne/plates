import { describe, expect, it } from 'vitest';
import { pickPortion, rankUsda, tidyUsdaName } from '../../shared/usdaRank';

// Real FNDDS names seen from USDA on 2026-11-12, in USDA's own order.
const rank = (q: string, names: string[]) => rankUsda(names.map((name) => ({ name: tidyUsdaName(name) })), q).map((x) => x.name);

describe('USDA everyday-food ranking', () => {
  it('puts the plain food before dishes that contain it', () => {
    const r = rank('white rice', ['Beans and white rice', 'Rice, white, cooked, glutinous', 'Black beans and white rice',
      'Rice, white, cooked, as ingredient', 'Rice, white, cooked, made with oil', 'Rice, white, cooked, no added fat', 'Rice, white, cooked, NS as to fat']);
    expect(r[0]).toMatch(/^Rice, white, cooked/);
    expect(r.indexOf('Beans and white rice')).toBeGreaterThan(3);
  });
  it('banana → raw banana near the top; baby food last', () => {
    const r = rank('banana', ['Banana, baked', 'Banana, raw', 'Banana chips', 'Banana nectar', 'Cake or cupcake, banana', 'Peppers, banana, raw', 'Baby Toddler bananas, Stage 1']);
    expect(r.slice(0, 2)).toContain('Banana, raw');
    expect(r.at(-1)).toBe('Baby Toddler bananas, Stage 1');
    expect(r.indexOf('Cake or cupcake, banana')).toBeGreaterThan(r.indexOf('Banana, raw'));
  });
  it('chicken breast → chicken breast items before "Orange chicken"', () => {
    const r = rank('chicken breast', ['Chicken, chicken roll, roasted', 'Orange chicken', 'Chicken breast, grilled without sauce, skin eaten', 'Chicken breast, rotisserie, skin not eaten']);
    expect(r[0]).toMatch(/^Chicken breast/);
    expect(r[1]).toMatch(/^Chicken breast/);
  });
  it('tidies names and picks a real household portion', () => {
    expect(tidyUsdaName('Rice, white, cooked, NS as to fat')).toBe('Rice, white, cooked');
    expect(pickPortion([{ disseminationText: 'Quantity not specified', gramWeight: 130 }, { disseminationText: '1 cup, cooked', gramWeight: 174 }]))
      .toEqual({ label: '1 cup, cooked', grams: 174 });
    expect(pickPortion([{ disseminationText: 'Quantity not specified', gramWeight: 50 }])).toEqual({ label: 'typical portion', grams: 50 });
    expect(pickPortion([])).toBeNull();
  });
});
