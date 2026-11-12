// Workout math and sheet-row conversion, shared by frontend and tests.
// Formulas and choices are documented in docs/algorithm.md (Training section).

import type { Row } from './schema';

export type SetType = 'W' | 'N' | 'F'; // warm-up, normal, failure
export const SET_TYPE_LABELS: Record<SetType, string> = { W: 'Warm-up', N: 'Normal', F: 'Failure' };

export const MUSCLES = [
  'Chest', 'Back', 'Lats', 'Traps', 'Shoulders', 'Biceps', 'Triceps', 'Forearms',
  'Abs', 'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Full body', 'Cardio',
] as const;
export type Muscle = (typeof MUSCLES)[number];

export const EQUIPMENT = ['Barbell', 'Dumbbell', 'Machine', 'Cable', 'Bodyweight', 'Kettlebell', 'Band', 'Other'] as const;

export interface Exercise {
  id: string;
  name: string;
  primary: string[];
  secondary: string[];
  equipment: string;
  rest_sec: number;
  notes: string;
}

export interface PlannedSet {
  type: SetType;
  weight_lb: number | null;
  rep_min: number | null;
  rep_max: number | null;
}

export interface RoutineItem {
  id: string;
  exercise_id: string;
  position: number;
  rest_sec: number;
  sets: PlannedSet[];
  notes: string;
}

export interface Routine {
  id: string;
  name: string;
  notes: string;
  sort_order: number;
  /** Optional folder name; '' = no folder. */
  folder: string;
  items: RoutineItem[];
}

export interface LoggedSet {
  id: string;
  /** UI only: weight pre-filled as a suggested increase (double progression). Not saved. */
  suggested?: boolean;
  type: SetType;
  weight_lb: number | null;
  reps: number | null;
  rep_min: number | null;
  rep_max: number | null;
  completed: boolean;
  rpe: number | null;
  note: string;
}

export interface WorkoutExercise {
  exercise_id: string;
  rest_sec: number;
  note: string;
  sets: LoggedSet[];
}

export interface Workout {
  id: string;
  routine_id: string;
  name: string;
  date: string; // YYYY-MM-DD, America/Chicago
  start_time: string; // ISO
  end_time: string; // ISO ('' while active)
  notes: string;
  exercises: WorkoutExercise[];
}

// ---------- Math ----------

/** Estimated 1-rep max, Epley formula: weight × (1 + reps / 30). 1 rep = the weight itself. */
export function epley1RM(weight: number, reps: number): number {
  if (!(weight > 0) || !(reps > 0)) return 0;
  if (reps === 1) return weight;
  return weight * (1 + reps / 30);
}

/** Sets that count as "working" sets: completed and not warm-ups. */
export const isWorkingSet = (s: Pick<LoggedSet, 'completed' | 'type'>) => s.completed && s.type !== 'W';

/** Volume = Σ weight × reps over completed working sets (warm-ups excluded). */
export function volume(sets: LoggedSet[]): number {
  return sets.filter(isWorkingSet).reduce((sum, s) => sum + (s.weight_lb ?? 0) * (s.reps ?? 0), 0);
}

export function workoutTotals(w: Workout): { volume: number; sets: number; reps: number; durationSec: number } {
  const all = w.exercises.flatMap((e) => e.sets);
  const working = all.filter(isWorkingSet);
  const end = w.end_time ? Date.parse(w.end_time) : Date.now();
  return {
    volume: Math.round(volume(all)),
    sets: working.length,
    reps: working.reduce((n, s) => n + (s.reps ?? 0), 0),
    durationSec: Math.max(0, Math.round((end - Date.parse(w.start_time)) / 1000)),
  };
}

/** Completed working sets per primary muscle. Each set counts once for each of its exercise's primary muscles. */
export function setsPerMuscle(w: Workout | Workout[], exercises: Map<string, Exercise>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const wk of Array.isArray(w) ? w : [w]) {
    for (const e of wk.exercises) {
      const ex = exercises.get(e.exercise_id);
      const n = e.sets.filter(isWorkingSet).length;
      if (!ex || !n) continue;
      for (const m of ex.primary.length ? ex.primary : ['Other']) out[m] = (out[m] ?? 0) + n;
    }
  }
  return out;
}

