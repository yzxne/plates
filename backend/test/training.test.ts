import { describe, expect, it } from 'vitest';
import {
  bestSet, epley1RM, exerciseToRow, MUSCLES, previousSets, routineRows, rowsToRoutines, rowsToWorkouts, rowToExercise,
  setsPerMuscle, starterExercises, volume, workoutRows, workoutTotals, type Exercise, type LoggedSet, type Routine, type Workout,
} from '../../shared/training';

let n = 0;
const id = () => `id${++n}`;
const set = (p: Partial<LoggedSet>): LoggedSet => ({
  id: id(), type: 'N', weight_lb: null, reps: null, rep_min: null, rep_max: null, completed: true, rpe: null, note: '', ...p,
});

const bench: Exercise = { id: 'bench', name: 'Bench Press', primary: ['Chest'], secondary: ['Triceps'], equipment: 'Barbell', rest_sec: 150, notes: '' };
const curl: Exercise = { id: 'curl', name: 'Curl', primary: ['Biceps'], secondary: [], equipment: 'Dumbbell', rest_sec: 60, notes: '' };
const exMap = new Map([[bench.id, bench], [curl.id, curl]]);

function workout(date: string, start: string, sets: Record<string, LoggedSet[]>, end = '2026-11-01T11:00:00.000Z'): Workout {
  return {
    id: id(), routine_id: 'r1', name: 'Push', date, start_time: start, end_time: end, notes: '',
    exercises: Object.entries(sets).map(([exercise_id, s]) => ({ exercise_id, rest_sec: 90, note: '', sets: s })),
  };
}

describe('training math', () => {
  it('estimates 1RM with the Epley formula', () => {
    expect(epley1RM(200, 1)).toBe(200);
    expect(epley1RM(200, 5)).toBeCloseTo(233.33, 2);
    expect(epley1RM(0, 5)).toBe(0);
    expect(epley1RM(100, 0)).toBe(0);
  });

  it('counts volume from completed working sets only', () => {
    const sets = [
      set({ type: 'W', weight_lb: 95, reps: 10 }),
      set({ weight_lb: 185, reps: 5 }),
      set({ type: 'F', weight_lb: 185, reps: 4 }),
      set({ weight_lb: 185, reps: 5, completed: false }),
    ];
    expect(volume(sets)).toBe(185 * 5 + 185 * 4);
  });

  it('totals a workout and counts sets per muscle', () => {
    const w = workout('2026-11-01', '2026-11-01T10:00:00.000Z', {
      bench: [set({ type: 'W', weight_lb: 95, reps: 10 }), set({ weight_lb: 185, reps: 5 }), set({ weight_lb: 185, reps: 5 })],
      curl: [set({ weight_lb: 30, reps: 12 })],
    });
    expect(workoutTotals(w)).toEqual({ volume: 185 * 10 + 360, sets: 3, reps: 22, durationSec: 3600 });
    expect(setsPerMuscle(w, exMap)).toEqual({ Chest: 2, Biceps: 1 });
  });

  it('finds the previous session and best set', () => {
    const older = workout('2026-10-25', '2026-10-25T10:00:00.000Z', { bench: [set({ weight_lb: 175, reps: 5 })] });
    const newer = workout('2026-11-01', '2026-11-01T10:00:00.000Z', { bench: [set({ weight_lb: 185, reps: 5 }), set({ weight_lb: 185, reps: 3, completed: false })] });
    const active = workout('2026-11-08', '2026-11-08T10:00:00.000Z', { bench: [set({ weight_lb: 0, reps: 0 })] }, '');
    const prev = previousSets('bench', [older, newer, active]);
    expect(prev.map((s) => s.weight_lb)).toEqual([185]);
    expect(previousSets('bench', [older, newer], '2026-11-01T09:00:00.000Z').map((s) => s.weight_lb)).toEqual([175]);
    expect(bestSet('bench', [older, newer])).toMatchObject({ weight_lb: 185, reps: 5, date: '2026-11-01' });
    expect(bestSet('curl', [older])).toBeNull();
  });
});

describe('training sheet rows', () => {
  it('round-trips exercises', () => {
    expect(rowToExercise(exerciseToRow(bench))).toEqual(bench);
  });

  it('round-trips routines with ordered items and planned sets', () => {
    const r: Routine = {
      id: 'r1', name: 'Push A', notes: '', sort_order: 0,
      items: [
        { id: 'i1', exercise_id: 'bench', position: 0, rest_sec: 150, notes: 'pause reps', sets: [{ type: 'W', weight_lb: 95, rep_min: 10, rep_max: 10 }, { type: 'N', weight_lb: 185, rep_min: 5, rep_max: 8 }] },
        { id: 'i2', exercise_id: 'curl', position: 1, rest_sec: 60, notes: '', sets: [{ type: 'N', weight_lb: null, rep_min: 10, rep_max: 12 }] },
      ],
    };
    const rows = routineRows(r);
    const back = rowsToRoutines([rows.routine], [...rows.items].reverse());
    expect(back).toEqual([r]);
  });

  it('round-trips a workout including exercise notes and incomplete sets', () => {
    const w = workout('2026-11-01', '2026-11-01T10:00:00.000Z', {
      bench: [set({ weight_lb: 185, reps: 5 }), set({ weight_lb: 185, reps: null, completed: false })],
      curl: [set({ weight_lb: 30, reps: 12, note: 'slow' })],
    });
    w.exercises[0]!.note = 'felt strong';
    const rows = workoutRows(w);
    expect(rows.workout.duration_sec).toBe(3600);
    expect(rows.sets).toHaveLength(3);
    const back = rowsToWorkouts([rows.workout], [...rows.sets].reverse(), () => 90)[0]!;
    expect(back).toEqual(w);
  });

  it('starter list uses known muscles only', () => {
    const list = starterExercises(id);
    expect(list.length).toBeGreaterThan(30);
    for (const e of list) for (const m of [...e.primary, ...e.secondary]) expect(MUSCLES as readonly string[]).toContain(m);
    expect(new Set(list.map((e) => e.name)).size).toBe(list.length);
  });
});
