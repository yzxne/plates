import { useState } from 'preact/hooks';
import { SETTINGS_FIELDS, validateSettings } from '../../../shared/schema';
import { errorMessage } from '../api';
import { ConnectionCard, type Status } from '../components/ConnectionCard';
import { getSettings, loadSettings, saveSettings } from '../settingsStore';
import { showToast } from '../toast';
import { addWeight } from '../weightData';
import { Field } from './Settings';

const STEPS: { title: string; intro: string; keys: string[]; weight?: boolean }[] = [
  { title: 'About you', intro: 'Used for your starting calorie estimate.', keys: ['sex', 'birth_date', 'height_in', 'activity_multiplier'], weight: true },
  { title: 'Your goal', intro: 'You can change these any time.', keys: ['goal_type', 'goal_rate_lb_per_week', 'protein_g_per_lb', 'fat_min_g'] },
  { title: 'Your week', intro: 'Meal times decide where food goes automatically.', keys: ['training_days', 'checkin_weekday', 'breakfast_window', 'lunch_window', 'dinner_window'] },
  { title: 'Extras', intro: 'For AI estimates later.', keys: ['cafeteria_name', 'plate_diameter_in'] },
];

/** First-run setup (brief v2 §5). Shown until setup_complete is set. */
export function SetupWizard({ needsConnection, onDone }: { needsConnection: boolean; onDone: () => void }) {
  const [connected, setConnected] = useState(!needsConnection);
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<Record<string, string>>({ ...getSettings() });
  const [weight, setWeight] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const fields = new Map(SETTINGS_FIELDS.map((f) => [f.key, f]));

  if (!connected) {
    return (
      <div class="overlay" role="dialog" aria-modal="true" aria-label="Setup">
        <div class="overlay-body">
          <h1>Welcome to Plates</h1>
          <p class="muted">First, connect Google. Plates keeps everything in a spreadsheet in your own Drive.</p>
          <ConnectionCard onStatus={(s: Status | null) => {
            if (s?.google.connected && s.sheet.set_up && s.sheet.ok) {
              void loadSettings(true).then((v) => { setValues({ ...v }); setConnected(true); });
            }
          }} />
        </div>
      </div>
    );
  }

  const s = STEPS[step]!;
  const last = step === STEPS.length - 1;

  async function next() {
    const patch = Object.fromEntries(s.keys.map((k) => [k, values[k] ?? '']));
    const v = validateSettings(patch);
    if (!v.ok) { setErrors(v.errors); return; }
    if (s.weight && weight && !(Number(weight) > 50 && Number(weight) < 800)) { setErrors({ weight: 'Enter your weight in lb' }); return; }
    setBusy(true);
    try {
      await saveSettings(last ? { ...v.clean, setup_complete: 'true' } : v.clean);
      if (s.weight && weight) await addWeight(Number(weight));
      if (last) { showToast('All set', 'ok'); onDone(); } else setStep(step + 1);
    } catch (err) {
      showToast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function skip() {
    if (!confirm('Skip setup? Defaults will be used; change anything later in Settings (gear icon on Today).')) return;
    try { await saveSettings({ setup_complete: 'true' }); onDone(); } catch (err) { showToast(errorMessage(err), 'error'); }
  }

  return (
    <div class="overlay" role="dialog" aria-modal="true" aria-label="Setup">
      <div class="overlay-body">
        <p class="muted">Step {step + 1} of {STEPS.length}</p>
        <h1>{s.title}</h1>
        <p class="muted">{s.intro}</p>
        <div class="card form">
          {s.keys.map((k) => (
            <Field key={k} field={fields.get(k)!} value={values[k] ?? ''} all={values} error={errors[k]}
              onChange={(v) => { setValues((x) => ({ ...x, [k]: v })); setErrors((e) => { const n = { ...e }; delete n[k]; return n; }); }} />
          ))}
          {s.weight && (
            <div class={`field ${errors.weight ? 'has-error' : ''}`}>
              <label for="wiz-weight">Current weight (optional)</label>
              <div class="with-unit"><input id="wiz-weight" type="text" inputMode="decimal" step="0.1" value={weight} onInput={(e) => setWeight(e.currentTarget.value)} /><span class="unit">lb</span></div>
              {errors.weight && <small class="error">{errors.weight}</small>}
            </div>
          )}
        </div>
        <button class="btn primary" disabled={busy} onClick={next}>{busy ? 'Saving…' : last ? 'Finish' : 'Next'}</button>
        <div class="btn-row">
          {step > 0 && <button class="btn link" onClick={() => setStep(step - 1)}>Back</button>}
          <button class="btn link" onClick={skip}>Skip setup</button>
        </div>
      </div>
    </div>
  );
}
