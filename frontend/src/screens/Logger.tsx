import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  bestSet, formatDuration, isWorkingSet, previousSets, setsPerMuscle, workoutTotals,
  type Exercise, type LoggedSet, type SetType, type Workout,
} from '../../../shared/training';
import { getActive, newSet, setActive, subscribeActive, type ActiveState, type RestTimer as Rest } from '../activeWorkout';
import { errorMessage } from '../api';
import { MuscleBars } from '../components/Charts';
import { ExercisePicker } from '../components/ExercisePicker';
import { IconClose } from '../components/Icons';
import { RestTimer } from '../components/RestTimer';
import { fmt } from '../format';
import { unlockAudio } from '../sound';
import { showToast } from '../toast';
import { saveWorkout } from '../trainData';

interface Props {
  exercises: Exercise[];
  history: Workout[];
  onMinimize: () => void;
  onDone: () => void;
}

const REST_OPTIONS = [0, 30, 45, 60, 75, 90, 120, 150, 180, 240, 300];
const restLabel = (s: number) => (s === 0 ? 'Off' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);

export function Logger({ exercises, history, onMinimize, onDone }: Props) {
  const [state, setState] = useState<ActiveState | null>(getActive());
  const [now, setNow] = useState(Date.now());
  const [picking, setPicking] = useState(false);
  const [summary, setSummary] = useState<Workout | null>(null);
  const [saving, setSaving] = useState(false);
  const exMap = useMemo(() => new Map(exercises.map((e) => [e.id, e])), [exercises]);

  useEffect(() => subscribeActive(() => setState(getActive())), []);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  if (summary) return <Summary workout={summary} history={history} exMap={exMap} onDone={onDone} />;
  if (!state) return null;
  const w = state.workout;

  const update = (fn: (w: Workout) => Workout, rest: Rest | null | undefined = undefined) => {
    const cur = getActive();
    if (!cur) return;
    setActive({ workout: fn(structuredClone(cur.workout)), rest: rest === undefined ? cur.rest : rest });
  };
  const setRest = (r: Rest | null) => update((x) => x, r);

  const totals = workoutTotals({ ...w, end_time: new Date(now).toISOString() });

  function patchSet(ei: number, si: number, p: Partial<LoggedSet>) {
    update((x) => { Object.assign(x.exercises[ei]!.sets[si]!, p); return x; });
  }

  function toggleDone(ei: number, si: number) {
    unlockAudio(); // a tap is needed before iPhone allows the timer beep
    const ex = w.exercises[ei]!;
    const s = ex.sets[si]!;
    if (s.completed) { patchSet(ei, si, { completed: false }); return; }
    const prev = previousSets(ex.exercise_id, history)[si];
    const fill: Partial<LoggedSet> = { completed: true };
    if (s.weight_lb == null && prev?.weight_lb != null) fill.weight_lb = prev.weight_lb;
    if (s.reps == null) fill.reps = prev?.reps ?? s.rep_max ?? s.rep_min ?? null;
    if (fill.reps == null && s.reps == null) { showToast('Enter reps first', 'error'); return; }
    const rest = ex.rest_sec > 0 ? { endsAt: Date.now() + ex.rest_sec * 1000, total: ex.rest_sec } : null;
    update((x) => { Object.assign(x.exercises[ei]!.sets[si]!, fill); return x; }, rest);
  }

  function addSet(ei: number) {
    update((x) => {
      const last = x.exercises[ei]!.sets.at(-1);
      x.exercises[ei]!.sets.push(newSet({ weight_lb: last?.weight_lb ?? null, rep_min: last?.rep_min ?? null, rep_max: last?.rep_max ?? null }));
      return x;
    });
  }

  function exerciseAction(ei: number, action: string) {
    if (action.startsWith('rest:')) {
      update((x) => { x.exercises[ei]!.rest_sec = Number(action.slice(5)); return x; });
    } else if (action === 'up' && ei > 0) {
      update((x) => { const [e] = x.exercises.splice(ei, 1); x.exercises.splice(ei - 1, 0, e!); return x; });
    } else if (action === 'down' && ei < w.exercises.length - 1) {
      update((x) => { const [e] = x.exercises.splice(ei, 1); x.exercises.splice(ei + 1, 0, e!); return x; });
    } else if (action === 'note') {
      update((x) => { x.exercises[ei]!.note ||= ' '; return x; });
    } else if (action === 'remove') {
      if (confirm(`Remove ${exMap.get(w.exercises[ei]!.exercise_id)?.name ?? 'this exercise'} from the workout?`)) {
        update((x) => { x.exercises.splice(ei, 1); return x; });
      }
    }
  }

  function addExercise(e: Exercise) {
    setPicking(false);
    update((x) => {
      x.exercises.push({ exercise_id: e.id, rest_sec: e.rest_sec, note: '', sets: [newSet()] });
      return x;
    });
  }

  function discard() {
    if (!confirm('Discard this workout? Nothing will be saved.')) return;
    setActive(null);
    onDone();
  }

  async function finish() {
    const done = w.exercises.reduce((n, e) => n + e.sets.filter((s) => s.completed).length, 0);
    const unchecked = w.exercises.reduce((n, e) => n + e.sets.filter((s) => !s.completed).length, 0);
    if (!done) { showToast('Check off at least one set, or discard the workout.', 'error'); return; }
    if (!confirm(unchecked ? `Finish workout? ${unchecked} unchecked set${unchecked > 1 ? 's' : ''} will be left out.` : 'Finish workout?')) return;
    const final: Workout = {
      ...structuredClone(w),
      name: w.name.trim() || 'Workout',
      end_time: new Date().toISOString(),
      exercises: w.exercises
        .map((e) => ({ ...e, note: e.note.trim(), sets: e.sets.filter((s) => s.completed) }))
        .filter((e) => e.sets.length),
    };
    setSaving(true);
    try {
      const ok = await saveWorkout(final);
      setActive(null);
      if (!ok) showToast('Saved on this phone — will upload when the connection is back', 'error', 6000);
      setSummary(final);
    } catch (err) {
      showToast(`Not saved: ${errorMessage(err)}. Your workout is still here.`, 'error', 7000);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div class="overlay logger" role="dialog" aria-modal="true" aria-label="Workout">
      <header class="overlay-head">
        <button class="icon-btn" aria-label="Minimize workout" onClick={onMinimize}><IconClose /></button>
        <input class="workout-name" aria-label="Workout name" value={w.name} onInput={(e) => { const v = e.currentTarget.value; update((x) => ({ ...x, name: v })); }} />
        <button class="btn primary small-btn" disabled={saving} onClick={finish}>{saving ? 'Saving…' : 'Finish'}</button>
      </header>
      <div class="overlay-body">
        <div class="stat-row">
          <div><strong>{formatDuration(totals.durationSec)}</strong><span>Duration</span></div>
          <div><strong>{fmt(totals.volume)}</strong><span>Volume lb</span></div>
          <div><strong>{totals.sets}</strong><span>Sets</span></div>
        </div>

        {w.exercises.length === 0 && <p class="muted center">Add your first exercise.</p>}

        {w.exercises.map((ex, ei) => {
          const info = exMap.get(ex.exercise_id);
          const prev = previousSets(ex.exercise_id, history);
          let normalNo = 0;
          return (
            <div class="card ex-card" key={`${ex.exercise_id}-${ei}`}>
              <div class="ex-head">
                <h2 class="clip">{info?.name ?? 'Unknown exercise'}</h2>
                <select class="ex-menu" aria-label="Exercise options" value="" onChange={(e) => { exerciseAction(ei, e.currentTarget.value); e.currentTarget.value = ''; }}>
                  <option value="" disabled>⋯</option>
                  <option value="note">Add note</option>
                  <optgroup label="Rest timer">
                    {REST_OPTIONS.map((s) => <option key={s} value={`rest:${s}`}>{restLabel(s)}{s === ex.rest_sec ? ' ✓' : ''}</option>)}
                  </optgroup>
                  {ei > 0 && <option value="up">Move up</option>}
                  {ei < w.exercises.length - 1 && <option value="down">Move down</option>}
                  <option value="remove">Remove exercise</option>
                </select>
              </div>
              <small class="muted">Rest {restLabel(ex.rest_sec)}{info?.primary.length ? ` · ${info.primary.join(', ')}` : ''}</small>
              {ex.note !== '' && (
                <textarea class="ex-note" rows={1} placeholder="Note" value={ex.note.trim() ? ex.note : ''}
                  onInput={(e) => { const v = e.currentTarget.value; update((x) => { x.exercises[ei]!.note = v; return x; }); }} />
              )}
              <div class="set-grid set-head">
                <span>Set</span><span>Previous</span><span>lb</span><span>Reps</span><span aria-label="Done">✓</span>
              </div>
              {ex.sets.map((s, si) => {
                if (s.type === 'N') normalNo++;
                const p = prev[si];
                const range = s.rep_min != null || s.rep_max != null
                  ? (s.rep_min === s.rep_max || s.rep_max == null ? `${s.rep_min}` : s.rep_min == null ? `${s.rep_max}` : `${s.rep_min}-${s.rep_max}`)
                  : '';
                return (
                  <div class={`set-grid set-row ${s.completed ? 'done' : ''}`} key={s.id}>
                    <select class={`set-type t-${s.type}`} aria-label="Set type" value={s.type}
                      onChange={(e) => {
                        const v = e.currentTarget.value;
                        if (v === 'del') update((x) => { x.exercises[ei]!.sets.splice(si, 1); return x; });
                        else patchSet(ei, si, { type: v as SetType });
                      }}>
                      <option value="W">W</option>
                      <option value="N">{s.type === 'N' ? normalNo : 'N'}</option>
                      <option value="F">F</option>
                      <option value="del">Delete set</option>
                    </select>
                    <button class="prev" disabled={!p} onClick={() => p && patchSet(ei, si, { weight_lb: p.weight_lb, reps: p.reps })}>
                      {p ? `${fmt(p.weight_lb ?? 0, 1)}×${p.reps ?? 0}` : '–'}
                    </button>
                    <input type="number" inputMode="decimal" step="any" aria-label="Weight lb" placeholder={p?.weight_lb != null ? String(p.weight_lb) : ''}
                      value={s.weight_lb ?? ''} onInput={(e) => { const v = e.currentTarget.value; patchSet(ei, si, { weight_lb: v === '' ? null : Number(v) }); }} />
                    <input type="number" inputMode="numeric" aria-label="Reps" placeholder={range || (p?.reps != null ? String(p.reps) : '')}
                      value={s.reps ?? ''} onInput={(e) => { const v = e.currentTarget.value; patchSet(ei, si, { reps: v === '' ? null : Math.round(Number(v)) }); }} />
                    <button class={`check ${s.completed ? 'on' : ''}`} aria-pressed={s.completed} aria-label="Set done" onClick={() => toggleDone(ei, si)}>✓</button>
                  </div>
                );
              })}
              <button class="btn add-set" onClick={() => addSet(ei)}>+ Add set</button>
            </div>
          );
        })}

        <button class="btn primary" onClick={() => setPicking(true)}>+ Add exercise</button>
        <button class="btn link danger center" onClick={discard}>Discard workout</button>
        <div style={{ height: state.rest ? '72px' : '0' }} />
      </div>

      {state.rest && <RestTimer rest={state.rest} onChange={setRest} />}
      {picking && <ExercisePicker exercises={exercises} onPick={addExercise} onClose={() => setPicking(false)} />}
    </div>
  );
}

function Summary({ workout, history, exMap, onDone }: { workout: Workout; history: Workout[]; exMap: Map<string, Exercise>; onDone: () => void }) {
  const t = workoutTotals(workout);
  const before = history.filter((h) => h.id !== workout.id);
  const prs = workout.exercises.flatMap((e) => {
    const now = bestSet(e.exercise_id, [workout]);
    const old = bestSet(e.exercise_id, before);
    if (!now || (old && now.e1rm <= old.e1rm)) return [];
    return [{ name: exMap.get(e.exercise_id)?.name ?? 'Exercise', set: now, first: !old }];
  });
  return (
    <div class="overlay" role="dialog" aria-modal="true" aria-label="Workout summary">
      <div class="overlay-body">
        <h1>Workout saved</h1>
        <p class="muted">{workout.name}</p>
        <div class="stat-row">
          <div><strong>{formatDuration(t.durationSec)}</strong><span>Duration</span></div>
          <div><strong>{fmt(t.volume)}</strong><span>Volume lb</span></div>
          <div><strong>{t.sets}</strong><span>Sets</span></div>
        </div>
        {prs.length > 0 && (
          <div class="card">
            <h2>New bests</h2>
            {prs.map((p) => (
              <p key={p.name}><strong>{p.name}</strong>: {fmt(p.set.weight_lb, 1)} lb × {p.set.reps}
                <span class="muted"> · est. 1RM {fmt(p.set.e1rm)} lb{p.first ? ' (first time)' : ''}</span></p>
            ))}
            <small class="muted">Estimated 1RM uses the Epley formula: weight × (1 + reps ÷ 30).</small>
          </div>
        )}
        <div class="card">
          <h2>Sets per muscle</h2>
          <MuscleBars counts={setsPerMuscle(workout, exMap)} />
          <small class="muted">Completed working sets (warm-ups not counted), by main muscle.</small>
        </div>
        <div class="card">
          {workout.exercises.map((e) => (
            <p key={e.exercise_id}>
              <strong>{exMap.get(e.exercise_id)?.name ?? 'Exercise'}</strong>
              <span class="muted"> · {e.sets.filter(isWorkingSet).map((s) => `${fmt(s.weight_lb ?? 0, 1)}×${s.reps}`).join(', ') || 'warm-ups only'}</span>
            </p>
          ))}
        </div>
        <button class="btn primary" onClick={onDone}>Done</button>
      </div>
    </div>
  );
}

