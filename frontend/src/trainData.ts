// Training data in the Sheet: Exercises, Routines + RoutineExercises, Workouts + Sets.
import {
  exerciseToRow, routineRows, rowsToRoutines, rowsToWorkouts, rowToExercise, starterExercises, workoutRows,
  type Exercise, type Routine, type Workout,
} from '../../shared/training';
import { readTabs, uuid, write } from './foodData';

let exercisesCache: Exercise[] | null = null;
let historyCache: Workout[] | null = null;

const byName = (a: Exercise, b: Exercise) => a.name.localeCompare(b.name);
const now = () => new Date().toISOString();

export async function loadExercises(force = false): Promise<Exercise[]> {
  if (exercisesCache && !force) return exercisesCache;
  const d = await readTabs(['Exercises']);
  exercisesCache = (d.Exercises ?? []).map(rowToExercise).sort(byName);
  return exercisesCache;
}

export function exerciseMap(): Map<string, Exercise> {
  return new Map((exercisesCache ?? []).map((e) => [e.id, e]));
}

export async function seedStarterExercises(): Promise<Exercise[]> {
  const list = starterExercises(uuid);
  await write('/sheet/append', { tab: 'Exercises', rows: list.map(exerciseToRow) }, 'Starter exercises');
  exercisesCache = [...(exercisesCache ?? []), ...list].sort(byName);
  return exercisesCache;
}

export async function saveExercise(e: Exercise, isNew: boolean): Promise<void> {
  await write(isNew ? '/sheet/append' : '/sheet/update', { tab: 'Exercises', rows: [exerciseToRow(e)] }, `Exercise: ${e.name}`);
  exercisesCache = [...(exercisesCache ?? []).filter((x) => x.id !== e.id), e].sort(byName);
}

// ---------- Routines ----------

export async function loadRoutines(): Promise<Routine[]> {
  const d = await readTabs(['Routines', 'RoutineExercises']);
  return rowsToRoutines(d.Routines ?? [], d.RoutineExercises ?? []);
}

/** Saves a routine. `before` is the version loaded from the Sheet (undefined for a new routine). */
export async function saveRoutine(r: Routine, before?: Routine): Promise<void> {
  const { routine, items } = routineRows(r);
  await write(before ? '/sheet/update' : '/sheet/append', { tab: 'Routines', rows: [routine] }, `Routine: ${r.name}`);
  const oldIds = new Set(before?.items.map((i) => i.id) ?? []);
  const keep = new Set(r.items.map((i) => i.id));
  const updates = items.filter((i) => oldIds.has(String(i.id)));
  const appends = items.filter((i) => !oldIds.has(String(i.id)));
  const removed = (before?.items ?? []).filter((i) => !keep.has(i.id)).map((i) => ({ id: i.id, deleted_at: now() }));
  if (updates.length || removed.length) {
    await write('/sheet/update', { tab: 'RoutineExercises', rows: [...updates, ...removed] }, `Routine exercises: ${r.name}`);
  }
  if (appends.length) await write('/sheet/append', { tab: 'RoutineExercises', rows: appends }, `Routine exercises: ${r.name}`);
}

export async function deleteRoutine(r: Routine): Promise<void> {
  const ts = now();
  await write('/sheet/update', { tab: 'Routines', rows: [{ id: r.id, deleted_at: ts }] }, `Delete routine: ${r.name}`);
  if (r.items.length) {
    await write('/sheet/update', { tab: 'RoutineExercises', rows: r.items.map((i) => ({ id: i.id, deleted_at: ts })) }, `Delete routine: ${r.name}`);
  }
}

// ---------- Workouts ----------

export async function loadHistory(force = false): Promise<Workout[]> {
  if (historyCache && !force) return historyCache;
  const d = await readTabs(['Workouts', 'Sets']);
  const rest = (id: string) => exerciseMap().get(id)?.rest_sec ?? 90;
  historyCache = rowsToWorkouts(d.Workouts ?? [], d.Sets ?? [], rest)
    .filter((w) => w.end_time)
    .sort((a, b) => b.start_time.localeCompare(a.start_time));
  return historyCache;
}

export function cachedHistory(): Workout[] {
  return historyCache ?? [];
}

/** Saves a finished workout. Returns false if it was queued to retry. */
export async function saveWorkout(w: Workout): Promise<boolean> {
  const { workout, sets } = workoutRows(w);
  const a = await write('/sheet/append', { tab: 'Workouts', rows: [workout] }, `Workout: ${w.name}`);
  const b = sets.length ? await write('/sheet/append', { tab: 'Sets', rows: sets }, `Sets: ${w.name}`) : true;
  historyCache = [w, ...(historyCache ?? []).filter((x) => x.id !== w.id)];
  return a && b;
}

export async function deleteWorkout(w: Workout): Promise<void> {
  const ts = now();
  await write('/sheet/update', { tab: 'Workouts', rows: [{ id: w.id, deleted_at: ts }] }, `Delete workout: ${w.name}`);
  const setIds = w.exercises.flatMap((e) => e.sets.map((s) => s.id));
  if (setIds.length) await write('/sheet/update', { tab: 'Sets', rows: setIds.map((id) => ({ id, deleted_at: ts })) }, `Delete sets: ${w.name}`);
  historyCache = (historyCache ?? []).filter((x) => x.id !== w.id);
}
