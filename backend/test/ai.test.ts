import { describe, expect, it } from 'vitest';
import { contextText, costUsd, nameScore, pastePrompt, validateAiResult, type EstimateContext } from '../../shared/ai';

const ctx: EstimateContext = { source: '', place: '', portion: '', portionGrams: null, oil: '', plateIn: null, hasSide: false, knownPortions: [], ingredients: [] };

describe('AI result validation', () => {
  it('accepts the documented shape', () => {
    const v = validateAiResult({ items: [{ name: 'white rice, cooked', grams: 180, grams_low: 140, grams_high: 220, confidence: 'medium', notes: 'mounded' }] });
    expect(v).toEqual({ ok: true, error: '', skipped: [], items: [{ name: 'white rice, cooked', grams: 180, grams_low: 140, grams_high: 220, confidence: 'medium', notes: 'mounded' }] });
  });

  it('accepts pasted text with code fences and fills a missing range', () => {
    const v = validateAiResult('Here you go:\n```json\n{"items":[{"name":"chicken fried steak","grams":250}]}\n```');
    expect(v.ok).toBe(true);
    expect(v.items[0]).toMatchObject({ grams: 250, grams_low: 188, grams_high: 313, confidence: 'medium' });
  });

  it('rejects bad input with a clear message', () => {
    expect(validateAiResult('no json here').error).toMatch(/No JSON/);
    expect(validateAiResult('{"items": [}').error).toMatch(/valid JSON/);
    expect(validateAiResult({ items: [] }).error).toMatch(/at least one/);
    expect(validateAiResult({ items: [{ name: 'x', grams: 0 }] }).error).toMatch(/usable amount/);
    // One bad item is left out; the rest still work (real case: "pinto beans, cooked" came back with 0 g).
    const mixed = validateAiResult({ items: [{ name: 'rice', grams: 180 }, { name: 'pinto beans, cooked', grams: 0 }, { name: 'salsa', grams: '40 g' }] });
    expect(mixed.ok).toBe(true);
    expect(mixed.items.map((i) => [i.name, i.grams])).toEqual([['rice', 180], ['salsa', 40]]);
    expect(mixed.skipped).toEqual(['pinto beans, cooked']);
    expect(validateAiResult({ items: [{ grams: 10 }] }).error).toMatch(/no name/);
    expect(validateAiResult({ items: Array.from({ length: 21 }, () => ({ name: 'a', grams: 1 })) }).error).toMatch(/max 20/);
  });

  it('fixes ranges that do not contain the estimate', () => {
    const v = validateAiResult({ items: [{ name: 'x', grams: 100, grams_low: 120, grams_high: 90, confidence: 'certain' }] });
    expect(v.items[0]).toMatchObject({ grams_low: 75, grams_high: 125, confidence: 'medium' });
  });
});

describe('AI cost', () => {
  it('prices Haiku 5.5 tokens', () => {
    // 3,800 input + 600 output ≈ $0.00068
    expect(costUsd({ input_tokens: 3800, output_tokens: 600 })).toBeCloseTo(0.00068, 6);
    expect(costUsd({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1000 })).toBeCloseTo(0.00001, 8);
  });
});

describe('prompt context', () => {
  it('describes source, place, portions and known portion sizes', () => {
    const t = contextText({ ...ctx, source: 'cafeteria', place: 'FHSU McMindes', oil: 'heavy', portion: 'large', knownPortions: [{ label: 'mashed potatoes scoop', grams: 150 }] });
    expect(t).toMatch(/Dining-hall/);
    expect(t).toMatch(/FHSU McMindes/);
    expect(t).toMatch(/portion is large/);
    expect(t).toMatch(/Oil\/butter level: heavy/);
    expect(t).toMatch(/mashed potatoes scoop: 150 g/);
  });
  it('builds a paste prompt with the JSON contract', () => {
    const p = pastePrompt('chicken fried steak with gravy', { ...ctx, source: 'restaurant', place: 'Golden Corral', plateIn: 10.5 });
    expect(p).toMatch(/chicken fried steak/);
    expect(p).toMatch(/27 cm/);
    expect(p).toMatch(/"items"/);
  });
});

describe('name matching', () => {
  it('scores overlapping food names', () => {
    expect(nameScore('mashed potatoes', '1 scoop mashed potato')).toBe(1);
    expect(nameScore('white rice, cooked', 'rice')).toBe(1);
    expect(nameScore('green beans', 'mashed potatoes')).toBe(0);
  });
});