/** Six broad groups for the balance radar. */
export const MUSCLE_GROUPS: Record<string, string[]> = {
  Back: ['Back', 'Lats', 'Traps'],
  Chest: ['Chest'],
  Core: ['Abs'],
  Shoulders: ['Shoulders'],
  Arms: ['Biceps', 'Triceps', 'Forearms'],
  Legs: ['Quads', 'Hamstrings', 'Glutes', 'Calves'],
};

export function groupSets(perMuscle: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(MUSCLE_GROUPS).map(([g, ms]) => [g, ms.reduce((s, m) => s + (perMuscle[m] ?? 0), 0)]));
}

export interface BestSet { weight_lb: number; reps: number; e1rm: number; date: string }

/** Heaviest estimated 1RM set for an exercise across workouts. */
export function bestSet(exerciseId: string, history: Workout[]): BestSet | null {
  let best: BestSet | null = null;
  for (const w of history) {
    for (const e of w.exercises) {
      if (e.exercise_id !== exerciseId) continue;
      for (const s of e.sets) {
        if (!isWorkingSet(s) || !s.weight_lb || !s.reps) continue;
        const e1rm = epley1RM(s.weight_lb, s.reps);
        if (!best || e1rm > best.e1rm) best = { weight_lb: s.weight_lb, reps: s.reps, e1rm, date: w.date };
      }
    }
  }
  return best;
}

/** Sets from the most recent finished workout that included the exercise ("Previous" column). */
export function previousSets(exerciseId: string, history: Workout[], beforeIso?: string): LoggedSet[] {
  const sorted = [...history]
    .filter((w) => w.end_time && (!beforeIso || w.start_time < beforeIso))
    .sort((a, b) => b.start_time.localeCompare(a.start_time));
  for (const w of sorted) {
    const e = w.exercises.find((x) => x.exercise_id === exerciseId && x.sets.some((s) => s.completed));
    if (e) return e.sets.filter((s) => s.completed);
  }
  return [];
}

/**
 * Workout rotation: the routine after the one you did most recently, in routine order (wraps around).
 * No history yet → the first routine.
 */
export function nextRoutine(routines: Routine[], history: Workout[]): Routine | null {
  if (!routines.length) return null;
  const last = [...history].filter((w) => w.end_time).sort((a, b) => b.start_time.localeCompare(a.start_time))
    .find((w) => routines.some((r) => r.id === w.routine_id));
  if (!last) return routines[0]!;
  // Stay inside the folder (program) you're running: next routine in that folder's order, wrapping around.
  const lastRoutine = routines.find((r) => r.id === last.routine_id)!;
  const group = routines.filter((r) => (r.folder ?? '') === (lastRoutine.folder ?? ''));
  const i = group.findIndex((r) => r.id === lastRoutine.id);
  return group[(i + 1) % group.length]!;
}

/** Totals per calendar week (Mon start) for the last `weeks` weeks, oldest first. */
export function weeklyTotals(history: Workout[], todayDate: string, weeks = 12): { week: string; volume: number; workouts: number }[] {
  const monday = (d: string) => {
    const x = new Date(`${d}T12:00:00Z`);
    x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
    return x.toISOString().slice(0, 10);
  };
  const start = new Date(`${monday(todayDate)}T12:00:00Z`);
  const out: { week: string; volume: number; workouts: number }[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(start); d.setUTCDate(d.getUTCDate() - i * 7);
    out.push({ week: d.toISOString().slice(0, 10), volume: 0, workouts: 0 });
  }
  const byWeek = new Map(out.map((o) => [o.week, o]));
  for (const w of history) {
    if (!w.end_time) continue;
    const o = byWeek.get(monday(w.date));
    if (!o) continue;
    o.workouts += 1;
    o.volume += workoutTotals(w).volume;
  }
  return out;
}

