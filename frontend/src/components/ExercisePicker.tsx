import { useMemo, useState } from 'preact/hooks';
import { EXERCISE_LIBRARY } from '../../../shared/exerciseLibrary';
import { matchExercise } from '../../../shared/importers';
import { EQUIPMENT, MUSCLES, type Exercise } from '../../../shared/training';
import { errorMessage } from '../api';
import { uuid } from '../foodData';
import { saveExercise } from '../trainData';
import { showToast } from '../toast';
import { IconBack } from './Icons';

interface Props {
  exercises: Exercise[];
  onPick: (e: Exercise) => void;
  onClose: () => void;
  title?: string;
}

/** Full-screen exercise chooser with search, muscle filter and "create exercise". */
export function ExercisePicker({ exercises, onPick, onClose, title = 'Add exercise' }: Props) {
  const [q, setQ] = useState('');
  const [muscle, setMuscle] = useState('');
  const [creating, setCreating] = useState(false);

  const [adding, setAdding] = useState('');
  const fits = (e: Omit<Exercise, 'id'>) => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return (!muscle || e.primary.includes(muscle) || e.secondary.includes(muscle))
      && words.every((w) => `${e.name} ${e.equipment}`.toLowerCase().includes(w));
  };
  const shown = useMemo(() => exercises.filter(fits), [exercises, q, muscle]);
  // Library lifts you don't have yet (same name, or the same lift with the same equipment, counts as having it).
  const more = useMemo(() => EXERCISE_LIBRARY.filter((l) => !matchExercise(l.name, exercises) && fits(l)), [exercises, q, muscle]);

  async function pickLibrary(l: Omit<Exercise, 'id'>) {
    setAdding(l.name);
    try {
      const e: Exercise = { ...l, id: uuid() };
      await saveExercise(e, true);
      onPick(e);
    } catch (err) {
      showToast(errorMessage(err), 'error');
      setAdding('');
    }
  }

  return (
    <div class="overlay picker" role="dialog" aria-modal="true" aria-label={title}>
      <header class="overlay-head">
        <button class="icon-btn" aria-label="Back" onClick={onClose}><IconBack /></button>
        <div class="overlay-title"><strong>{title}</strong></div>
        <button class="btn link" onClick={() => setCreating(true)}>New</button>
      </header>
      <div class="overlay-body">
        {creating ? (
          <NewExercise initialName={q} onSaved={(e) => { setCreating(false); onPick(e); }} onCancel={() => setCreating(false)} />
        ) : (
          <>
            <input type="search" placeholder="Search exercises" value={q} onInput={(e) => setQ(e.currentTarget.value)} class="mb" />
            <div class="chips scroll-x mb">
              <button class={`chip ${muscle === '' ? 'on' : ''}`} onClick={() => setMuscle('')}>All</button>
              {MUSCLES.map((m) => <button key={m} class={`chip ${muscle === m ? 'on' : ''}`} onClick={() => setMuscle(m)}>{m}</button>)}
            </div>
            {shown.length === 0 && more.length === 0 && <p class="muted">No match. Tap <strong>New</strong> to create it.</p>}
            {shown.length > 0 && more.length > 0 && <h3>Your exercises</h3>}
            <div class="list card">
              {shown.map((e) => (
                <button class="row" key={e.id} onClick={() => onPick(e)}>
                  <span class="row-text"><span>{e.name}</span><small class="muted">{[e.primary.join(', '), e.equipment].filter(Boolean).join(' · ')}</small></span>
                </button>
              ))}
            </div>
            {more.length > 0 && (
              <>
                <h3>More exercises</h3>
                <div class="list card">
                  {more.slice(0, q || muscle ? 60 : 200).map((l) => (
                    <button class="row" key={l.name} disabled={!!adding} onClick={() => pickLibrary(l)}>
                      <span class="row-text"><span>{l.name}</span><small class="muted">{[l.primary.join(', '), l.equipment].filter(Boolean).join(' · ')}</small></span>
                      <span class="plus-chip" aria-hidden="true">{adding === l.name ? '…' : '+'}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function NewExercise({ initialName = '', existing, onSaved, onCancel }: { initialName?: string; existing?: Exercise; onSaved: (e: Exercise) => void; onCancel: () => void }) {
  const [name, setName] = useState(existing?.name ?? initialName);
  const [primary, setPrimary] = useState(existing?.primary[0] ?? 'Chest');
  const [secondary, setSecondary] = useState<string[]>(existing?.secondary ?? []);
  const [equipment, setEquipment] = useState(existing?.equipment ?? 'Barbell');
  const [rest, setRest] = useState(String(existing?.rest_sec ?? 90));
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!name.trim()) { showToast('Give it a name', 'error'); return; }
    const e: Exercise = {
      id: existing?.id ?? uuid(), name: name.trim(), primary: [primary], secondary: secondary.filter((m) => m !== primary),
      equipment, rest_sec: Math.max(0, Math.round(Number(rest) || 90)), notes: existing?.notes ?? '',
    };
    setBusy(true);
    try {
      await saveExercise(e, !existing);
      onSaved(e);
    } catch (err) {
      showToast(errorMessage(err), 'error');
      setBusy(false);
    }
  }

  return (
    <div class="card form">
      <div class="field"><label for="ex-name">Name</label><input id="ex-name" value={name} onInput={(e) => setName(e.currentTarget.value)} /></div>
      <div class="field"><label for="ex-primary">Main muscle</label>
        <select id="ex-primary" value={primary} onChange={(e) => setPrimary(e.currentTarget.value)}>
          {MUSCLES.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
      <div class="field"><label>Also works (optional)</label>
        <div class="chips">
          {MUSCLES.filter((m) => m !== primary).map((m) => (
            <button type="button" key={m} class={`chip ${secondary.includes(m) ? 'on' : ''}`}
              onClick={() => setSecondary((s) => (s.includes(m) ? s.filter((x) => x !== m) : [...s, m]))}>{m}</button>
          ))}
        </div>
      </div>
      <div class="field"><label for="ex-eq">Equipment</label>
        <select id="ex-eq" value={equipment} onChange={(e) => setEquipment(e.currentTarget.value)}>
          {EQUIPMENT.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
      <div class="field"><label for="ex-rest">Default rest</label>
        <div class="with-unit"><input id="ex-rest" type="text" inputMode="numeric" value={rest} onInput={(e) => setRest(e.currentTarget.value)} /><span class="unit">sec</span></div>
      </div>
      <button class="btn primary" disabled={busy} onClick={save}>{existing ? 'Save' : 'Create exercise'}</button>
      <button class="btn link center" onClick={onCancel}>Cancel</button>
    </div>
  );
}
