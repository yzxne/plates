import { describe, expect, it } from 'vitest';
import { buildCoachSummary, coachSummaryText, isAlcohol, splitWeightOutliers, type CoachDay, type CoachFood, type CoachInputs } from '../../shared/coachSummary';
import type { StoredCheckIn } from '../../shared/coaching';
import type { LoggedSet, Workout } from '../../shared/training';

const set = (weight_lb: number, reps: number, type: LoggedSet['type'] = 'N'): LoggedSet =>
  ({ id: Math.random().toString(36), type, weight_lb, reps, rep_min: null, rep_max: null, completed: true, rpe: null, note: '' });
const workout = (date: string, name: string, lat: number, note = '', exNote = ''): Workout => ({
  id: `w-${date}`, routine_id: 'r', name, date, start_time: `${date}T20:00:00Z`, end_time: `${date}T21:10:00Z`, notes: note,
  exercises: [{ exercise_id: 'lat', rest_sec: 90, note: exNote, sets: [set(100, 10, 'W'), set(lat, 8), set(lat, 8)] }],
});
const day = (date: string, kcal: number, protein_g: number, target: number | null = 3000, complete = true): CoachDay =>
  ({ date, kcal, protein_g, complete, target_kcal: target, target_protein_g: target ? 177 : null });
const food = (date: string, food_name: string, kcal: number, extra: Partial<CoachFood> = {}): CoachFood =>
  ({ date, food_name, kcal, protein_g: 0, entry_method: 'search', servings: null, is_estimate: false, ...extra });

const checkin: StoredCheckIn = {
  date: '2026-11-15', avg: 2900, expenditure: 2500, confidence: 'low data', trend: 178,
  reason: 'Expenditure 2500 kcal/day (low data). Goal: gain 0.5 lb/week → +193 kcal/day.',
  plan: { Mon: { kcal: 3160, protein_g: 142, fat_g: 88, carbs_g: 450, training: true } },
};

function inputs(over: Partial<CoachInputs> = {}): CoachInputs {
  return {
    today: '2026-11-17', // a Tuesday
    settings: {
      sex: 'male', birth_date: '2000-03-15', height_in: '70', goal_type: 'gain', goal_rate_lb_per_week: '0.33',
      protein_g_per_lb: '1', training_days: 'Mon,Tue,Wed,Fri', checkin_weekday: 'Mon', archive_through: '2026-11-10',
    },
    weights: [
      { date: '2026-11-05', weight_lb: 180 }, { date: '2026-11-11', weight_lb: 440 }, { date: '2026-11-11', weight_lb: 178 },
      { date: '2026-11-12', weight_lb: 176 },
    ],
    days: [day('2026-11-06', 1500, 70, null), day('2026-11-10', 0, 0, null), day('2026-11-11', 3200, 180), day('2026-11-12', 4100, 150), day('2026-11-13', 5300, 250), day('2026-11-14', 900, 40), day('2026-11-15', 2800, 100, 2500, false)],
    checkins: [checkin],
    workouts: [
      workout('2026-08-28', 'Pull', 160),
      workout('2026-11-03', 'Pull', 160, '', 'right elbow pain'),
      workout('2026-11-10', 'Pull', 160, 'elbow hurts again'),
      workout('2026-11-12', 'Upper', 160, '', 'elbow still bothering me, discomfort'),
    ],
    exerciseNames: new Map([['lat', 'Lat Pulldown']]),
    food: [
      food('2026-11-12', 'Beer', 612, { entry_method: 'drink', servings: 4 }),
      food('2026-11-12', 'Shot', 194, { entry_method: 'drink', servings: 2 }),
      food('2026-11-11', 'Beer, light', 203),
      food('2026-11-11', 'Root beer', 150),
      food('2026-11-13', 'Fried chicken (ihop)', 562, { is_estimate: true }),
      food('2026-11-13', 'Chicken breast', 300),
    ],
    sleep: [],
    water: [],
    ...over,
  };
}

describe('weight outliers', () => {
  it('drops a reading far from nearby weigh-ins but keeps normal ones', () => {
    const { kept, outliers } = splitWeightOutliers(inputs().weights);
    expect(outliers.map((o) => o.weight_lb)).toEqual([440]);
    expect(kept).toHaveLength(3);
  });
  it('keeps a lone reading after a long gap (nothing nearby to compare)', () => {
    const { outliers } = splitWeightOutliers([{ date: '2026-01-01', weight_lb: 160 }, { date: '2026-06-01', weight_lb: 185 }]);
    expect(outliers).toEqual([]);
  });
});

describe('alcohol detection', () => {
  it('counts Drinks-tab rows and alcohol by name, not root beer', () => {
    expect(isAlcohol({ entry_method: 'drink', food_name: 'Shot' })).toBe(true);
    expect(isAlcohol({ entry_method: 'search', food_name: 'Beer, light' })).toBe(true);
    expect(isAlcohol({ entry_method: 'search', food_name: 'Root beer' })).toBe(false);
    expect(isAlcohol({ entry_method: 'drink', food_name: 'Monster (regular)' })).toBe(false); // water card
    expect(isAlcohol({ entry_method: 'search', food_name: 'Chicken breast' })).toBe(false);
  });
});