export function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
}

// ---------- Sheet rows ----------

const num = (v: unknown): number | null => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const blank = (v: number | null) => (v == null ? '' : v);
const list = (v: unknown) => String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const setType = (v: unknown): SetType => (v === 'W' || v === 'F' ? v : 'N');

export function exerciseToRow(e: Exercise): Row {
  return {
    id: e.id, name: e.name, primary_muscles: e.primary.join(', '), secondary_muscles: e.secondary.join(', '),
    equipment: e.equipment, default_rest_sec: e.rest_sec, notes: e.notes,
  };
}

export function rowToExercise(r: Row): Exercise {
  return {
    id: String(r.id), name: String(r.name ?? ''), primary: list(r.primary_muscles), secondary: list(r.secondary_muscles),
    equipment: String(r.equipment ?? ''), rest_sec: num(r.default_rest_sec) ?? 90, notes: String(r.notes ?? ''),
  };
}

export function parsePlannedSets(json: unknown): PlannedSet[] {
  try {
    const arr = JSON.parse(String(json || '[]'));
    if (!Array.isArray(arr)) return [];
    return arr.map((s) => ({ type: setType(s?.type), weight_lb: num(s?.weight_lb), rep_min: num(s?.rep_min), rep_max: num(s?.rep_max) }));
  } catch {
    return [];
  }
}

export function routineRows(r: Routine): { routine: Row; items: Row[] } {
  return {
    routine: { id: r.id, name: r.name, notes: r.notes, sort_order: r.sort_order, folder: r.folder ?? '' },
    items: r.items.map((it, i) => ({
      id: it.id, routine_id: r.id, exercise_id: it.exercise_id, position: i, rest_sec: it.rest_sec,
      planned_sets_json: JSON.stringify(it.sets), notes: it.notes,
    })),
  };
}

export function rowsToRoutines(routines: Row[], items: Row[]): Routine[] {
  return routines
    .map((r) => ({
      id: String(r.id),
      name: String(r.name ?? ''),
      notes: String(r.notes ?? ''),
      sort_order: num(r.sort_order) ?? 0,
      folder: String(r.folder ?? '').trim(),
      items: items
        .filter((i) => String(i.routine_id) === String(r.id))
        .map((i) => ({
          id: String(i.id), exercise_id: String(i.exercise_id), position: num(i.position) ?? 0,
          rest_sec: num(i.rest_sec) ?? 90, sets: parsePlannedSets(i.planned_sets_json), notes: String(i.notes ?? ''),
        }))
        .sort((a, b) => a.position - b.position),
    }))
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
}

export function workoutRows(w: Workout): { workout: Row; sets: Row[] } {
  const t = workoutTotals(w);
  const notes: Record<string, string> = {};
  for (const e of w.exercises) if (e.note) notes[e.exercise_id] = e.note;
  return {
    workout: {
      id: w.id, routine_id: w.routine_id, name: w.name, date: w.date, start_time: w.start_time, end_time: w.end_time,
      duration_sec: t.durationSec, notes: w.notes, exercise_notes_json: Object.keys(notes).length ? JSON.stringify(notes) : '',
    },
    sets: w.exercises.flatMap((e, ei) => e.sets.map((s, si) => ({
      id: s.id, workout_id: w.id, exercise_id: e.exercise_id, exercise_order: ei, set_order: si, set_type: s.type,
      weight_lb: blank(s.weight_lb), reps: blank(s.reps), rep_min: blank(s.rep_min), rep_max: blank(s.rep_max),
      completed: s.completed, rpe: blank(s.rpe), note: s.note,
    }))),
  };
}

