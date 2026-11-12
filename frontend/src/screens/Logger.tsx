import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  epley1RM, findPrs, formatDuration, isWorkingSet, previousSets, PR_LABELS, setIsPr, setsPerMuscle, updatedRoutine, workoutTotals,
  type Exercise, type LoggedSet, type Pr, type Routine, type RoutineUpdate, type SetType, type Workout, type WorkoutExercise,
} from '../../../shared/training';
import { getActive, newSet, setActive, subscribeActive, type ActiveState, type RestTimer as Rest } from '../activeWorkout';
import { errorMessage } from '../api';
import { MuscleBars } from '../components/Charts';
import { ActionSheet } from '../components/ActionSheet';
import { ExercisePicker } from '../components/ExercisePicker';
import { IconClose } from '../components/Icons';
import { PlateCalc } from '../components/PlateCalc';
import { RestTimer } from '../components/RestTimer';
import { fmt } from '../format';
import { cancelRestPush, scheduleRestPush } from '../push';
import { unlockAudio } from '../sound';
import { showToast } from '../toast';
import { uuid } from '../foodData';
import { loadRoutines, saveRoutine, saveWorkout } from '../trainData';

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
  const [replacing, setReplacing] = useState<number | null>(null);
  const [plates, setPlates] = useState<number | null | undefined>(undefined); // undefined = closed
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [saving, setSaving] = useState(false);
  // Exercises created or added from the library during this workout aren't in the list we were opened with.
  const [added, setAdded] = useState<Exercise[]>([]);
  const exMap = useMemo(() => new Map([...exercises, ...added].map((e) => [e.id, e])), [exercises, added]);
  const [menu, setMenu] = useState<number | null>(null);
  const known = (e: Exercise) => { if (!exMap.has(e.id)) setAdded((a) => [...a, e]); };

  useEffect(() => subscribeActive(() => setState(getActive())), []);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  if (summary) return <Summary data={summary} exMap={exMap} onDone={onDone} />;
  if (!state) return null;
  const w = state.workout;

  const update = (fn: (w: Workout) => Workout, rest: Rest | null | undefined = undefined) => {
    const cur = getActive();
    if (!cur) return;
    setActive({ workout: fn(structuredClone(cur.workout)), rest: rest === undefined ? cur.rest : rest });
  };
  const setRest = (r: Rest | null) => {
    if (r) scheduleRestPush((r.endsAt - Date.now()) / 1000); else cancelRestPush();
    update((x) => x, r);
  };

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
    const rest = ex.rest_sec > 0 ? { endsAt: Date.now() + ex.rest_sec * 1000, total: ex.rest_sec, ...nextUp(ei, si) } : null;
    if (rest) scheduleRestPush(ex.rest_sec);
    update((x) => { Object.assign(x.exercises[ei]!.sets[si]!, fill); return x; }, rest);
    // Live record check: beats your best est. 1RM or heaviest weight (history + earlier sets today)?
    const done = { ...s, ...fill };
    const earlier = w.exercises.filter((x) => x.exercise_id === ex.exercise_id).flatMap((x) => x.sets).filter((x) => x.completed && x.id !== s.id);
    const pr = setIsPr(ex.exercise_id, done, history, earlier);
    if (pr) {
      const name = exMap.get(ex.exercise_id)?.name ?? 'Exercise';
      showToast(pr === 'e1rm'
        ? `🏆 New PR · ${name}: est. 1RM ${fmt(epley1RM(done.weight_lb!, done.reps!))} lb`
        : `🏆 New PR · ${name}: heaviest ${fmt(done.weight_lb!, 1)} lb`, 'ok', 5000);
    }
  }

  /** What comes after set `si` of exercise `ei` (for the rest bar): the next unchecked set here, else the next exercise. */
  function nextUp(ei: number, si: number): { title?: string; next?: string } {
    const describe = (e: number, s: number) => {
      const ex = w.exercises[e]!;
      const set = ex.sets[s]!;
      const reps = set.rep_min != null && set.rep_max != null && set.rep_min !== set.rep_max ? `${set.rep_min}–${set.rep_max}` : set.reps ?? set.rep_max ?? set.rep_min;
      const load = set.weight_lb != null ? `${fmt(set.weight_lb, 1)} lb` : 'BW';
      return {
        title: exMap.get(ex.exercise_id)?.name ?? 'Next exercise',
        next: `Next: set ${s + 1} of ${ex.sets.length}${reps != null ? ` · ${load} × ${reps}` : ''}`,
      };
    };
    const here = w.exercises[ei]!.sets.findIndex((s, i) => i > si && !s.completed);
    if (here >= 0) return describe(ei, here);
    for (let e = ei + 1; e < w.exercises.length; e++) {
      const s = w.exercises[e]!.sets.findIndex((x) => !x.completed);
      if (s >= 0) return describe(e, s);
    }
    return { title: 'Last set done', next: 'Tap Finish when you’re ready' };
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
    } else if (action === 'plates') {
      const ex = w.exercises[ei]!;
      setPlates((ex.sets.find((s) => !s.completed) ?? ex.sets.at(-1))?.weight_lb ?? null);
    } else if (action === 'replace') {
      setReplacing(ei);
    } else if (action === 'remove') {
      if (confirm(`Remove ${exMap.get(w.exercises[ei]!.exercise_id)?.name ?? 'this exercise'} from the workout?`)) {
        update((x) => { x.exercises.splice(ei, 1); return x; });
      }
    }
  }

  /** Swap one exercise for another mid-workout: same number/type of sets, last time's weights for the new one. */
  function replaceExercise(ei: number, e: Exercise) {
    setReplacing(null);
    const cur = w.exercises[ei]!;
    const oldName = exMap.get(cur.exercise_id)?.name ?? 'this exercise';
    const doneSets = cur.sets.filter((s) => s.completed).length;
    if (doneSets && !confirm(`Replace ${oldName} with ${e.name}? The ${doneSets} set${doneSets > 1 ? 's' : ''} you checked off for ${oldName} will be removed.`)) return;
    const prev = previousSets(e.id, history);
    update((x) => {
      x.exercises[ei] = {
        exercise_id: e.id, rest_sec: e.rest_sec, note: '',
        sets: cur.sets.map((s, i) => newSet({ type: s.type, weight_lb: prev[i]?.weight_lb ?? null, rep_min: s.rep_min, rep_max: s.rep_max })),
      };
      return x;
    });
    showToast(`Swapped in ${e.name}`, 'info');
  }

  function addExercise(e: Exercise) {
    setPicking(false);
    update((x) => {
      const prev = previousSets(e.id, history);
      const sets = prev.length ? prev.map((p) => newSet({ type: p.type, weight_lb: p.weight_lb, reps: p.reps })) : [newSet()];
      x.exercises.push({ exercise_id: e.id, rest_sec: e.rest_sec, note: '', sets });
      return x;
    });
  }

  function discard() {
    if (!confirm('Discard this workout? Nothing will be saved.')) return;
    cancelRestPush();
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
      cancelRestPush();
      const ok = await saveWorkout(final);
      setActive(null);
      if (!ok) showToast('Saved on this phone — will upload when the connection is back', 'error', 6000);
      const prs = findPrs(final, history);
      // Routine follow-up: heavier weights always carry over; changed exercises wait for your Keep/Discard choice.
      let routineInfo: SummaryData['routine'] = null;
      if (w.routine_id) {
        try {
          const routine = (await loadRoutines()).find((r) => r.id === w.routine_id);
          if (routine) {
            const allSets = structuredClone(w.exercises) as WorkoutExercise[];
            const probe = updatedRoutine(routine, allSets, false, uuid);
            if (!probe.structureChanged && probe.weightChanges.length) await saveRoutine(probe.routine, routine);
            routineInfo = { routine, done: allSets, structureChanged: probe.structureChanged, applied: probe.structureChanged ? null : probe };
          }
        } catch (err) {
          showToast(`Routine not updated: ${errorMessage(err)}`, 'error');
        }
      }
      setSummary({ workout: final, prs, routine: routineInfo });
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
        <div class="stat-row live">
          <div><span>Duration</span><strong class="dur">{formatDuration(totals.durationSec)}</strong></div>
          <div><span>Volume</span><strong>{fmt(totals.volume)} lb</strong></div>
          <div><span>Sets</span><strong>{totals.sets}</strong></div>
        </div>

        {w.exercises.length === 0 && <p class="muted center">Add your first exercise.</p>}

        {w.exercises.map((ex, ei) => {
          const info = exMap.get(ex.exercise_id);
          const prev = previousSets(ex.exercise_id, history);
          let normalNo = 0;
          return (
            <div class="card ex-card" key={`${ex.exercise_id}-${ei}`}>
              <div class="ex-head">
                <h2 class="clip ex-name">{info?.name ?? 'Unknown exercise'}</h2>
                <button class="chip ex-chip" onClick={() => setReplacing(ei)} aria-label={`Replace ${info?.name ?? 'exercise'}`}>⇄ Replace</button>
                <button class="icon-btn small more-btn" aria-label="Exercise options" onClick={() => setMenu(ei)}>⋯</button>
              </div>
              <div class="ex-chips">
                <label class="chip ex-chip">
                  <span aria-hidden="true">⏱</span> Rest {restLabel(ex.rest_sec)}
                  <select aria-label="Rest timer" value={String(ex.rest_sec)} onChange={(e) => exerciseAction(ei, `rest:${e.currentTarget.value}`)}>
                    {REST_OPTIONS.map((s) => <option key={s} value={String(s)}>{restLabel(s)}</option>)}
                  </select>
                </label>
                {ex.note === '' && <button class="chip ex-chip" onClick={() => exerciseAction(ei, 'note')}>✎ Note</button>}
                {info?.primary.length ? <small class="muted">{info.primary.join(', ')}</small> : null}
              </div>
              {ex.note !== '' && (
                <textarea class="ex-note" rows={1} placeholder="Note" value={ex.note.trim() ? ex.note : ''}
                  onInput={(e) => { const v = e.currentTarget.value; update((x) => { x.exercises[ei]!.note = v; return x; }); }} />
              )}
              {ex.sets.some((s) => s.suggested) && <p class="suggest-note">↑ Weight up: you hit the top of your rep range last time.</p>}
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
                      {p ? `${p.weight_lb != null ? fmt(p.weight_lb, 1) : 'BW'} × ${p.reps ?? 0}` : '–'}
                    </button>
                    <input type="number" inputMode="decimal" step="any" aria-label="Weight lb" placeholder={p?.weight_lb != null ? String(p.weight_lb) : p ? 'BW' : ''}
                      class={s.suggested ? 'suggested' : ''} title={s.suggested ? 'Suggested increase: you hit the top of the rep range last time' : undefined}
                      value={s.weight_lb ?? ''} onInput={(e) => { const v = e.currentTarget.value; patchSet(ei, si, { weight_lb: v === '' ? null : Number(v), suggested: false }); }} />
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
      {picking && <ExercisePicker exercises={[...exMap.values()]} onPick={(e) => { known(e); addExercise(e); }} onClose={() => setPicking(false)} />}
      {plates !== undefined && <PlateCalc initial={plates} onClose={() => setPlates(undefined)} />}
      {replacing != null && <ExercisePicker title="Replace with" exercises={[...exMap.values()]} onPick={(e) => { known(e); replaceExercise(replacing, e); }} onClose={() => setReplacing(null)} />}
      {menu != null && w.exercises[menu] && (
        <ActionSheet title={exMap.get(w.exercises[menu]!.exercise_id)?.name} onClose={() => setMenu(null)} actions={[
          { label: 'Replace exercise', onClick: () => setReplacing(menu) },
          { label: 'Add note', onClick: () => exerciseAction(menu, 'note'), disabled: w.exercises[menu]!.note !== '' },
          { label: 'Plate calculator', onClick: () => exerciseAction(menu, 'plates') },
          { label: 'Move up', onClick: () => exerciseAction(menu, 'up'), disabled: menu === 0 },
          { label: 'Move down', onClick: () => exerciseAction(menu, 'down'), disabled: menu === w.exercises.length - 1 },
          { label: 'Remove exercise', onClick: () => exerciseAction(menu, 'remove'), danger: true },
        ]} />
      )}
    </div>
  );
}

interface SummaryData {
  workout: Workout;
  prs: Pr[];
  routine: { routine: Routine; done: WorkoutExercise[]; structureChanged: boolean; applied: RoutineUpdate | null } | null;
}

const prValue = (p: Pr, v: number) => (p.kind === 'e1rm' || p.kind === 'weight' ? `${fmt(v, p.kind === 'weight' ? 1 : 0)} lb` : `${fmt(v)} lb`);

function Summary({ data, exMap, onDone }: { data: SummaryData; exMap: Map<string, Exercise>; onDone: () => void }) {
  const { workout, prs } = data;
  const t = workoutTotals(workout);
  const name = (id: string) => exMap.get(id)?.name ?? 'Exercise';
  const [routineResult, setRoutineResult] = useState<RoutineUpdate | null>(data.routine?.applied ?? null);
  const [deciding, setDeciding] = useState(false);
  const needsChoice = !!data.routine?.structureChanged && !routineResult;

  async function decide(keep: boolean) {
    if (!data.routine) return;
    setDeciding(true);
    try {
      const u = updatedRoutine(data.routine.routine, data.routine.done, keep, uuid);
      if (keep || u.weightChanges.length) await saveRoutine(u.routine, data.routine.routine);
      setRoutineResult(u);
      showToast(keep ? `${data.routine.routine.name} updated` : 'Routine kept as it was', 'ok');
    } catch (err) {
      showToast(errorMessage(err), 'error');
    } finally {
      setDeciding(false);
    }
  }

  async function done() {
    if (needsChoice) await decide(false); // leaving without choosing = keep the routine as it was (weights still carry over)
    onDone();
  }

  const byEx = [...new Set(prs.map((p) => p.exercise_id))];
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

        {needsChoice && data.routine && (
          <div class="card routine-choice">
            <h2>You changed {data.routine.routine.name}</h2>
            <p class="muted tiny">
              Today: {data.routine.done.map((e) => name(e.exercise_id)).join(', ')}.<br />
              Routine: {data.routine.routine.items.map((i) => name(i.exercise_id)).join(', ')}.
            </p>
            <div class="btn-row">
              <button class="btn" disabled={deciding} onClick={() => decide(false)}>Discard changes</button>
              <button class="btn primary" disabled={deciding} onClick={() => decide(true)}>Keep changes</button>
            </div>
            <small class="muted">Either way, any heavier weights you lifted become the routine's new weights.</small>
          </div>
        )}

        {byEx.length > 0 && (
          <div class="card pr-card">
            <h2>🏆 New records</h2>
            {byEx.map((id) => (
              <div class="pr-ex" key={id}>
                <strong>{name(id)}</strong>
                {prs.filter((p) => p.exercise_id === id).map((p) => (
                  <div class="pr-line" key={p.kind}>
                    <span class="muted">{PR_LABELS[p.kind]}</span>
                    <span>
                      {p.before != null ? <><span class="muted">{prValue(p, p.before)} → </span><strong>{prValue(p, p.after)}</strong> <span class="pr-up">+{p.kind === 'weight' ? fmt(p.after - p.before, 1) : fmt(Math.round(p.after) - Math.round(p.before))}</span></>
                        : <><strong>{prValue(p, p.after)}</strong> <span class="muted">first time</span></>}
                    </span>
                  </div>
                ))}
              </div>
            ))}
            <small class="muted">Est. 1-rep max uses the Epley formula: weight × (1 + reps ÷ 30). Warm-ups don't count.</small>
          </div>
        )}

        {routineResult && routineResult.weightChanges.length > 0 && (
          <div class="card">
            <h2>Routine weights updated</h2>
            {routineResult.weightChanges.map((c) => (
              <p class="tiny" key={c.exercise_id}><strong>{name(c.exercise_id)}</strong>: {c.from != null ? `${fmt(c.from, 1)} → ` : ''}{fmt(c.to, 1)} lb</p>
            ))}
          </div>
        )}

        <div class="card">
          <h2>Sets per muscle</h2>
          <MuscleBars counts={setsPerMuscle(workout, exMap)} />
          <small class="muted">Completed working sets (warm-ups not counted), by main muscle.</small>
        </div>
        <div class="card">
          {workout.exercises.map((e, i) => {
            const top = Math.max(0, ...e.sets.filter(isWorkingSet).map((s) => s.weight_lb ?? 0));
            return (
              <p key={`${e.exercise_id}-${i}`}>
                <strong>{name(e.exercise_id)}</strong>{top ? <span class="muted"> · max {fmt(top, 1)} lb</span> : null}<br />
                <span class="muted tiny">{e.sets.filter(isWorkingSet).map((s) => `${s.weight_lb != null ? fmt(s.weight_lb, 1) : 'BW'}×${s.reps}`).join(', ') || 'warm-ups only'}</span>
              </p>
            );
          })}
        </div>
        <button class="btn primary" disabled={deciding} onClick={done}>Done</button>
      </div>
    </div>
  );
}
