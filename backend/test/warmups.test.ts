import { describe, expect, it } from 'vitest';
import { PREP, prepFor, rampFor, rampWeight, RAMP_3 } from '../../shared/warmups';

describe('warm-ups', () => {
  it('matches workout names to a day', () => {
    expect(prepFor('Pull')).toBe(PREP.pull);
    expect(prepFor('Tuesday - Pull (PPL x UL)')).toBe(PREP.pull);
    expect(prepFor('Thursday Upper (PPxUL)')).toBe(PREP.upper);
    expect(prepFor('Friday - Legs (PPL x UL)')).toBe(PREP.legs);
    expect(prepFor('Lower')).toBe(PREP.lower);
    expect(prepFor('Workout')).toBeNull();
  });
  it('gives ramp-up sets only to the first matching lift, rounded to loadable weights', () => {
    const names = ['Bench Press', 'Incline Bench Press (Dumbbell)', 'Shoulder Press (Machine Plates)'];
    expect(rampFor(PREP.push, names, 0)).toBe(RAMP_3);
    expect(rampFor(PREP.push, names, 1)).toBeNull();
    expect(rampFor(PREP.push, names, 2)).toHaveLength(1);
    expect(RAMP_3.map((r) => rampWeight(185, r.pct))).toEqual([95, 130, 155]);
    expect(rampWeight(30, 0.5)).toBe(15);
  });
});
