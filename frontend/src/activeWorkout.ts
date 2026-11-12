// The workout in progress lives on the phone (saved on every change) until you tap Finish.
// Closing Safari or the app mid-workout loses nothing.
import { chicagoDate } from '../../shared/schema';
import { suggestSets, type LoggedSet, type Routine, type Workout } from '../../shared/training';
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
  recentFor: (exerciseId: string) => LoggedSet[][] = () => [],
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
      ...(() => {
        const planned = it.sets.length ? it.sets : [{ type: 'N' as const, weight_lb: null, rep_min: null, rep_max: null }];
        // Recent best (not just last time) → +5 lb once every working set hits the top of the range. See suggestSets().
        const sug = suggestSets(planned, recentFor(it.exercise_id));
        return {
          note: it.notes,
          why: sug.why,
          sets: planned.map((p, i) => newSet({
            type: p.type, weight_lb: sug.weights[i] ?? null, rep_min: p.rep_min, rep_max: p.rep_max,
            reps: sug.reps[i] ?? null,
            suggested: sug.increased && p.type !== 'W',
          })),
        };
      })(),
    })),
  };
  const s = { workout, rest: null };
  setActive(s);
  return s;
}
