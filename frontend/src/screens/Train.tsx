import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  bestSet, epley1RM, formatDuration, isWorkingSet, setsPerMuscle, SET_TYPE_LABELS, STARTER_EXERCISES, workoutTotals,
  type Exercise, type PlannedSet, type Routine, type RoutineItem, type SetType, type Workout,
} from '../../../shared/training';
import { getActive } from '../activeWorkout';
import { ApiError, errorMessage } from '../api';
import { BarChart, MuscleBars, type Point } from '../components/Charts';
import { ExercisePicker, NewExercise } from '../components/ExercisePicker';
import { IconBack, IconChevron } from '../components/Icons';
import { shiftDate, today } from '../dates';
import { uuid } from '../foodData';
import { fmt } from '../format';
import { showToast } from '../toast';
import {
  deleteRoutine, deleteWorkout, loadExercises, loadHistory, loadRoutines, saveRoutine, seedStarterExercises,
} from '../trainData';

type View =
  | { kind: 'home' }
  | { kind: 'routine'; id: string }
  | { kind: 'edit'; routine: Routine; isNew: boolean }
  | { kind: 'history' }
  | { kind: 'workout'; id: string }
  | { kind: 'exercises' }
  | { kind: 'exercise'; id: string };

interface Props {
  onStart: (routine?: Routine) => void;
  version: number; // bump after a workout is saved
}

export function Train({ onStart, version }: Props) {
  const [view, setView] = useState<View>({ kind: 'home' });
  const [exercises, setExercises] = useState<Exercise[] | null>(null);
  const [routines, setRoutines] = useState<Routine[] | null>(null);
  const [history, setHistory] = useState<Workout[] | null>(null);
  const [error, setError] = useState<Error | null>(null);

  async function load(force = false) {
    setError(null);
    try {
      const ex = await loadExercises(force);
      const [r, h] = await Promise.all([loadRoutines(), loadHistory(force)]);
      setExercises(ex);
      setRoutines(r);
      setHistory(h);
    } catch (err) {
      setError(err as Error);
    }
  }
  useEffect(() => { void load(version > 0); }, [version]);

  const exMap = useMemo(() => new Map((exercises ?? []).map((e) => [e.id, e])), [exercises]);
  const notReady = error instanceof ApiError && ['sheet_not_set_up', 'google_not_connected', 'google_reconnect'].includes(error.code);

  if (error) {
    return (
      <section>
        <header class="screen-head"><h1>Train</h1></header>
        <div class="card">
          <p class={notReady ? 'muted' : 'error'}>{notReady ? 'Connect Google and create the spreadsheet in More first.' : errorMessage(error)}</p>
          {!notReady && <button class="btn" onClick={() => load(true)}>Try again</button>}
        </div>
      </section>
    );
  }
  if (!exercises || !routines || !history) return <section><header class="screen-head"><h1>Train</h1></header><p class="muted">Loading…</p></section>;

  const home = () => setView({ kind: 'home' });

  switch (view.kind) {
    case 'routine': {
      const r = routines.find((x) => x.id === view.id);
      if (!r) { home(); return null; }
      return <RoutineDetail routine={r} exMap={exMap} history={history} onBack={home} onStart={() => onStart(r)}
        onEdit={() => setView({ kind: 'edit', routine: structuredClone(r), isNew: false })} />;
    }
    case 'edit':
      return <RoutineEditor initial={view.routine} isNew={view.isNew} exercises={exercises} before={routines.find((x) => x.id === view.routine.id)}
        onCancel={() => setView(view.isNew ? { kind: 'home' } : { kind: 'routine', id: view.routine.id })}
        onSaved={async (id) => { await load(); setView(id ? { kind: 'routine', id } : { kind: 'home' }); }}
        onExercisesChanged={() => loadExercises().then(setExercises)} />;
    case 'history':
      return <History history={history} onBack={home} onOpen={(id) => setView({ kind: 'workout', id })} />;
    case 'workout': {
      const w = history.find((x) => x.id === view.id);
      if (!w) { setView({ kind: 'history' }); return null; }
      return <WorkoutDetail workout={w} exMap={exMap} history={history} onBack={() => setView({ kind: 'history' })}
        onDeleted={async () => { await load(); setView({ kind: 'history' }); }} />;
    }
    case 'exercises':
      return <Exercises exercises={exercises} onBack={home} onOpen={(id) => setView({ kind: 'exercise', id })}
        onChanged={() => loadExercises().then(setExercises)} />;
    case 'exercise': {
      const e = exMap.get(view.id);
      if (!e) { setView({ kind: 'exercises' }); return null; }
      return <ExerciseDetail exercise={e} history={history} onBack={() => setView({ kind: 'exercises' })}
        onChanged={() => loadExercises().then(setExercises)} />;
    }
  }

  // ---------- Home ----------
  const weekAgo = shiftDate(today(), -6);
  const thisWeek = history.filter((w) => w.date >= weekAgo);
  const active = getActive();

  return (
    <section>
      <header class="screen-head"><h1>Train</h1></header>

      {exercises.length === 0 && (
        <div class="card">
          <h2>Exercise list</h2>
          <p class="muted">Add a starter list of {STARTER_EXERCISES.length} common exercises to your Sheet? You can edit or add your own any time.</p>
          <button class="btn primary" onClick={async () => {
            try { setExercises([...(await seedStarterExercises())]); showToast('Exercises added', 'ok'); } catch (err) { showToast(errorMessage(err), 'error'); }
          }}>Add starter exercises</button>
        </div>
      )}

      <button class="btn primary mb" disabled={!!active} onClick={() => onStart()}>Start empty workout</button>

      <div class="section-head">
        <h2>Routines</h2>
        <button class="btn link" onClick={() => setView({ kind: 'edit', isNew: true, routine: { id: uuid(), name: '', notes: '', sort_order: routines.length, items: [] } })}>+ New</button>
      </div>
      {routines.length === 0 && <p class="muted">No routines yet. Create one, or start an empty workout.</p>}
      {routines.map((r) => (
        <div class="card routine-card" key={r.id}>
          <button class="routine-main" onClick={() => setView({ kind: 'routine', id: r.id })}>
            <strong>{r.name}</strong>
            <small class="muted clip">{r.items.map((i) => exMap.get(i.exercise_id)?.name ?? '?').join(', ') || 'No exercises'}</small>
          </button>
          <button class="btn" disabled={!!active} onClick={() => onStart(r)}>Start</button>
        </div>
      ))}

      <div class="card">
        <h2>Last 7 days</h2>
        <p class="muted">{thisWeek.length} workout{thisWeek.length === 1 ? '' : 's'} · sets per muscle</p>
        <MuscleBars counts={setsPerMuscle(thisWeek, exMap)} />
      </div>

      <div class="list card">
        <button class="row" onClick={() => setView({ kind: 'history' })}><span>History</span><IconChevron size={18} /></button>
        <button class="row" onClick={() => setView({ kind: 'exercises' })}><span>Exercises</span><IconChevron size={18} /></button>
      </div>
    </section>
  );
}

