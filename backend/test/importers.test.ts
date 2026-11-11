import { describe, expect, it } from 'vitest';
import {
  calAiEntries, chicagoIso, guessExercise, mapHevy, matchExercise, mergeWeights, parseCalAi, parseCsv,
  parseHevyMeasurements, parseHevyWorkouts, parseLooseDate, stableHash,
} from '../../shared/importers';
import type { Exercise } from '../../shared/training';

// Small made-up samples in the same shape as the real exports (no personal data).
const HEVY = [
  '"title","start_time","end_time","description","exercise_title","superset_id","exercise_notes","set_index","set_type","weight_lbs","reps","distance_miles","duration_seconds","rpe"',
  '"Pull Day","10 Nov 2026, 15:31","10 Nov 2026, 16:46","good day","Lat Pulldown (Cable)",,"",0,"warmup",100,10,,,',
  '"Pull Day","10 Nov 2026, 15:31","10 Nov 2026, 16:46","good day","Lat Pulldown (Cable)",,"",1,"failure",160,8,,,8.5',
  '"Pull Day","10 Nov 2026, 15:31","10 Nov 2026, 16:46","good day","Weird Thing (Machine)",,"seat at 5\\nhandles high",0,"normal",80,12,,,',
  '"Pull Day","10 Nov 2026, 15:31","10 Nov 2026, 16:46","good day","Leg Raise Parallel Bars",,"",0,"failure",,19,,,',
  '"Pull Day","10 Nov 2026, 15:31","10 Nov 2026, 16:46","good day","Treadmill",,"",0,"normal",,,1.2,600,',
  '"Legs, ""heavy""","3 Jun 2026, 12:54","3 Jun 2026, 13:50","","Leg Press (Machine)",,"",0,"normal",270,12,,,',
].join('\n');

const ex = (name: string, equipment: string): Exercise => ({ id: `id-${name}`, name, equipment, primary: [], secondary: [], rest_sec: 90, notes: '' });

describe('CSV + dates', () => {
  it('parses quotes, escaped quotes and empty fields', () => {
    expect(parseCsv('a,"b ""c""",,d\r\n1,"x,y",,')).toEqual([['a', 'b "c"', '', 'd'], ['1', 'x,y', '', '']]);
  });
  it('reads both date styles', () => {
    expect(parseLooseDate('10 Nov 2026, 15:31')).toEqual({ date: '2026-11-10', time: '15:31' });
    expect(parseLooseDate('June 5, 2025')).toEqual({ date: '2025-06-05', time: '' });
  });
  it('converts Chicago local time to UTC across daylight saving', () => {
    expect(chicagoIso('2026-11-10', '15:31')).toBe('2026-11-10T21:31:00.000Z'); // CST, UTC-6
    expect(chicagoIso('2026-06-03', '12:54')).toBe('2026-06-03T17:54:00.000Z'); // CDT, UTC-5
  });
  it('makes stable ids', () => {
    expect(stableHash('abc')).toBe(stableHash('abc'));
    expect(stableHash('abc')).not.toBe(stableHash('abd'));
  });
});

