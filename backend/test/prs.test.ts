import { describe, expect, it } from 'vitest';
import { deloadWeight, findPrs, findStall, nextRoutine, platesPerSide, progressionFor, setIsPr, suggestSets, updatedRoutine, type LoggedSet, type Routine, type Workout, type WorkoutExercise } from '../../shared/training';

const set = (weight_lb: number | null, reps: number, type: LoggedSet['type'] = 'N', completed = true): LoggedSet =>
  ({ id: Math.random().toString(36), type, weight_lb, reps, rep_min: null, rep_max: null, completed, rpe: null, note: '' });
const ex = (exercise_id: string, sets: LoggedSet[]): WorkoutExercise => ({ exercise_id, rest_sec: 90, note: '', sets });
const wk = (id: string, exercises: WorkoutExercise[]): Workout =>
  ({ id, routine_id: 'r', name: 'Pull', date: '2026-11-10', start_time: '2026-11-10T20:00:00Z', end_time: '2026-11-10T21:00:00Z', notes: '', exercises });

const history = [wk('old', [ex('lat', [set(160, 10), set(160, 8)]), ex('curl', [set(80, 8)])])];

describe('personal records', () => {
  it('finds 1RM, heaviest weight, best set and total volume records with before → after', () => {
    const today = wk('new', [ex('lat', [set(100, 12, 'W'), set(170, 8), set(160, 10), set(150, 10)]), ex('curl', [set(80, 7)])]);
    const prs = findPrs(today, history);
    const lat = Object.fromEntries(prs.filter((p) => p.exercise_id === 'lat').map((p) => [p.kind, [p.before, p.after]]));
    expect(lat.weight).toEqual([160, 170]);
    expect(lat.e1rm![1]).toBeCloseTo(170 * (1 + 8 / 30)); // 215.3 > 213.3
    expect(lat.set_volume).toBeUndefined(); // best set 160×10 = 1,600 only ties the old best
    expect(lat.session_volume).toEqual([2880, 170 * 8 + 1600 + 1500]); // warm-up not counted
    expect(prs.some((p) => p.exercise_id === 'curl')).toBe(false); // 80×7 beats nothing
  });

  it('a first-time exercise only gets an e1RM entry with no "before"', () => {
    const prs = findPrs(wk('n', [ex('squat', [set(225, 5)])]), history);
    expect(prs).toEqual([{ exercise_id: 'squat', kind: 'e1rm', before: null, after: expect.closeTo(262.5) }]);
  });

  it('flags a live set PR, ignoring warm-ups and sets already beaten today', () => {
    expect(setIsPr('lat', set(170, 8), history)).toBe('e1rm');
    expect(setIsPr('lat', set(165, 1), history)).toBe('weight'); // 165 lb heavier, 1RM 165 lower
    expect(setIsPr('lat', set(200, 1, 'W'), history)).toBeNull();
    expect(setIsPr('lat', set(170, 8), history, [set(175, 8)])).toBeNull();
    expect(setIsPr('new-ex', set(50, 10), history)).toBeNull();
  });
});

describe('routine update after a workout', () => {
  const routine: Routine = {
    id: 'r', name: 'Pull', notes: '', sort_order: 0, folder: '', items: [
      { id: 'i1', exercise_id: 'lat', position: 0, rest_sec: 90, notes: '', sets: [{ type: 'W', weight_lb: 100, rep_min: 10, rep_max: 10 }, { type: 'N', weight_lb: 160, rep_min: 8, rep_max: 12 }, { type: 'N', weight_lb: 160, rep_min: 8, rep_max: 12 }] },
      { id: 'i2', exercise_id: 'row', position: 1, rest_sec: 90, notes: '', sets: [{ type: 'N', weight_lb: 120, rep_min: 8, rep_max: 12 }] },
    ],
  };

  it('keeps max weights and the routine list when changes are discarded', () => {
    const done = [ex('lat', [set(100, 10, 'W'), set(175, 8), set(150, 10, 'N', false)]), ex('pullover', [set(60, 12)])];
    const u = updatedRoutine(routine, done, false, () => 'new');
    expect(u.structureChanged).toBe(true);
    expect(u.routine.items.map((i) => i.exercise_id)).toEqual(['lat', 'row']);
    expect(u.routine.items[0]!.sets.map((s) => s.weight_lb)).toEqual([100, 175, 160]); // unchecked set doesn't lower it
    expect(u.routine.items[1]!.sets[0]!.weight_lb).toBe(120);
    expect(u.weightChanges).toEqual([{ exercise_id: 'lat', from: 160, to: 175 }]);
  });

  it('applies swaps/additions when changes are kept, reusing existing items', () => {
    const done = [ex('pullover', [set(60, 12), set(60, 12)]), ex('lat', [set(100, 10, 'W'), set(160, 9), set(160, 8)])];
    const u = updatedRoutine(routine, done, true, () => 'new-id');
    expect(u.routine.items.map((i) => [i.exercise_id, i.position, i.id])).toEqual([['pullover', 0, 'new-id'], ['lat', 1, 'i1']]);
    expect(u.routine.items[0]!.sets).toEqual([
      { type: 'N', weight_lb: 60, rep_min: 12, rep_max: 12 }, { type: 'N', weight_lb: 60, rep_min: 12, rep_max: 12 },
    ]);
    expect(u.routine.items[1]!.sets[1]).toMatchObject({ weight_lb: 160, rep_min: 8, rep_max: 12 }); // range kept
  });

  it('reports no structure change when only weights moved', () => {
    const u = updatedRoutine(routine, [ex('lat', [set(100, 10, 'W'), set(160, 10), set(160, 9)]), ex('row', [set(130, 10)])], true, () => 'x');
    expect(u.structureChanged).toBe(false);
    expect(u.weightChanges).toEqual([{ exercise_id: 'row', from: 120, to: 130 }]);
  });
});

