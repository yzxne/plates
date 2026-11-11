import { describe, expect, it } from 'vitest';
import type { Food } from '../../shared/nutrition';
import { matchSaved, portionsFor, usualFor, type UsualPortion } from '../src/aiData';

const n = { kcal: 100, protein_g: 1, carbs_g: 1, fat_g: 1, fiber_g: null, sugar_g: null, sodium_mg: null };
const food = (name: string, source: Food['source'], brand = '', id = name + brand): Food =>
  ({ id, name, brand, source, source_id: '', barcode: '', serving_size: '', grams_per_serving: null, per100: n });

describe('AI food matching', () => {
  const foods = [
    food('Mashed potatoes', 'ai', 'Golden Corral'),
    food('Mashed potatoes', 'ai', 'McMindes'),
    food('Potatoes, mashed', 'usda'),
    food('Green beans, canned', 'usda'),
  ];
  it('prefers the AI food cached for the same place', () => {
    expect(matchSaved('mashed potatoes', foods, 'McMindes')?.brand).toBe('McMindes');
    expect(matchSaved('mashed potatoes', foods, 'Golden Corral')?.brand).toBe('Golden Corral');
  });
  it('falls back to a close saved name and ignores unrelated foods', () => {
    expect(matchSaved('potatoes mashed', foods.slice(2))?.name).toBe('Potatoes, mashed');
    expect(matchSaved('meatloaf', foods)).toBeUndefined();
  });
});

describe('usual portions', () => {
  const all: UsualPortion[] = [
    { id: '1', source: 'cafeteria', place: 'McMindes', label: 'mashed potatoes', grams: 150, measured: false },
    { id: '2', source: 'cafeteria', place: 'Other Hall', label: 'mashed potatoes', grams: 300, measured: false },
  ];
  it('uses only portions saved at this place', () => {
    const here = portionsFor(all, ' mcmindes ');
    expect(here).toHaveLength(1);
    expect(usualFor(here, 'Mashed potato')?.grams).toBe(150);
    expect(usualFor(here, 'green beans')).toBeUndefined();
    expect(portionsFor(all, '')).toEqual([]);
  });
});
