import { describe, expect, it } from 'vitest';
import {
  addDays, ageOn, DEFAULT_CONSTANTS, expenditureOn, goalDelta, lastCheckInDay, macrosFor, mifflinStJeor, nextCheckInDay,
  planWeek, runCheckIn, targetsFor, trendSeries, weekdayOf, type DayIntake, type WeightPoint,
} from '../../shared/coaching';

// Deterministic pseudo-random noise for synthetic data.
function rng(seed: number) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296 - 0.5; };
}

describe('initial expenditure', () => {
  it('matches the Mifflin–St Jeor formula', () => {
    // 80 kg, 180 cm, 30 y man: 10·80 + 6.25·180 − 5·30 + 5 = 1780
    expect(mifflinStJeor('male', 80 * 2.2046226218, 180 / 2.54, 30)).toBeCloseTo(1780, 6);
    expect(mifflinStJeor('female', 80 * 2.2046226218, 180 / 2.54, 30)).toBeCloseTo(1614, 6);
  });
  it('computes age on a date', () => {
    expect(ageOn('2000-11-12', '2026-11-11')).toBe(25);
    expect(ageOn('2000-11-11', '2026-11-11')).toBe(26);
    expect(ageOn('', '2026-11-11')).toBeNull();
  });
});

describe('trend weight', () => {
  it('starts at the first weigh-in and smooths toward new values', () => {
    const t = trendSeries([{ date: '2026-01-01', weight_lb: 200 }, { date: '2026-01-02', weight_lb: 190 }], '2026-01-02', 0.1);
    expect(t.map((p) => p.trend)).toEqual([200, 199]);
  });
  it('handles gaps: a 3-day gap moves as far as three daily steps would', () => {
    const t = trendSeries([{ date: '2026-01-01', weight_lb: 200 }, { date: '2026-01-04', weight_lb: 190 }], '2026-01-05', 0.1);
    expect(t).toHaveLength(5);
    expect(t[1]!.trend).toBe(200); // no weigh-in → trend held
    expect(t[3]!.trend).toBeCloseTo(200 - 10 * (1 - 0.9 ** 3), 6);
    expect(t[4]!.scale).toBeNull();
  });
  it('averages several weigh-ins on one day', () => {
    expect(trendSeries([{ date: '2026-01-01', weight_lb: 180 }, { date: '2026-01-01', weight_lb: 182 }], '2026-01-01')[0]!.trend).toBe(181);
  });
});

describe('expenditure (synthetic data with a known answer)', () => {
  // True expenditure 2,500 kcal/day; eating 2,000 → losing 500/2,700 lb/day. Noisy daily weigh-ins.
  const TRUE_TDEE = 2500;
  const start = '2026-01-01';
  const noise = rng(42);
  const weights: WeightPoint[] = [];
  const intake: DayIntake[] = [];
  for (let i = 0; i < 42; i++) {
    const date = addDays(start, i);
    const eaten = 2000 + noise() * 400;
    intake.push({ date, kcal: eaten, complete: true });
    const trueWeight = 200 - (i * (TRUE_TDEE - 2000)) / DEFAULT_CONSTANTS.energyPerLb;
    weights.push({ date, weight_lb: trueWeight + noise() * 2 }); // ±1 lb water noise
  }
  const end = addDays(start, 41);
  const trend = trendSeries(weights, end);

  it('converges to the true expenditure within ~5 %', () => {
    const e = expenditureOn(end, intake, trend, 2100);
    expect(e.confidence).toBe('stable');
    expect(Math.abs(e.kcal - TRUE_TDEE)).toBeLessThan(125);
  });

  it('uses the prior while data is sparse, then shifts toward the data', () => {
    const early = expenditureOn(addDays(start, 5), intake, trend, 2100);
    expect(early.kcal).toBe(2100);
    expect(early.confidence).toBe('low data');
    const mid = expenditureOn(addDays(start, 10), intake, trend, 2100);
    expect(mid.confidence).toBe('settling');
    expect(mid.weight).toBeGreaterThan(0.34);
    expect(mid.weight).toBeLessThan(0.8);
    expect(mid.dataKcal).not.toBeNull(); // early data estimate exists but is only partly trusted
    // (EWMA trend lags the true loss early on, so the early data estimate reads low — another reason to blend.)
  });

  it('ignores incomplete days', () => {
    const withJunk = intake.map((d, i) => (i % 3 === 0 ? { ...d, kcal: 500, complete: false } : d));
    const e = expenditureOn(end, withJunk, trend, 2100);
    expect(Math.abs(e.kcal - TRUE_TDEE)).toBeLessThan(150);
  });
});