describe('progression suggestions', () => {
  const planned = [{ type: 'W' as const, weight_lb: 100, rep_min: 10, rep_max: 10 }, { type: 'N' as const, weight_lb: 160, rep_min: 8, rep_max: 12 }, { type: 'N' as const, weight_lb: 160, rep_min: 8, rep_max: 12 }];
  it('bumps working sets when every one hit the top of the range', () => {
    expect(progressionFor(planned, [set(100, 10, 'W'), set(160, 12), set(160, 12)])).toEqual({ weights: [100, 165, 165], increased: true });
  });
  it('keeps last weights when any set fell short, and uses small steps for light weights', () => {
    expect(progressionFor(planned, [set(100, 10, 'W'), set(160, 12), set(160, 10)])).toEqual({ weights: [100, 160, 160], increased: false });
    const light = [{ type: 'N' as const, weight_lb: 30, rep_min: 10, rep_max: 15 }];
    expect(progressionFor(light, [set(30, 15)]).weights).toEqual([32.5]);
    expect(progressionFor(planned, []).increased).toBe(false);
  });
});

describe('suggested weights from recent best', () => {
  const plan = [{ type: 'N' as const, weight_lb: 185, rep_min: 6, rep_max: 8 }, { type: 'N' as const, weight_lb: 185, rep_min: 6, rep_max: 8 }];
  it('goes up when every set hit the top of the range', () => {
    const s = suggestSets(plan, [[set(185, 8), set(185, 8)]]);
    expect(s).toMatchObject({ weights: [190, 190], increased: true, mode: 'up' });
    expect(s.why).toBe('↑ 190 lb: you hit 8/8 at 185 lb');
  });
  it('holds and says how many reps are left', () => {
    const s = suggestSets(plan, [[set(185, 8), set(185, 6)]]);
    expect(s).toMatchObject({ weights: [185, 185], mode: 'hold', why: '185 lb: 2 more reps across your sets to move up' });
  });
  it('one light day → back to your recent best', () => {
    const s = suggestSets(plan, [[set(165, 8), set(165, 8)], [set(185, 7), set(185, 6)]]);
    expect(s).toMatchObject({ weights: [185, 185], mode: 'back', increased: false });
    expect(s.reps).toEqual([7, 6]);
  });
  it('two light sessions in a row → follows the lighter weight', () => {
    const s = suggestSets(plan, [[set(165, 7), set(165, 7)], [set(165, 8), set(165, 8)], [set(185, 7), set(185, 6)]]);
    expect(s).toMatchObject({ weights: [165, 165], mode: 'follow' });
  });
  it('no history → routine weights, no note', () => {
    expect(suggestSets(plan, [])).toMatchObject({ weights: [185, 185], mode: 'new', why: '' });
  });
});

describe('stalls, deloads and plates', () => {
  const day = (d: string, w: number, reps: number) => ({ ...wk(d, [ex('lat', [set(w, reps)])]), date: d, start_time: `${d}T20:00:00Z` });
  it('flags an exercise with no new best for 4+ weeks over 3+ sessions', () => {
    const h = [day('2026-09-01', 150, 10), day('2026-09-10', 160, 10), day('2026-09-20', 160, 9), day('2026-10-01', 155, 10), day('2026-10-15', 160, 8)];
    expect(findStall('lat', h, '2026-11-11')).toMatchObject({ since: '2026-09-10', sessions: 3, days: 62 });
    expect(findStall('lat', h.slice(0, 3), '2026-11-11')).toBeNull(); // only 1 session since the best
    expect(findStall('lat', [...h, day('2026-11-05', 170, 10)], '2026-11-11')).toBeNull(); // new best
  });
  it('deloads ~10% and calculates plates per side', () => {
    expect(deloadWeight(180)).toBe(160);
    expect(deloadWeight(30)).toBe(27.5);
    expect(platesPerSide(225, 45)).toEqual({ plates: [45, 45], left: 0 });
    expect(platesPerSide(185, 45)).toEqual({ plates: [45, 25], left: 0 });
    expect(platesPerSide(137.5, 45)).toEqual({ plates: [45], left: 1.25 }); // 46.25 per side can't be made exactly

    expect(platesPerSide(40, 45).plates).toEqual([]);
  });
});

describe('routine folders', () => {
  const R = (id: string, folder: string, sort_order: number): Routine => ({ id, name: id, notes: '', sort_order, folder, items: [] });
  const routines = [R('push', 'PPL', 0), R('pull', 'PPL', 1), R('legs', 'PPL', 2), R('upper', 'UL', 3), R('lower', 'UL', 4)];
  const did = (routine_id: string): Workout => ({ ...wk('w-' + routine_id, []), routine_id });
  it('rotates inside the folder of your last workout, wrapping around', () => {
    expect(nextRoutine(routines, [did('pull')])?.id).toBe('legs');
    expect(nextRoutine(routines, [did('legs')])?.id).toBe('push');
    expect(nextRoutine(routines, [did('upper')])?.id).toBe('lower');
    expect(nextRoutine(routines, [did('lower')])?.id).toBe('upper');
    expect(nextRoutine(routines, [])?.id).toBe('push');
  });
});