describe('Hevy', () => {
  it('groups rows into workouts and exercises, skips cardio-only sets', () => {
    const p = parseHevyWorkouts(HEVY);
    expect(p.workouts).toHaveLength(2);
    expect(p.workouts[1]!.title).toBe('Legs, "heavy"');
    const pull = p.workouts[0]!;
    expect(pull.exercises.map((e) => e.name)).toEqual(['Lat Pulldown (Cable)', 'Weird Thing (Machine)', 'Leg Raise Parallel Bars']);
    expect(pull.exercises[0]!.sets.map((s) => s.type)).toEqual(['W', 'F']);
    expect(pull.exercises[0]!.sets[1]!.rpe).toBe(8.5);
    expect(pull.exercises[1]!.notes).toBe('seat at 5\nhandles high');
    expect(pull.exercises[2]!.sets[0]).toMatchObject({ weight_lb: null, reps: 19 });
    expect(p.skippedSets).toBe(1);
  });
  it('rejects files that are not Hevy exports', () => {
    expect(parseHevyWorkouts('a,b\n1,2').warnings[0]).toMatch(/doesn't look like/);
  });
  it('matches existing exercises by name + equipment and creates the rest once', () => {
    const existing = [ex('Lat Pulldown', 'Cable'), ex('Leg Press', 'Machine')];
    let n = 0;
    const m = mapHevy(parseHevyWorkouts(HEVY), existing, () => `new-${++n}`);
    expect(m.matched).toEqual({ 'Lat Pulldown (Cable)': 'Lat Pulldown', 'Leg Press (Machine)': 'Leg Press' });
    expect(m.newExercises.map((e) => e.name)).toEqual(['Weird Thing (Machine)', 'Leg Raise Parallel Bars']);
    const w = m.workouts[0]!;
    expect(w.id).toMatch(/^hevy-/);
    expect(w.start_time).toBe('2026-11-10T21:31:00.000Z');
    expect(w.exercises[0]!.exercise_id).toBe('id-Lat Pulldown');
    expect(w.exercises[0]!.sets[0]!.id).toBe(`${w.id}-0-0`);
    expect(w.exercises[0]!.sets.every((s) => s.completed)).toBe(true);
    // Same file again → same ids (so re-importing skips them)
    expect(mapHevy(parseHevyWorkouts(HEVY), existing, () => 'x').workouts[0]!.id).toBe(w.id);
  });
  it('does not merge different equipment', () => {
    expect(matchExercise('Bicep Curl (Cable)', [ex('Bicep Curl', 'Dumbbell')])).toBeUndefined();
    expect(matchExercise('Hammer Curl (Dumbbell)', [ex('Hammer Curl', 'Dumbbell')])?.name).toBe('Hammer Curl');
  });
  it('guesses muscles and equipment', () => {
    expect(guessExercise('Lat Pulldown (Cable)')).toEqual({ equipment: 'Cable', primary: ['Lats'] });
    expect(guessExercise('Leg Curl (Machine)').primary).toEqual(['Hamstrings']);
    expect(guessExercise('Upright Row (Barbell)').primary).toEqual(['Shoulders']);
    expect(guessExercise('Triceps Pushdown').primary).toEqual(['Triceps']);
    expect(guessExercise('Leg Raise Parallel Bars')).toEqual({ equipment: 'Bodyweight', primary: ['Abs'] });
  });
  it('reads measurements and merges weights by date', () => {
    const csv = '"date","weight_lbs","fat_percent"\n"1 Jul 2025, 00:00",180,\n"9 Aug 2025, 00:00",,\n"9 Aug 2025, 00:00",175,15';
    const h = parseHevyMeasurements(csv);
    expect(h).toEqual([
      { date: '2025-07-01', weight_lb: 180, body_fat_pct: null, source: 'Hevy' },
      { date: '2025-08-09', weight_lb: 175, body_fat_pct: 15, source: 'Hevy' },
    ]);
    const merged = mergeWeights([{ date: '2025-07-01', weight_lb: 181, body_fat_pct: null, source: 'Cal AI' }], h);
    expect(merged.map((w) => [w.date, w.weight_lb])).toEqual([['2025-07-01', 181], ['2025-08-09', 175]]);
  });
});

describe('Cal AI report', () => {
  const lines = [
    'Summary Report', "Sam's Report", 'Start: 06/15/2025 · End: 11/11/2026',
    'Weight History', 'Weight Date', '180 lbs June 15, 2025', '175.5 lbs August 9, 2025',
    'Weekly summary', 'Summary for June 15 – 18, 2025 8420 373g 1007g 314g 0g 0g 0mg',
    'June 15, 2025',
    'Foods Calories Protein Carbs Fat Fiber Sugar Sodium Time',
    'Plain French Toast 159 6g 20g 6g 0g 0g 0mg 11:28am',
    'Barbecue Beef with Corn and', 'Barbecue Sauce', '419 39g 28g 14g 0g 0g 0mg 11:58am',
    'Exercise Calories Time taken Time', 'Back Workout 225 45 mins 10:00am',
    'TOTAL Calories eaten: 578 Calories burned: 225 Net (eaten-burned): 353',
    "Sam's Report", 'Start: 06/15/2025 · End: 11/11/2026',
    'November 10, 2026',
    'Foods Calories Protein Carbs Fat Fiber Sugar Sodium Time',
    'Large Pizza 1,240 36g 84g 36g 2g 4g 1200mg 9:29pm',
    'Toast 70 2g 13g 1g 1g 1g 142mg 9:29pm',
    'Toast 70 2g 13g 1g 1g 1g 142mg 9:29pm',
    'TOTAL Calories eaten: 1400 Calories burned: 0 Net (eaten-burned): 1400',
  ];
  it('reads foods (with wrapped names), weights, exercises and checks day totals', () => {
    const p = parseCalAi(lines);
    expect(p.weights.map((w) => [w.date, w.weight_lb])).toEqual([['2025-06-15', 180], ['2025-08-09', 175.5]]);
    expect(p.days.map((d) => d.date)).toEqual(['2025-06-15', '2026-11-10']);
    expect(p.days[0]!.items.map((i) => i.name)).toEqual(['Plain French Toast', 'Barbecue Beef with Corn and Barbecue Sauce']);
    expect(p.days[0]!.items[0]!.n.fiber_g).toBeNull(); // all-zero day → "not tracked"
    expect(p.days[1]!.items[0]!.n).toMatchObject({ kcal: 1240, sodium_mg: 1200, fiber_g: 2 });
    expect(p.exercises).toBe(1);
    expect(p.mismatchedDays).toEqual(['2026-11-10']); // 1380 parsed vs 1400 reported
  });
  it('builds entries with meals from the time and unique, stable ids', () => {
    const e = calAiEntries(parseCalAi(lines).days, {});
    expect(e.map((x) => x.meal)).toEqual(['lunch', 'lunch', 'snack', 'snack', 'snack']); // default windows: lunch 11:00, dinner ends 20:59
    expect(calAiEntries(parseCalAi(lines).days, { breakfast_window: '04:00-11:59', lunch_window: '12:00-15:59' })[0]!.meal).toBe('breakfast');
    expect(new Set(e.map((x) => x.id)).size).toBe(5);
    expect(e[0]).toMatchObject({ entry_method: 'import_calai', grams: null, food_id: '', notes: 'Cal AI, 11:28am' });
    expect(calAiEntries(parseCalAi(lines).days, {})[3]!.id).toBe(e[3]!.id);
  });
});