describe('coach summary', () => {
  const s = buildCoachSummary(inputs());

  it('uses weeks starting on the check-in day, newest partial', () => {
    expect(s.window).toEqual({ from: '2026-10-26', to: '2026-11-17', weeks: 4 });
    expect(s.weeks.map((w) => w.start)).toEqual(['2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16']);
    expect(s.weeks.at(-1)!.partial).toBe(true);
  });

  it('leaves partial-looking complete days out of averages and flags them', () => {
    const w = s.weeks[2]!; // Nov 9–15
    expect(w.complete_days).toBe(4); // 11, 12, 13, 14 (10 has 0 kcal, 15 not complete)
    expect(w.avg_kcal).toBe(Math.round((3200 + 4100 + 5300) / 3));
    expect(s.flags.some((f) => f.includes('2026-11-14'))).toBe(true);
    expect(w.food_source).toBe('mixed');
  });

  it('counts protein days against g/lb × trend weight', () => {
    const w = s.weeks[2]!;
    expect(w.protein_goal_g).toBe(Math.round(s.weight.trend_lb!));
    expect(w.protein_days_hit).toBe(2); // Nov 11 (180 g) and 13 (250 g) clear 95 % of ~179 g
  });

  it('sums alcohol by drinks and kcal', () => {
    expect(s.weeks[2]!.alcohol).toEqual({ drinks: 7, kcal: 1009, days: ['2026-11-11', '2026-11-12'] });
    expect(s.last_7_days.find((d) => d.date === '2026-11-12')!.alcohol_kcal).toBe(806);
  });

  it('reports guessed share of Plates-logged kcal only', () => {
    expect(s.weeks[2]!.pct_kcal_guessed).toBe(Math.round((562 / (612 + 194 + 203 + 150 + 562 + 300)) * 100));
    expect(s.weeks[0]!.pct_kcal_guessed).toBeNull();
  });

  it('ignores the 440 lb weigh-in and flags the gap', () => {
    expect(s.weight.ignored_outliers).toEqual([{ date: '2026-11-11', weight_lb: 440 }]);
    expect(s.weight.trend_lb).toBeGreaterThan(170);
    expect(s.weight.trend_lb).toBeLessThan(180);
    expect(s.weight.days_since_weigh_in).toBe(5);
    expect(s.flags.some((f) => f.startsWith('No weigh-in for 5 days'))).toBe(true);
  });

  it('flags check-in values that no longer match Settings', () => {
    expect(s.flags.some((f) => f.includes('0.5 lb/week') && f.includes('0.33'))).toBe(true);
    expect(s.flags.some((f) => f.includes('142 g'))).toBe(true);
  });

  it('lists lifts with window vs earlier best and pain patterns', () => {
    expect(s.lifts[0]).toMatchObject({ exercise: 'Lat Pulldown', sessions_in_window: 3, last_done: '2026-11-12' });
    expect(s.lifts[0]!.best_e1rm_window).toBe(s.lifts[0]!.best_e1rm_before);
    expect(s.pain_notes_120d).toHaveLength(3);
    expect(s.flags.some((f) => f.includes('"elbow"'))).toBe(true);
  });

  it('leaves out birth date and anything not needed', () => {
    const text = coachSummaryText(s);
    expect(text).not.toContain('2000-03-15');
    expect(s.profile.age).toBe(26);
    expect(text.startsWith('Plates coach summary (as of 2026-11-17')).toBe(true);
    expect(JSON.parse(text.slice(text.indexOf('{')))).toEqual(s);
  });

  it('honors Lift records start: old-gym machine sets drop out, dumbbells keep history', () => {
    const settings = { ...inputs().settings, lift_history_start: '2026-11-01' };
    const db = (w: Workout): Workout => ({ ...w, id: `${w.id}-db`, exercises: [{ ...w.exercises[0]!, exercise_id: 'row' }] });
    const base = inputs().workouts;
    const workouts = [...base, db({ ...base[0]!, exercises: [{ ...base[0]!.exercises[0]!, sets: [set(200, 8)] }] }), db(base[3]!)];
    const out = buildCoachSummary(inputs({
      settings, workouts,
      exerciseNames: new Map([['lat', 'Lat Pulldown'], ['row', 'Dumbbell Row']]),
      exerciseEquipment: new Map([['lat', 'cable'], ['row', 'dumbbell']]),
    }));
    expect(out.lifts.find((l) => l.exercise === 'Lat Pulldown')!.best_e1rm_before).toBeNull();
    expect(out.lifts.find((l) => l.exercise === 'Dumbbell Row')!.best_e1rm_before).toBeGreaterThan(200);
    expect(out.flags.some((f) => f.includes('Lift records start 2026-11-01'))).toBe(true);
  });

  it('uses the latest weigh-in of a day', () => {
    const out = buildCoachSummary(inputs({ weights: [
      { date: '2026-11-05', weight_lb: 178 }, { date: '2026-11-12', weight_lb: 180, time: '07:00' }, { date: '2026-11-12', weight_lb: 177, time: '07:05' },
    ] }));
    expect(out.last_7_days.find((d) => d.date === '2026-11-12')!.weight_lb).toBe(177);
  });

  it('works with no data at all', () => {
    const empty = buildCoachSummary({ ...inputs(), weights: [], days: [], checkins: [], workouts: [], food: [] });
    expect(empty.latest_checkin).toBeNull();
    expect(empty.weight.trend_lb).toBeNull();
    expect(empty.flags).toContain('No weigh-ins yet.');
  });
});