describe('weekly targets', () => {
  const s = { protein_g_per_lb: '0.8', fat_min_g: '50', training_days: 'Mon,Wed,Fri', goal_type: 'lose', goal_rate_lb_per_week: '0.5' };

  it('sets the goal delta from the energy density', () => {
    expect(goalDelta('lose', 0.5)).toBeCloseTo(-0.5 * 2700 / 7, 6);
    expect(goalDelta('gain', 0.5)).toBeCloseTo(0.5 * 2700 / 7, 6);
    expect(goalDelta('maintain', 1)).toBe(0);
  });

  it('gives training days more and keeps the weekly total', () => {
    const plan = planWeek(2200, ['Mon', 'Wed', 'Fri'], 180, s);
    expect(plan.Mon!.kcal).toBe(2420);
    expect(plan.Tue!.kcal).toBe(2040);
    const weekly = Object.values(plan).reduce((a, d) => a + d.kcal, 0);
    expect(Math.abs(weekly - 2200 * 7)).toBeLessThanOrEqual(40); // rounding to 10 kcal
    expect(plan.Mon!.training).toBe(true);
  });

  it('splits macros: protein from body weight, fat ≥ minimum, carbs fill the rest', () => {
    const m = macrosFor(2000, 180, s);
    expect(m.protein_g).toBe(144);
    expect(m.fat_g).toBe(Math.max(50, Math.round(2000 * 0.25 / 9)));
    expect(m.protein_g * 4 + m.fat_g * 9 + m.carbs_g * 4).toBeGreaterThan(1990);
    const low = macrosFor(1000, 250, { ...s, fat_min_g: '60' });
    expect(low.carbs_g).toBe(0);
    expect(low.fat_g).toBeGreaterThanOrEqual(60);
  });

  it('caps the week-to-week change and explains it', () => {
    const trend = trendSeries([{ date: '2026-01-01', weight_lb: 180 }], '2026-01-08');
    const r = runCheckIn({ date: '2026-01-08', settings: s, trend, intake: [], initial: 2600, previousExpenditure: 2600, previousAvg: 1800 })!;
    expect(r.avg_target_kcal).toBeGreaterThanOrEqual(1940);
    expect(r.avg_target_kcal).toBeLessThanOrEqual(1960);
    expect(r.reason).toMatch(/limited to \+150/);
  });

  it('first check-in uses the starting estimate', () => {
    const trend = trendSeries([{ date: '2026-01-01', weight_lb: 180 }], '2026-01-01');
    const r = runCheckIn({ date: '2026-01-01', settings: s, trend, intake: [], initial: 2600, previousExpenditure: null, previousAvg: null })!;
    expect(r.expenditure_kcal).toBe(2600);
    expect(r.confidence).toBe('low data');
    expect(r.reason).toMatch(/First check-in/);
    expect(runCheckIn({ date: '2026-01-01', settings: s, trend: [], intake: [], initial: 2600, previousExpenditure: null, previousAvg: null })).toBeNull();
  });

  it('never goes below the calorie floor', () => {
    const trend = trendSeries([{ date: '2026-01-01', weight_lb: 120 }], '2026-01-01');
    const r = runCheckIn({ date: '2026-01-01', settings: { ...s, goal_rate_lb_per_week: '2' }, trend, intake: [], initial: 1500, previousExpenditure: null, previousAvg: null })!;
    for (const d of Object.values(r.plan)) expect(d.kcal).toBeGreaterThanOrEqual(1200);
  });
});

describe('check-in calendar', () => {
  it('finds the last and next check-in days', () => {
    expect(weekdayOf('2026-11-11')).toBe('Wed');
    expect(lastCheckInDay('2026-11-11', 'Mon')).toBe('2026-11-09');
    expect(lastCheckInDay('2026-11-09', 'Mon')).toBe('2026-11-09');
    expect(nextCheckInDay('2026-11-09', 'Mon')).toBe('2026-11-16');
  });
  it('uses the latest check-in on or before a date', () => {
    const plan = (k: number) => Object.fromEntries(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => [d, { kcal: k, protein_g: 1, fat_g: 1, carbs_g: 1, training: false }]));
    const cis = [
      { date: '2026-11-02', plan: plan(2000), avg: 2000, expenditure: 2500, confidence: 'settling', reason: '', trend: 180 },
      { date: '2026-11-09', plan: plan(2100), avg: 2100, expenditure: 2600, confidence: 'stable', reason: '', trend: 179 },
    ];
    expect(targetsFor('2026-11-05', cis)!.kcal).toBe(2000);
    expect(targetsFor('2026-11-11', cis)!.kcal).toBe(2100);
    expect(targetsFor('2026-10-01', cis)).toBeNull();
  });
});