export function rowsToWorkouts(workouts: Row[], sets: Row[], restFor: (exerciseId: string) => number = () => 90): Workout[] {
  const byWorkout = new Map<string, Row[]>();
  for (const s of sets) {
    const k = String(s.workout_id);
    if (!byWorkout.has(k)) byWorkout.set(k, []);
    byWorkout.get(k)!.push(s);
  }
  return workouts.map((w) => {
    let notes: Record<string, string> = {};
    try { notes = JSON.parse(String(w.exercise_notes_json || '{}')); } catch { notes = {}; }
    const rows = (byWorkout.get(String(w.id)) ?? []).sort((a, b) =>
      (num(a.exercise_order) ?? 0) - (num(b.exercise_order) ?? 0) || (num(a.set_order) ?? 0) - (num(b.set_order) ?? 0));
    const exercises: WorkoutExercise[] = [];
    let current: WorkoutExercise | null = null;
    let currentOrder = -1;
    for (const r of rows) {
      const order = num(r.exercise_order) ?? 0;
      if (!current || order !== currentOrder) {
        current = { exercise_id: String(r.exercise_id), rest_sec: restFor(String(r.exercise_id)), note: notes[String(r.exercise_id)] ?? '', sets: [] };
        currentOrder = order;
        exercises.push(current);
      }
      current.sets.push({
        id: String(r.id), type: setType(r.set_type), weight_lb: num(r.weight_lb), reps: num(r.reps),
        rep_min: num(r.rep_min), rep_max: num(r.rep_max), completed: r.completed === true || r.completed === 'TRUE',
        rpe: num(r.rpe), note: String(r.note ?? ''),
      });
    }
    return {
      id: String(w.id), routine_id: String(w.routine_id ?? ''), name: String(w.name || 'Workout'), date: String(w.date),
      start_time: String(w.start_time), end_time: String(w.end_time ?? ''), notes: String(w.notes ?? ''), exercises,
    };
  });
}

// ---------- Starter exercises ----------
// Generic exercise names (not tied to any app). Muscles: primary; secondary.

type Starter = [name: string, equipment: string, primary: string, secondary: string, rest: number];
export const STARTER_EXERCISES: Starter[] = [
  ['Bench Press', 'Barbell', 'Chest', 'Triceps, Shoulders', 150],
  ['Incline Bench Press', 'Barbell', 'Chest', 'Shoulders, Triceps', 150],
  ['Dumbbell Bench Press', 'Dumbbell', 'Chest', 'Triceps, Shoulders', 120],
  ['Incline Dumbbell Press', 'Dumbbell', 'Chest', 'Shoulders, Triceps', 120],
  ['Chest Fly', 'Cable', 'Chest', 'Shoulders', 90],
  ['Push-up', 'Bodyweight', 'Chest', 'Triceps, Shoulders', 90],
  ['Dip', 'Bodyweight', 'Triceps', 'Chest, Shoulders', 120],
  ['Overhead Press', 'Barbell', 'Shoulders', 'Triceps', 150],
  ['Dumbbell Shoulder Press', 'Dumbbell', 'Shoulders', 'Triceps', 120],
  ['Lateral Raise', 'Dumbbell', 'Shoulders', '', 60],
  ['Rear Delt Fly', 'Dumbbell', 'Shoulders', 'Back', 60],
  ['Face Pull', 'Cable', 'Shoulders', 'Traps, Back', 60],
  ['Deadlift', 'Barbell', 'Back', 'Hamstrings, Glutes, Traps', 180],
  ['Romanian Deadlift', 'Barbell', 'Hamstrings', 'Glutes, Back', 150],
  ['Barbell Row', 'Barbell', 'Back', 'Lats, Biceps', 120],
  ['Dumbbell Row', 'Dumbbell', 'Back', 'Lats, Biceps', 90],
  ['Seated Cable Row', 'Cable', 'Back', 'Lats, Biceps', 90],
  ['Pull-up', 'Bodyweight', 'Lats', 'Biceps, Back', 120],
  ['Chin-up', 'Bodyweight', 'Lats', 'Biceps', 120],
  ['Lat Pulldown', 'Cable', 'Lats', 'Biceps, Back', 90],
  ['Shrug', 'Dumbbell', 'Traps', '', 60],
  ['Barbell Curl', 'Barbell', 'Biceps', 'Forearms', 60],
  ['Dumbbell Curl', 'Dumbbell', 'Biceps', 'Forearms', 60],
  ['Hammer Curl', 'Dumbbell', 'Biceps', 'Forearms', 60],
  ['Triceps Pushdown', 'Cable', 'Triceps', '', 60],
  ['Overhead Triceps Extension', 'Dumbbell', 'Triceps', '', 60],
  ['Skull Crusher', 'Barbell', 'Triceps', '', 75],
  ['Back Squat', 'Barbell', 'Quads', 'Glutes, Hamstrings', 180],
  ['Front Squat', 'Barbell', 'Quads', 'Glutes', 180],
  ['Leg Press', 'Machine', 'Quads', 'Glutes', 120],
  ['Bulgarian Split Squat', 'Dumbbell', 'Quads', 'Glutes', 90],
  ['Walking Lunge', 'Dumbbell', 'Quads', 'Glutes', 90],
  ['Leg Extension', 'Machine', 'Quads', '', 60],
  ['Leg Curl', 'Machine', 'Hamstrings', '', 60],
  ['Hip Thrust', 'Barbell', 'Glutes', 'Hamstrings', 120],
  ['Standing Calf Raise', 'Machine', 'Calves', '', 60],
  ['Seated Calf Raise', 'Machine', 'Calves', '', 60],
  ['Plank', 'Bodyweight', 'Abs', '', 60],
  ['Hanging Leg Raise', 'Bodyweight', 'Abs', '', 60],
  ['Cable Crunch', 'Cable', 'Abs', '', 60],
  ['Wrist Curl', 'Dumbbell', 'Forearms', '', 45],
  ['Kettlebell Swing', 'Kettlebell', 'Glutes', 'Hamstrings, Back', 90],
];

