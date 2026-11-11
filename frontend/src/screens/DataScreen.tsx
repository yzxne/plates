// Settings → Import & export (brief Phase 7).
import { useState } from 'preact/hooks';
import { addDays } from '../../../shared/coaching';
import { errorMessage } from '../api';
import { IconBack } from '../components/Icons';
import { today } from '../dates';
import { exportWeekly, exportXlsx } from '../exportData';
import { weekStart } from '../foodData';
import { applyPlan, buildPlan, planIsEmpty, type ImportPlan } from '../importData';
import { showToast } from '../toast';

const fmtDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const n = (x: number) => x.toLocaleString('en-US');

export function DataScreen({ onBack }: { onBack: () => void }) {
  const [busy, setBusy] = useState('');
  const [week, setWeek] = useState(() => addDays(weekStart(today()), -7)); // last full week
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [done, setDone] = useState('');
  const [error, setError] = useState('');

  async function run(label: string, fn: (p: (m: string) => void) => Promise<void>) {
    setError('');
    setBusy(label);
    try {
      await fn(setBusy);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy('');
    }
  }

  async function pick(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';
    if (!files.length) return;
    setPlan(null);
    setDone('');
    await run('Reading files…', async (p) => setPlan(await buildPlan(files, p)));
  }

  async function confirmImport() {
    if (!plan) return;
    await run('Importing…', async (p) => {
      await applyPlan(plan, p);
      const parts = [
        plan.entries.length && `${n(plan.entries.length)} food entries`,
        plan.workouts.length && `${n(plan.workouts.length)} workouts`,
        plan.weights.length && `${n(plan.weights.length)} weigh-ins`,
      ].filter(Boolean);
      setDone(`Imported ${parts.join(', ')}.`);
      setPlan(null);
      showToast('Import finished', 'info');
    });
  }

  const thisWeek = weekStart(today());

  return (
    <section>
      <header class="screen-head with-back">
        <button class="icon-btn" aria-label="Back" onClick={onBack}><IconBack /></button>
        <h1>Import & export</h1>
      </header>
      {error && <p class="error" role="alert">{error}</p>}
      {busy && <p class="muted" role="status" aria-live="polite">{busy}</p>}

      <div class="card">
        <h2>Export</h2>
        <p class="muted tiny">A copy of all your data as an Excel file. Good as a backup or to share. Your Google Sheet stays the main copy.</p>
        <button class="btn primary" disabled={!!busy} onClick={() => run('Exporting…', exportXlsx)}>Export to Excel (.xlsx)</button>
        <p class="muted tiny mt">Weekly summary for Obsidian (Markdown):</p>
        <div class="btn-row">
          <button class="btn" aria-label="Previous week" onClick={() => setWeek(addDays(week, -7))}>‹</button>
          <span class="center" style="flex:3;align-self:center">{fmtDate(week)} – {fmtDate(addDays(week, 6))}</span>
          <button class="btn" aria-label="Next week" disabled={week >= thisWeek} onClick={() => setWeek(addDays(week, 7))}>›</button>
        </div>
        <button class="btn" style="width:100%" disabled={!!busy} onClick={() => run('Building summary…', () => exportWeekly(week))}>Export weekly summary (.md)</button>
      </div>

      <div class="card">
        <h2>Import</h2>
        <p class="muted tiny">
          Choose your <strong>Hevy</strong> export (<code>workout_data.csv</code> and/or <code>measurement_data.csv</code>) and/or
          your <strong>Cal AI</strong> report (PDF). Files are read on this device. You'll see what will be added before anything is saved.
        </p>
        <label class={`btn${busy ? ' disabled' : ''}`} style="width:100%">
          Choose files
          <input type="file" accept=".csv,.pdf,text/csv,application/pdf" multiple hidden onChange={pick} />
        </label>
        {done && <p class="mt" role="status">{done}</p>}
      </div>

      {plan && <PlanPreview plan={plan} busy={!!busy} onConfirm={confirmImport} onCancel={() => setPlan(null)} />}
    </section>
  );
}