// ---------- Shared bits ----------

function Back({ title, onBack, right }: { title: string; onBack: () => void; right?: preact.ComponentChildren }) {
  return (
    <header class="screen-head with-back">
      <button class="icon-btn" aria-label="Back" onClick={onBack}><IconBack /></button>
      <h1 class="clip grow">{title}</h1>
      {right}
    </header>
  );
}

const RANGES = [['1M', 30], ['3M', 91], ['1Y', 365], ['All', 100000]] as const;
type Metric = 'volume' | 'reps' | 'duration';

function sessionChart(workouts: Workout[], metric: Metric, days: number): Point[] {
  const from = shiftDate(today(), -days);
  return workouts
    .filter((w) => w.date >= from)
    .sort((a, b) => a.start_time.localeCompare(b.start_time))
    .map((w) => {
      const t = workoutTotals(w);
      const value = metric === 'volume' ? t.volume : metric === 'reps' ? t.reps : Math.round(t.durationSec / 60);
      return { label: w.date.slice(5).replace('-', '/'), value };
    });
}

// ---------- Routine detail ----------

function RoutineDetail({ routine, exMap, history, onBack, onStart, onEdit }: {
  routine: Routine; exMap: Map<string, Exercise>; history: Workout[]; onBack: () => void; onStart: () => void; onEdit: () => void;
}) {
  const [metric, setMetric] = useState<Metric>('volume');
  const [range, setRange] = useState(91);
  const sessions = history.filter((w) => w.routine_id === routine.id);
  const units: Record<Metric, string> = { volume: 'lb', reps: 'reps', duration: 'min' };
  return (
    <section>
      <Back title={routine.name} onBack={onBack} right={<button class="btn link" onClick={onEdit}>Edit</button>} />
      <button class="btn primary mb" disabled={!!getActive()} onClick={onStart}>Start routine</button>

      <div class="card">
        <div class="seg mb">
          {(['volume', 'reps', 'duration'] as Metric[]).map((m) => (
            <button key={m} class={metric === m ? 'on' : ''} onClick={() => setMetric(m)}>{m[0]!.toUpperCase() + m.slice(1)}</button>
          ))}
        </div>
        <BarChart points={sessionChart(sessions, metric, range)} unit={units[metric]} />
        <div class="chips">
          {RANGES.map(([label, d]) => <button key={label} class={`chip ${range === d ? 'on' : ''}`} onClick={() => setRange(d)}>{label}</button>)}
        </div>
      </div>

      {routine.items.map((it) => (
        <div class="card" key={it.id}>
          <h2>{exMap.get(it.exercise_id)?.name ?? 'Unknown exercise'}</h2>
          <small class="muted">Rest {Math.floor(it.rest_sec / 60)}:{String(it.rest_sec % 60).padStart(2, '0')}{it.notes ? ` · ${it.notes}` : ''}</small>
          <ul class="plain">
            {it.sets.map((s, i) => (
              <li key={i}>{SET_TYPE_LABELS[s.type]} · {s.weight_lb != null ? `${fmt(s.weight_lb, 1)} lb` : '– lb'} · {repText(s)}</li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

const repText = (s: PlannedSet) =>
  s.rep_min == null && s.rep_max == null ? '– reps'
    : s.rep_min != null && s.rep_max != null && s.rep_min !== s.rep_max ? `${s.rep_min}–${s.rep_max} reps`
      : `${s.rep_min ?? s.rep_max} reps`;

// ---------- Routine editor ----------

function RoutineEditor({ initial, isNew, before, exercises, onCancel, onSaved, onExercisesChanged }: {
  initial: Routine; isNew: boolean; before?: Routine; exercises: Exercise[];
  onCancel: () => void; onSaved: (id: string | null) => void; onExercisesChanged: () => void;
}) {
  const [r, setR] = useState<Routine>(initial);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const exMap = new Map(exercises.map((e) => [e.id, e]));
  const edit = (fn: (x: Routine) => void) => setR((cur) => { const x = structuredClone(cur); fn(x); return x; });
  const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v));

  async function save() {
    if (!r.name.trim()) { showToast('Name the routine', 'error'); return; }
    setBusy(true);
    try {
      await saveRoutine({ ...r, name: r.name.trim() }, isNew ? undefined : before);
      showToast('Routine saved', 'ok');
      onSaved(r.id);
    } catch (err) {
      showToast(errorMessage(err), 'error');
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete routine "${r.name}"? Past workouts stay in your history.`)) return;
    setBusy(true);
    try {
      await deleteRoutine(before ?? r);
      onSaved(null);
    } catch (err) {
      showToast(errorMessage(err), 'error');
      setBusy(false);
    }
  }

  const addItem = (e: Exercise) => {
    setPicking(false);
    onExercisesChanged();
    edit((x) => {
      const item: RoutineItem = { id: uuid(), exercise_id: e.id, position: x.items.length, rest_sec: e.rest_sec, notes: '',
        sets: [1, 2, 3].map(() => ({ type: 'N' as SetType, weight_lb: null, rep_min: 8, rep_max: 12 })) };
      x.items.push(item);
    });
  };

  return (
    <section>
      <Back title={isNew ? 'New routine' : 'Edit routine'} onBack={onCancel} right={<button class="btn link" disabled={busy} onClick={save}>Save</button>} />
      <div class="card form">
        <div class="field"><label for="r-name">Name</label><input id="r-name" value={r.name} placeholder="e.g. Push A" onInput={(e) => { const v = e.currentTarget.value; edit((x) => { x.name = v; }); }} /></div>
        <div class="field"><label for="r-notes">Notes (optional)</label><input id="r-notes" value={r.notes} onInput={(e) => { const v = e.currentTarget.value; edit((x) => { x.notes = v; }); }} /></div>
      </div>

      {r.items.map((it, ii) => (
        <div class="card" key={it.id}>
          <div class="ex-head">
            <h2 class="clip grow">{exMap.get(it.exercise_id)?.name ?? 'Unknown exercise'}</h2>
            <button class="icon-btn small" aria-label="Move up" disabled={ii === 0} onClick={() => edit((x) => { const [m] = x.items.splice(ii, 1); x.items.splice(ii - 1, 0, m!); })}>↑</button>
            <button class="icon-btn small" aria-label="Move down" disabled={ii === r.items.length - 1} onClick={() => edit((x) => { const [m] = x.items.splice(ii, 1); x.items.splice(ii + 1, 0, m!); })}>↓</button>
          </div>
          <div class="grid2">
            <div class="field"><label>Rest (sec)</label><input type="number" inputMode="numeric" value={it.rest_sec} onInput={(e) => { const v = Number(e.currentTarget.value) || 0; edit((x) => { x.items[ii]!.rest_sec = v; }); }} /></div>
            <div class="field"><label>Note</label><input value={it.notes} onInput={(e) => { const v = e.currentTarget.value; edit((x) => { x.items[ii]!.notes = v; }); }} /></div>
          </div>
          <div class="plan-grid plan-head"><span>Type</span><span>lb</span><span>Min reps</span><span>Max reps</span><span /></div>
          {it.sets.map((s, si) => (
            <div class="plan-grid" key={si}>
              <select value={s.type} aria-label="Set type" onChange={(e) => { const v = e.currentTarget.value as SetType; edit((x) => { x.items[ii]!.sets[si]!.type = v; }); }}>
                <option value="W">W</option><option value="N">N</option><option value="F">F</option>
              </select>
              <input type="number" inputMode="decimal" step="any" aria-label="Target weight" value={s.weight_lb ?? ''} onInput={(e) => { const v = numOrNull(e.currentTarget.value); edit((x) => { x.items[ii]!.sets[si]!.weight_lb = v; }); }} />
              <input type="number" inputMode="numeric" aria-label="Min reps" value={s.rep_min ?? ''} onInput={(e) => { const v = numOrNull(e.currentTarget.value); edit((x) => { x.items[ii]!.sets[si]!.rep_min = v; }); }} />
              <input type="number" inputMode="numeric" aria-label="Max reps" value={s.rep_max ?? ''} onInput={(e) => { const v = numOrNull(e.currentTarget.value); edit((x) => { x.items[ii]!.sets[si]!.rep_max = v; }); }} />
              <button class="icon-btn small" aria-label="Remove set" onClick={() => edit((x) => { x.items[ii]!.sets.splice(si, 1); })}>×</button>
            </div>
          ))}
          <small class="muted">W = warm-up (not counted in volume) · N = normal · F = to failure</small>
          <div class="btn-row">
            <button class="btn" onClick={() => edit((x) => { const last = x.items[ii]!.sets.at(-1); x.items[ii]!.sets.push(last ? { ...last } : { type: 'N', weight_lb: null, rep_min: 8, rep_max: 12 }); })}>+ Set</button>
            <button class="btn danger" onClick={() => edit((x) => { x.items.splice(ii, 1); })}>Remove exercise</button>
          </div>
        </div>
      ))}

      <button class="btn primary mb" onClick={() => setPicking(true)}>+ Add exercise</button>
      <button class="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save routine'}</button>
      {!isNew && <button class="btn link danger center" disabled={busy} onClick={remove}>Delete routine</button>}
      {picking && <ExercisePicker exercises={exercises} onPick={addItem} onClose={() => setPicking(false)} />}
    </section>
  );
}

// ---------- History ----------

function History({ history, onBack, onOpen }: { history: Workout[]; onBack: () => void; onOpen: (id: string) => void }) {
  return (
    <section>
      <Back title="History" onBack={onBack} />
      {history.length === 0 && <p class="muted">No workouts yet.</p>}
      <div class="list card">
        {history.map((w) => {
          const t = workoutTotals(w);
          return (
            <button class="row" key={w.id} onClick={() => onOpen(w.id)}>
              <span class="row-text">
                <span>{w.name}</span>
                <small class="muted">{new Date(`${w.date}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' })} · {formatDuration(t.durationSec)} · {fmt(t.volume)} lb · {t.sets} sets</small>
              </span>
              <IconChevron size={18} />
            </button>
          );
        })}
      </div>
    </section>
  );
}

function WorkoutDetail({ workout, exMap, history, onBack, onDeleted }: {
  workout: Workout; exMap: Map<string, Exercise>; history: Workout[]; onBack: () => void; onDeleted: () => void;
}) {
  const t = workoutTotals(workout);
  async function remove() {
    if (!confirm('Delete this workout from your history?')) return;
    try { await deleteWorkout(workout); onDeleted(); } catch (err) { showToast(errorMessage(err), 'error'); }
  }
  void history;
  return (
    <section>
      <Back title={workout.name} onBack={onBack} />
      <p class="muted">{workout.date} · {new Date(workout.start_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</p>
      <div class="stat-row">
        <div><strong>{formatDuration(t.durationSec)}</strong><span>Duration</span></div>
        <div><strong>{fmt(t.volume)}</strong><span>Volume lb</span></div>
        <div><strong>{t.sets}</strong><span>Sets</span></div>
      </div>
      {workout.exercises.map((e, i) => (
        <div class="card" key={i}>
          <h2>{exMap.get(e.exercise_id)?.name ?? 'Unknown exercise'}</h2>
          {e.note && <p class="muted">{e.note}</p>}
          <ul class="plain">
            {e.sets.map((s, si) => (
              <li key={si}>{s.type === 'N' ? `Set ${si + 1}` : SET_TYPE_LABELS[s.type]}: {fmt(s.weight_lb ?? 0, 1)} lb × {s.reps ?? 0}
                {isWorkingSet(s) && s.weight_lb && s.reps ? <span class="muted"> · est. 1RM {fmt(epley1RM(s.weight_lb, s.reps))}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
      <div class="card">
        <h2>Sets per muscle</h2>
        <MuscleBars counts={setsPerMuscle(workout, exMap)} />
      </div>
      <button class="btn link danger center" onClick={remove}>Delete workout</button>
    </section>
  );
}

// ---------- Exercises ----------

function Exercises({ exercises, onBack, onOpen, onChanged }: { exercises: Exercise[]; onBack: () => void; onOpen: (id: string) => void; onChanged: () => void }) {
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const shown = exercises.filter((e) => e.name.toLowerCase().includes(q.toLowerCase().trim()));
  if (creating) {
    return (
      <section>
        <Back title="New exercise" onBack={() => setCreating(false)} />
        <NewExercise initialName={q} onSaved={() => { setCreating(false); onChanged(); }} onCancel={() => setCreating(false)} />
      </section>
    );
  }
  return (
    <section>
      <Back title="Exercises" onBack={onBack} right={<button class="btn link" onClick={() => setCreating(true)}>+ New</button>} />
      <input type="search" placeholder="Search" value={q} onInput={(e) => setQ(e.currentTarget.value)} class="mb" />
      <div class="list card">
        {shown.map((e) => (
          <button class="row" key={e.id} onClick={() => onOpen(e.id)}>
            <span class="row-text"><span>{e.name}</span><small class="muted">{[e.primary.join(', '), e.equipment].filter(Boolean).join(' · ')}</small></span>
            <IconChevron size={18} />
          </button>
        ))}
      </div>
    </section>
  );
}

function ExerciseDetail({ exercise, history, onBack, onChanged }: { exercise: Exercise; history: Workout[]; onBack: () => void; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [range, setRange] = useState(365);
  const best = bestSet(exercise.id, history);
  const sessions = history
    .filter((w) => w.exercises.some((e) => e.exercise_id === exercise.id))
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
  const from = shiftDate(today(), -range);
  const points: Point[] = sessions.filter((w) => w.date >= from).map((w) => {
    const b = bestSet(exercise.id, [w]);
    return { label: w.date.slice(5).replace('-', '/'), value: b ? Math.round(b.e1rm) : 0 };
  });

  if (editing) {
    return (
      <section>
        <Back title="Edit exercise" onBack={() => setEditing(false)} />
        <NewExercise existing={exercise} onSaved={() => { setEditing(false); onChanged(); }} onCancel={() => setEditing(false)} />
      </section>
    );
  }
  return (
    <section>
      <Back title={exercise.name} onBack={onBack} right={<button class="btn link" onClick={() => setEditing(true)}>Edit</button>} />
      <p class="muted">{[exercise.primary.join(', '), exercise.secondary.length ? `also ${exercise.secondary.join(', ')}` : '', exercise.equipment].filter(Boolean).join(' · ')}</p>
      <div class="card">
        <h2>Best set</h2>
        {best ? <p><strong>{fmt(best.weight_lb, 1)} lb × {best.reps}</strong> <span class="muted">· est. 1RM {fmt(best.e1rm)} lb · {best.date}</span></p> : <p class="muted">No working sets logged yet.</p>}
        <small class="muted">Estimated 1RM = weight × (1 + reps ÷ 30) (Epley formula).</small>
      </div>
      <div class="card">
        <h2>Estimated 1RM per session</h2>
        <BarChart points={points} unit="lb" />
        <div class="chips">
          {RANGES.map(([label, d]) => <button key={label} class={`chip ${range === d ? 'on' : ''}`} onClick={() => setRange(d)}>{label}</button>)}
        </div>
      </div>
      <div class="card">
        <h2>History</h2>
        {sessions.length === 0 && <p class="muted">Not logged yet.</p>}
        {[...sessions].reverse().slice(0, 30).map((w) => (
          <p key={w.id}>
            <span class="muted">{w.date}</span>{' '}
            {w.exercises.filter((e) => e.exercise_id === exercise.id).flatMap((e) => e.sets.filter(isWorkingSet)).map((s) => `${fmt(s.weight_lb ?? 0, 1)}×${s.reps}`).join(', ')}
          </p>
        ))}
      </div>
    </section>
  );
}