export function starterExercises(makeId: () => string): Exercise[] {
  return STARTER_EXERCISES.map(([name, equipment, primary, secondary, rest]) => ({
    id: makeId(), name, equipment, primary: list(primary), secondary: list(secondary), rest_sec: rest, notes: '',
  }));
}

// ---------- Personal records ----------

export type PrKind = 'e1rm' | 'weight' | 'set_volume' | 'session_volume';
export const PR_LABELS: Record<PrKind, string> = {
  e1rm: 'Est. 1-rep max',
  weight: 'Heaviest weight',
  set_volume: 'Best set (weight × reps)',
  session_volume: 'Total volume',
};
export interface Pr { exercise_id: string; kind: PrKind; before: number | null; after: number }

interface Bests { e1rm: number; weight: number; set_volume: number; session_volume: number }

/** Best numbers for an exercise across workouts (working sets only). */
export function bestsFor(exerciseId: string, workouts: Workout[]): Bests {
  const b: Bests = { e1rm: 0, weight: 0, set_volume: 0, session_volume: 0 };
  for (const w of workouts) {
    let session = 0;
    for (const e of w.exercises) {
      if (e.exercise_id !== exerciseId) continue;
      for (const s of e.sets) {
        if (!isWorkingSet(s) || !s.weight_lb || !s.reps) continue;
        b.e1rm = Math.max(b.e1rm, epley1RM(s.weight_lb, s.reps));
        b.weight = Math.max(b.weight, s.weight_lb);
        b.set_volume = Math.max(b.set_volume, s.weight_lb * s.reps);
        session += s.weight_lb * s.reps;
      }
    }
    b.session_volume = Math.max(b.session_volume, session);
  }
  return b;
}

/** New records set in `workout` compared with `history` (exercises done before get "before"; first-timers get null). */
export function findPrs(workout: Workout, history: Workout[]): Pr[] {
  const before = history.filter((h) => h.id !== workout.id);
  const out: Pr[] = [];
  for (const id of new Set(workout.exercises.map((e) => e.exercise_id))) {
    const now = bestsFor(id, [workout]);
    if (!now.weight) continue;
    const old = bestsFor(id, before);
    const seen = old.weight > 0;
    for (const kind of ['e1rm', 'weight', 'set_volume', 'session_volume'] as const) {
      if (now[kind] > old[kind] + 1e-9 && (seen || kind === 'e1rm')) out.push({ exercise_id: id, kind, before: seen ? old[kind] : null, after: now[kind] });
    }
  }
  return out;
}