function PlanPreview({ plan, busy, onConfirm, onCancel }: { plan: ImportPlan; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  const empty = planIsEmpty(plan);
  const matched = Object.entries(plan.matched);
  return (
    <div class="card">
      <h2>Preview</h2>
      <p class="muted tiny">{plan.files.map((f) => f.name).join(', ')}</p>
      {plan.warnings.length > 0 && <ul class="warn-list">{plan.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}

      {(plan.entries.length > 0 || plan.skippedEntries > 0 || plan.skippedDays.length > 0) && (
        <div class="mt">
          <strong>Food history (Cal AI)</strong>
          {plan.entries.length > 0 && plan.foodRange && (
            <p class="tiny">{n(plan.entries.length)} entries over {n(plan.foodDays)} days, {fmtDate(plan.foodRange[0])} – {fmtDate(plan.foodRange[1])}.
              Saved with their calories and macros (no gram amounts) and counted as complete days for coaching.</p>
          )}
          {plan.skippedEntries > 0 && <p class="muted tiny">{n(plan.skippedEntries)} already imported, skipped.</p>}
          {plan.skippedDays.length > 0 && <p class="muted tiny">{plan.skippedDays.length} day(s) you already logged in Plates are left alone ({plan.skippedDays.slice(0, 3).map(fmtDate).join(', ')}).</p>}
          {plan.exercisesInReport > 0 && <p class="muted tiny">{plan.exercisesInReport} exercise entries in the report are not imported (use Hevy for workouts).</p>}
        </div>
      )}

      {(plan.workouts.length > 0 || plan.skippedWorkouts > 0) && (
        <div class="mt">
          <strong>Workouts (Hevy)</strong>
          {plan.workouts.length > 0 && (
            <p class="tiny">{n(plan.workouts.length)} workouts, {n(plan.sets)} sets, {fmtDate(plan.workouts[plan.workouts.length - 1]!.date)} – {fmtDate(plan.workouts[0]!.date)}.</p>
          )}
          {plan.skippedWorkouts > 0 && <p class="muted tiny">{plan.skippedWorkouts} already in Plates, skipped.</p>}
          {matched.length > 0 && plan.workouts.length > 0 && (
            <details class="tiny"><summary>{matched.length} exercises matched to ones you have</summary>
              <ul>{matched.map(([from, to]) => <li key={from}>{from} → {to}</li>)}</ul>
            </details>
          )}
          {plan.newExercises.length > 0 && (
            <details class="tiny"><summary>{plan.newExercises.length} new exercises will be added</summary>
              <p class="muted">Muscle groups are best guesses; edit them any time in Train.</p>
              <ul>{plan.newExercises.map((e) => <li key={e.id}>{e.name} <span class="muted">· {e.primary.join(', ') || 'muscle unknown'}</span></li>)}</ul>
            </details>
          )}
        </div>
      )}

      {(plan.weights.length > 0 || plan.skippedWeights > 0) && (
        <div class="mt">
          <strong>Weigh-ins</strong>
          {plan.weights.length > 0 && <p class="tiny">{plan.weights.length} weigh-ins, {fmtDate(plan.weights[0]!.date)} – {fmtDate(plan.weights[plan.weights.length - 1]!.date)} (one per day).</p>}
          {plan.skippedWeights > 0 && <p class="muted tiny">{plan.skippedWeights} on days that already have a weigh-in, skipped.</p>}
        </div>
      )}

      {empty
        ? <p class="mt">Nothing new to import.</p>
        : <p class="muted tiny mt">Importing writes to your Google Sheet. If it stops part-way, run it again; anything already saved is skipped.</p>}
      <div class="btn-row mt">
        <button class="btn" onClick={onCancel} disabled={busy}>Cancel</button>
        {!empty && <button class="btn primary" onClick={onConfirm} disabled={busy}>Import</button>}
      </div>
    </div>
  );
}
