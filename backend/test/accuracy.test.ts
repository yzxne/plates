import { describe, expect, it } from 'vitest';
import { accuracyReport, correctGrams, sourceOf, type DayLog } from '../../shared/accuracy';
import { addDays, type TrendPoint } from '../../shared/coaching';

const E = 3500; // kcal per lb, easy numbers for the test
const BURN = 2500;

/**
 * Synthetic history with a known answer: true intake = 2,700 every day (so +200 kcal/day stored).
 * Days 0–55: everything weighed (logged exactly). Days 56–167: 1,000 kcal/day is restaurant food the log undercounts by 20%.
 */
function history(undercount = 0.8) {
  const start = '2026-01-05';
  const days: DayLog[] = [];
  const trend: TrendPoint[] = [];
  let w = 170;
  for (let i = 0; i < 168; i++) {
    const date = addDays(start, i);
    const trueIntake = 2700;
    if (i < 56) days.push({ date, kcal: trueIntake, est: {} });
    else {
      const rest = 1000 * undercount;
      days.push({ date, kcal: 1700 + rest, est: { restaurant: rest } });
    }
    w += (trueIntake - BURN) / E;
    trend.push({ date, trend: w, scale: i % 3 === 0 ? w : null });
  }
  return { days, trend, until: addDays(start, 167) };
}

describe('estimate accuracy', () => {
  it('finds the undercount and suggests the right factor', () => {
    const h = history(0.8);
    const r = accuracyReport(h.days, h.trend, h.until, { energyPerLb: E, formulaBurn: null });
    expect(r.referenceFrom).toBe('regression');
    expect(r.reference).toBeCloseTo(BURN, 0);
    expect(r.overall.gap).toBeCloseTo(200, 0); // 1,000 true − 800 logged
    expect(r.overall.factor).toBe(1.25); // 800 × 1.25 = 1,000
    expect(r.sources.find((s) => s.source === 'restaurant')?.factor).toBe(1.25);
    expect(r.confidence).toBe('fair');
  });

  it('works when every stretch is a mix (no stretch is mostly estimates)', () => {
    // True intake 2,500 at burn 2,500 (no weight change). Estimated food varies 0–450 kcal/day by 4-week stretch, logged 10% low.
    const start = '2026-01-05';
    const days: DayLog[] = [];
    const trend: TrendPoint[] = [];
    for (let i = 0; i < 168; i++) {
      const date = addDays(start, i);
      const trueEst = [0, 150, 300, 450, 150, 300][Math.floor(i / 28)]!;
      days.push({ date, kcal: 2500 - trueEst + trueEst * 0.9, est: { cafeteria: trueEst * 0.9 } });
      trend.push({ date, trend: 170, scale: i % 4 === 0 ? 170 : null });
    }
    const r = accuracyReport(days, trend, addDays(start, 167), { energyPerLb: E, formulaBurn: null });
    expect(r.referenceFrom).toBe('regression');
    expect(r.overall.factor).toBe(1.1);
    expect(r.sources.find((s) => s.source === 'cafeteria')?.factor).toBe(1.1);
  });

  it('says 1.0 when estimates are accurate', () => {
    const h = history(1);
    const r = accuracyReport(h.days, h.trend, h.until, { energyPerLb: E, formulaBurn: null });
    expect(r.overall.factor).toBe(1);
  });

  it('falls back to the formula burn when every block is estimated, and calls it rough', () => {
    const h = history(0.8);
    const onlyEst = h.days.map((d) => ({ ...d, est: { calai: d.kcal } }));
    const r = accuracyReport(onlyEst, h.trend, h.until, { energyPerLb: E, formulaBurn: 2500 });
    expect(r.referenceFrom).toBe('formula');
    expect(r.confidence).toBe('rough');
    expect(r.overall.factor).not.toBeNull();
  });

  it('needs enough logged days and weigh-ins per block', () => {
    const h = history(0.8);
    const sparse = h.days.filter((_, i) => i % 3 === 0); // ~9 days per 28
    const r = accuracyReport(sparse, h.trend, h.until, { energyPerLb: E, formulaBurn: null });
    expect(r.blocks).toHaveLength(0);
    expect(r.confidence).toBe('not enough data');
  });

  it('classifies entries and applies corrections only when chosen', () => {
    expect(sourceOf({ entry_method: 'import_calai', is_estimate: false, food_source: '' })).toBe('calai');
    expect(sourceOf({ entry_method: 'ai_text', is_estimate: true, food_source: 'cafeteria' })).toBe('cafeteria');
    expect(sourceOf({ entry_method: 'ai_photo', is_estimate: true, food_source: '' })).toBe('ai_other');
    expect(sourceOf({ entry_method: 'barcode', is_estimate: false, food_source: 'packaged' })).toBeNull();
    expect(correctGrams(200, 1)).toBe(200);
    expect(correctGrams(200, 1.15)).toBe(230);
  });
});