/** Is this one set a new record (est. 1RM or heaviest weight) versus history? For the live 🏆 pop-up. */
export function setIsPr(exerciseId: string, set: Pick<LoggedSet, 'type' | 'weight_lb' | 'reps'>, history: Workout[], earlierToday: LoggedSet[] = []): PrKind | null {
  if (set.type === 'W' || !set.weight_lb || !set.reps) return null;
  const old = bestsFor(exerciseId, history);
  if (!old.weight) return null; // first time doing it: no "record" yet
  const today = bestsFor(exerciseId, [{ id: '_', routine_id: '', name: '', date: '', start_time: '', end_time: '', notes: '', exercises: [{ exercise_id: exerciseId, rest_sec: 0, note: '', sets: earlierToday }] }]);
  const e1 = epley1RM(set.weight_lb, set.reps);
  if (e1 > Math.max(old.e1rm, today.e1rm) + 1e-9) return 'e1rm';
  if (set.weight_lb > Math.max(old.weight, today.weight)) return 'weight';
  return null;
}

// ---------- Updating a routine after a workout ----------

export interface RoutineUpdate {
  routine: Routine; // what to save
  structureChanged: boolean; // exercises added / removed / swapped / reordered vs the routine
  weightChanges: { exercise_id: string; from: number | null; to: number }[];
}

/**
 * The routine after a workout started from it.
 * keepChanges = true → exercise list/order follows the workout; false → the routine's own list stays.
 * Either way each planned weight becomes the heavier of (planned, lifted today) — weights never go down.
 * `done` = the workout's exercises including unchecked sets (so skipping a set doesn't delete it from the routine).
 */
export function updatedRoutine(routine: Routine, done: WorkoutExercise[], keepChanges: boolean, makeId: () => string): RoutineUpdate {
  const ids = (xs: { exercise_id: string }[]) => xs.map((x) => x.exercise_id).join('|');
  const structureChanged = ids(routine.items) !== ids(done);
  const weightChanges: RoutineUpdate['weightChanges'] = [];
  const used = new Set<number>();
  const findDone = (exId: string) => {
    const i = done.findIndex((d, k) => !used.has(k) && d.exercise_id === exId);
    if (i >= 0) used.add(i);
    return i >= 0 ? done[i]! : undefined;
  };
  const maxed = (item: RoutineItem, d: WorkoutExercise | undefined): PlannedSet[] => {
    const sets = item.sets.map((p) => ({ ...p }));
    if (!d) return sets;
    // More sets done than planned (structure kept) → add them.
    if (keepChanges) for (let i = sets.length; i < d.sets.length; i++) {
      const s = d.sets[i]!;
      sets.push({ type: s.type, weight_lb: s.weight_lb, rep_min: s.rep_min ?? s.reps, rep_max: s.rep_max ?? s.reps });
    }
    const before = Math.max(0, ...item.sets.map((p) => p.weight_lb ?? 0));
    sets.forEach((p, i) => {
      const s = d.sets[i];
      if (s?.completed && s.weight_lb != null && s.weight_lb > (p.weight_lb ?? 0) && s.type === p.type) p.weight_lb = s.weight_lb;
    });
    const after = Math.max(0, ...sets.map((p) => p.weight_lb ?? 0));
    if (after > before) weightChanges.push({ exercise_id: item.exercise_id, from: before || null, to: after });
    return sets;
  };

  let items: RoutineItem[];
  if (keepChanges && structureChanged) {
    const pool = [...routine.items];
    items = done.map((d, position) => {
      const k = pool.findIndex((it) => it.exercise_id === d.exercise_id);
      if (k >= 0) {
        const it = pool.splice(k, 1)[0]!;
        used.add(done.indexOf(d));
        return { ...it, position, sets: maxed(it, d) };
      }
      const sets: PlannedSet[] = d.sets.map((s) => ({ type: s.type, weight_lb: s.weight_lb, rep_min: s.rep_min ?? s.reps, rep_max: s.rep_max ?? s.reps }));
      const w = Math.max(0, ...sets.map((s) => s.weight_lb ?? 0));
      if (w) weightChanges.push({ exercise_id: d.exercise_id, from: null, to: w });
      return { id: makeId(), exercise_id: d.exercise_id, position, rest_sec: d.rest_sec, sets, notes: '' };
    });
  } else {
    items = routine.items.map((it) => ({ ...it, sets: maxed(it, findDone(it.exercise_id)) }));
  }
  return { routine: { ...routine, items }, structureChanged, weightChanges };
}

