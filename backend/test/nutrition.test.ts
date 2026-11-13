import { describe, expect, it } from 'vitest';
import { parseLabel } from '../../shared/labelParser';
import {
  defaultMeal, entryToRow, foodToRow, makeEntry, per100FromServing, rowToEntry, rowToFood, scale, totals, type Food,
} from '../../shared/nutrition';

const oats: Food = {
  name: 'Rolled oats', brand: '', source: 'usda', source_id: '173904', barcode: '',
  serving_size: '1/2 cup (40 g)', grams_per_serving: 40,
  per100: { kcal: 379, protein_g: 13.2, carbs_g: 67.7, fat_g: 6.5, fiber_g: 10.1, sugar_g: 1, sodium_mg: 6 },
};

describe('nutrient math', () => {
  it('scales per-100 g values to any amount', () => {
    const n = scale(oats.per100, 40);
    expect(n.kcal).toBeCloseTo(151.6);
    expect(n.protein_g).toBeCloseTo(5.28);
    expect(n.sodium_mg).toBeCloseTo(2.4);
  });

  it('round-trips per serving ↔ per 100 g', () => {
    const perServing = { kcal: 230, protein_g: 3, carbs_g: 37, fat_g: 8, fiber_g: 4, sugar_g: 12, sodium_mg: 160 };
    const p100 = per100FromServing(perServing, 55);
    expect(p100.kcal).toBeCloseTo(418.18, 1);
    const back = scale(p100, 55);
    expect(back.kcal).toBeCloseTo(230);
    expect(back.sodium_mg).toBeCloseTo(160);
    expect(() => per100FromServing(perServing, 0)).toThrow();
  });

  it('keeps missing optional nutrients as missing, not zero', () => {
    const n = scale({ kcal: 100, protein_g: 1, carbs_g: 2, fat_g: 3, fiber_g: null, sugar_g: null, sodium_mg: null }, 50);
    expect(n.fiber_g).toBeNull();
  });

  it('builds a log entry with servings and rounded macros', () => {
    const e = makeEntry({ id: 'e1', date: '2026-11-11', meal: 'breakfast', food: { ...oats, id: 'f1' }, grams: 60, method: 'search' });
    expect(e.servings).toBe(1.5);
    expect(e.n).toEqual({ kcal: 227, protein_g: 7.9, carbs_g: 40.6, fat_g: 3.9, fiber_g: 6.1, sugar_g: 0.6, sodium_mg: 4 });
    expect(rowToEntry(entryToRow(e))).toEqual(e);
  });

  it('keeps combo grouping through a sheet row, and clears it when split', () => {
    const e = { ...makeEntry({ id: 'c1', date: 'd', meal: 'lunch', food: oats, grams: 40, method: 'x' }), group_id: 'g1', group_name: 'Bowl' };
    const row = entryToRow(e);
    expect(row).toMatchObject({ group_id: 'g1', group_name: 'Bowl' });
    expect(rowToEntry(row)).toMatchObject({ group_id: 'g1', group_name: 'Bowl' });
    const split = entryToRow({ ...e, group_id: '', group_name: 'Bowl' });
    expect(split).toMatchObject({ group_id: '', group_name: '' });
    expect(rowToEntry(split).group_id).toBeUndefined();
  });

  it('sums a day', () => {
    const a = makeEntry({ id: 'a', date: 'd', meal: 'lunch', food: oats, grams: 100, method: 'x' });
    const b = makeEntry({ id: 'b', date: 'd', meal: 'lunch', food: oats, grams: 50, method: 'x' });
    expect(totals([a, b]).kcal).toBe(379 + 190);
  });

  it('converts foods to sheet rows and back', () => {
    const row = foodToRow({ ...oats, id: 'f1' });
    expect(row.kcal_serving).toBe(152);
    expect(row.fiber_g_serving).toBe(4);
    expect(rowToFood(row)).toEqual({ ...oats, id: 'f1', favorite: false });
    const noServing = foodToRow({ ...oats, grams_per_serving: null });
    expect(noServing.kcal_serving).toBe('');
  });

  it('picks a default meal by time of day', () => {
    expect([7, 12, 18, 22].map(defaultMeal)).toEqual(['breakfast', 'lunch', 'dinner', 'snack']);
  });
});

describe('label parser', () => {
  it('reads a US Nutrition Facts panel copied with Live Text', () => {
    const text = `Nutrition Facts
8 servings per container
Serving size 2/3 cup (55g)
Amount per serving
Calories 230
% Daily Value*
Total Fat 8g 10%
Saturated Fat 1g 5%
Trans Fat 0g
Cholesterol 0mg 0%
Sodium 160mg 7%
Total Carbohydrate 37g 13%
Dietary Fiber 4g 14%
Total Sugars 12g
Includes 10g Added Sugars 20%
Protein 3g`;
    const p = parseLabel(text);
    expect(p).toMatchObject({
      basis: 'serving', servingGrams: 55, kcal: 230, fat_g: 8, sodium_mg: 160, carbs_g: 37, fiber_g: 4, sugar_g: 12, protein_g: 3,
    });
    expect(p.servingText).toBe('2/3 cup (55 g)');
    expect(p.warnings).toEqual([]);
  });

  it('copes with OCR mistakes and "less than" values', () => {
    const text = 'Serving Size 1 bar (40g) Calories 190 Total Fat 7g Sodium 95mg Total Carbohydrate 24g Dietary Fiber <1g Total Sugars Og Protein 9g';
    const p = parseLabel(text);
    expect(p.sugar_g).toBe(0);
    expect(p.fiber_g).toBe(0);
    expect(p.warnings.some((w) => w.includes('less than'))).toBe(true);
  });

  it('reads calories split across lines', () => {
    const p = parseLabel('Serving size\n1 cup (240mL)\nCalories\n150\nTotal Fat\n8g\nTotal Carbohydrate 12g\nProtein 8g');
    expect(p.kcal).toBe(150);
    expect(p.servingGrams).toBe(240);
    expect(p.warnings.some((w) => w.includes('mL'))).toBe(true);
  });

  it('reads an EU per-100 g table with kJ/kcal and salt', () => {
    const text = 'Nutrition per 100g\nEnergy 1046kJ / 250kcal\nFat 9.0g\nof which saturates 3.1g\nCarbohydrate 32g\nof which sugars 4.2g\nFibre 2.5g\nProtein 10g\nSalt 1.2g';
    const p = parseLabel(text);
    expect(p).toMatchObject({ basis: 'per100g', servingGrams: 100, kcal: 250, fat_g: 9, carbs_g: 32, sugar_g: 4.2, fiber_g: 2.5, protein_g: 10, sodium_mg: 480 });
  });

  it('flags missing values and mismatched calories', () => {
    const missing = parseLabel('Serving size 30g Total Fat 2g');
    expect(missing.warnings.join(' ')).toMatch(/Calories not found/);
    expect(missing.warnings.join(' ')).toMatch(/Protein not found/);
    const mismatch = parseLabel('Serving size 30g Calories 500 Total Fat 1g Total Carbohydrate 5g Protein 2g');
    expect(mismatch.warnings.join(' ')).toMatch(/don't match/);
  });

  it('ignores "calories from fat" on older labels', () => {
    expect(parseLabel('Serving size 28g Calories from Fat 70 Calories 160 Total Fat 8g Total Carbohydrate 20g Protein 2g').kcal).toBe(160);
  });
});
