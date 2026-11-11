// The workout in progress lives on the phone (saved on every change) until you tap Finish.
// Closing Safari or the app mid-workout loses nothing.
import { chicagoDate } from '../../shared/schema';
import type { LoggedSet, Routine, Workout } from '../../shared/training';
import { safeStore } from './storage';
import { uuid } from './foodData';

const KEY = 'plates.activeWorkout.v1';

export interface RestTimer { endsAt: number; total: number }
export interface ActiveState { workout: Workout; rest: RestTimer | null }

type Listener = () => void;
const listeners = new Set<Listener>();

export function getActive(): ActiveState | null {
  try {
    const raw = safeStore.getItem(KEY);
    return raw ? (JSON.parse(raw) as ActiveState) : null;
  } catch {
    return null;
  }
}

export function setActive(s: ActiveState | null): void {
  if (s) safeStore.setItem(KEY, JSON.stringify(s));
  else safeStore.removeItem(KEY);
  for (const fn of listeners) fn();
}

export function subscribeActive(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function newSet(p: Partial<LoggedSet> = {}): LoggedSet {
  return { id: uuid(), type: 'N', weight_lb: null, reps: null, rep_min: null, rep_max: null, completed: false, rpe: null, note: '', ...p };
}

/**
 * Starts a workout. Weight and reps are pre-filled from your last session of each exercise
 * (set by set), falling back to the routine's planned weight; tapping ✓ accepts them.
 */
export function startWorkout(
  routine?: Routine,
  restFor: (exerciseId: string) => number = () => 90,
  previousFor: (exerciseId: string) => LoggedSet[] = () => [],
): ActiveState {
  const workout: Workout = {
    id: uuid(),
    routine_id: routine?.id ?? '',
    name: routine?.name ?? 'Workout',
    date: chicagoDate(),
    start_time: new Date().toISOString(),
    end_time: '',
    notes: '',
    exercises: (routine?.items ?? []).map((it) => ({
      exercise_id: it.exercise_id,
      rest_sec: it.rest_sec || restFor(it.exercise_id),
      note: it.notes,
      sets: (it.sets.length ? it.sets : [{ type: 'N' as const, weight_lb: null, rep_min: null, rep_max: null }]).map((p, i) => {
        const prev = previousFor(it.exercise_id)[i];
        return newSet({ type: p.type, weight_lb: prev?.weight_lb ?? p.weight_lb, reps: prev?.reps ?? null, rep_min: p.rep_min, rep_max: p.rep_max });
      }),
    })),
  };
  const s = { workout, rest: null };
  setActive(s);
  return s;
}