// ---------- Progression (double progression) ----------

/** Weight step for a suggested increase: smaller jumps for light weights (dumbbells, isolation). */
export const weightStep = (lb: number) => (lb < 50 ? 2.5 : 5);

/**
 * Double progression: if last time every working set reached the top of its rep range, suggest the next weight up.
 * Returns the weight to pre-fill per planned set, and whether it's an increase.
 */
export function progressionFor(planned: PlannedSet[], prev: LoggedSet[]): { weights: (number | null)[]; increased: boolean } {
  const working = planned.map((p, i) => ({ p, s: prev[i], i })).filter((x) => x.p.type !== 'W');
  const ready = working.length > 0 && working.every(({ p, s }) =>
    s && s.completed && s.weight_lb != null && s.reps != null && p.rep_max != null && s.reps >= p.rep_max && s.weight_lb >= (p.weight_lb ?? 0));
  const weights = planned.map((p, i) => {
    const s = prev[i];
    const base = s?.weight_lb ?? p.weight_lb;
    if (!ready || p.type === 'W' || base == null) return base ?? null;
    return base + weightStep(base);
  });
  return { weights, increased: ready };
}

// ---------- Stalls, deloads, plates, weekly muscle targets ----------

export interface Stall { exercise_id: string; since: string; days: number; sessions: number; best: number }

/** No new best est. 1RM for ≥ `minDays` days across ≥ `minSessions` sessions since the last best. */
export function findStall(exerciseId: string, history: Workout[], today: string, minDays = 28, minSessions = 3): Stall | null {
  const sessions = history
    .filter((w) => w.end_time && w.exercises.some((e) => e.exercise_id === exerciseId))
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
  let best = 0;
  let since = '';
  let after = 0;
  for (const w of sessions) {
    const b = bestsFor(exerciseId, [w]).e1rm;
    if (b > best + 1e-9) { best = b; since = w.date; after = 0; } else after++;
  }
  if (!best || !since) return null;
  const days = Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${since}T12:00:00Z`)) / 86400000);
  return days >= minDays && after >= minSessions ? { exercise_id: exerciseId, since, days, sessions: after, best } : null;
}

/** Deload: about 10 % lighter, rounded to the usual plate step. */
export function deloadWeight(lb: number): number {
  const step = weightStep(lb);
  return Math.max(step, Math.round((lb * 0.9) / step) * step);
}

export const PLATES = [45, 35, 25, 10, 5, 2.5] as const;

/** Plates for one side of the bar (greedy, standard lb plates). `left` > 0 means it can't be made exactly. */
export function platesPerSide(total: number, bar: number): { plates: number[]; left: number } {
  let per = (total - bar) / 2;
  const plates: number[] = [];
  if (!(per > 0)) return { plates, left: Math.max(0, per) };
  for (const p of PLATES) while (per >= p - 1e-9) { plates.push(p); per -= p; }
  return { plates, left: Math.round(per * 100) / 100 };
}

/** [Assumption] Common evidence-based range for hypertrophy: ~10–20 hard sets per muscle per week. */
export const WEEKLY_SET_TARGET = { min: 10, max: 20 };
