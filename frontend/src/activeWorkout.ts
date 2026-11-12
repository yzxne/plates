// The workout in progress lives on the phone (saved on every change) until you tap Finish.
// Closing Safari or the app mid-workout loses nothing.
import { chicagoDate } from '../../shared/schema';
import { progressionFor, type LoggedSet, type Routine, type Workout } from '../../shared/training';
import { safeStore } from './storage';
import { uuid } from './foodData';

const KEY = 'plates.activeWorkout.v1';

/** `title`/`next` describe what comes after the rest, e.g. "Incline Chest Press" / "Set 2 of 3 · 180 lb × 8–10". */
export interface RestTimer { endsAt: number; total: number; title?: string; next?: string }
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
      sets: (() => {
        const planned = it.sets.length ? it.sets : [{ type: 'N' as const, weight_lb: null, rep_min: null, rep_max: null }];
        const prev = previousFor(it.exercise_id);
        // Hit the top of the rep range on every working set last time → suggest the next weight up, reps start fresh.
        const prog = progressionFor(planned, prev);
        return planned.map((p, i) => newSet({
          type: p.type, weight_lb: prog.weights[i] ?? null, rep_min: p.rep_min, rep_max: p.rep_max,
          reps: prog.increased && p.type !== 'W' ? null : prev[i]?.reps ?? null,
          suggested: prog.increased && p.type !== 'W',
        }));
      })(),
    })),
  };
  const s = { workout, rest: null };
  setActive(s);
  return s;
}
