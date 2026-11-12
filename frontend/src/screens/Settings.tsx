import { useEffect, useMemo, useState } from 'preact/hooks';
import { fieldVisible, presetsFor, SETTINGS_DEFAULTS, SETTINGS_FIELDS, validateSettings, WEEKDAYS, type SettingField } from '../../../shared/schema';
import { ApiError, errorMessage } from '../api';
import { loadSettings, saveSettings } from '../settingsStore';
import { IconBack } from '../components/Icons';
import { mergeSettingsBodies, queue } from '../queue';
import { showToast } from '../toast';

type Values = Record<string, string>;

const SETTINGS_KEY = 'settings';

// Fields shown in titled cards; everything else editable goes under Advanced.
const GROUPS: [string, string[]][] = [
  ['Body', ['sex', 'birth_date', 'height_in', 'activity_multiplier']],
  ['Goal & training', ['goal_type', 'goal_rate_lb_per_week', 'protein_g_per_lb', 'fat_min_g', 'checkin_weekday', 'training_days']],
  ['Meals & places', ['breakfast_window', 'lunch_window', 'dinner_window', 'cafeteria_name', 'plate_diameter_in', 'ai_monthly_cap_usd']],
];
const GROUPED = new Set(GROUPS.flatMap(([, keys]) => keys));

function pendingSettings(): Values {
  const p = queue.find(SETTINGS_KEY);
  return ((p?.body as { settings?: Values })?.settings) ?? {};
}

export function Settings({ onBack }: { onBack: () => void }) {
  const [saved, setSaved] = useState<Values | null>(null); // what the Sheet has
  const [values, setValues] = useState<Values>({ ...SETTINGS_DEFAULTS, ...pendingSettings() });
  const [loadError, setLoadError] = useState<ApiError | Error | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoadError(null);
    try {
      const res = { settings: await loadSettings(true) };
      setSaved(res.settings);
      setValues({ ...res.settings, ...pendingSettings() }); // unsent edits stay visible
    } catch (err) {
      setLoadError(err as Error);
    }
  }

  useEffect(() => { void load(); }, []);

  const changed = useMemo(() => {
    const base = saved ?? SETTINGS_DEFAULTS;
    const out: Values = {};
    for (const f of SETTINGS_FIELDS) {
      if (f.type !== 'readonly' && (values[f.key] ?? '') !== (base[f.key] ?? '')) out[f.key] = values[f.key] ?? '';
    }
    return out;
  }, [values, saved]);

  const notReady = loadError instanceof ApiError && ['sheet_not_set_up', 'google_not_connected', 'google_reconnect'].includes(loadError.code);
  const hasPending = Object.keys(pendingSettings()).length > 0;

  function set(key: string, v: string) {
    setValues((prev) => ({ ...prev, [key]: v }));
    setFieldErrors((prev) => { const n = { ...prev }; delete n[key]; return n; });
  }

  async function save() {
    const v = validateSettings(changed);
    if (!v.ok) { setFieldErrors(v.errors); return; }
    setSaving(true);
    setBanner('');
    try {
      const res = { settings: await saveSettings(v.clean) };
      setSaved(res.settings);
      setValues(res.settings);
      const p = queue.find(SETTINGS_KEY);
      if (p) queue.discard(p.id);
      showToast('Saved to your Google Sheet', 'ok');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'invalid_settings') {
        setFieldErrors((err.data.fields as Record<string, string>) ?? {});
      } else {
        queue.add(
          { method: 'PUT', path: '/sheet/settings', body: { settings: v.clean }, label: 'Settings', coalesceKey: SETTINGS_KEY, error: errorMessage(err) },
          mergeSettingsBodies,
        );
        setBanner(`Not saved: ${errorMessage(err)} Your changes are kept here and will retry.`);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <header class="screen-head with-back">
        <button class="icon-btn" aria-label="Back" onClick={onBack}><IconBack /></button>
        <h1>Profile & goals</h1>
      </header>

      {loadError && (
        <div class="card">
          <p class={notReady ? 'muted' : 'error'}>
            {notReady ? 'Connect Google and create the spreadsheet (Settings → Google connection) before saving settings.' : errorMessage(loadError)}
          </p>
          {!notReady && <button class="btn" onClick={load}>Try again</button>}
        </div>
      )}
      {banner && <div class="card warn" role="alert">{banner}</div>}
      {hasPending && !banner && <div class="card warn">Some changes haven't reached the Sheet yet. Save again, or retry from the Settings page.</div>}

      <form class="form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        {GROUPS.map(([title, keys]) => (
          <div class="card" key={title}>
            <h2>{title}</h2>
            {keys.map((k) => SETTINGS_FIELDS.find((f) => f.key === k)).filter((f): f is SettingField => !!f).map((f) => (
              <Field key={f.key} field={f} value={values[f.key] ?? ''} all={values} error={fieldErrors[f.key]} onChange={(v) => set(f.key, v)} />
            ))}
          </div>
        ))}
        <details class="card advanced">
          <summary><h2 class="inline">Advanced</h2> <small class="muted">coaching math, corrections, gestures</small></summary>
          {SETTINGS_FIELDS.filter((f) => f.group === 'advanced' || (!GROUPED.has(f.key) && f.type !== 'hidden' && f.type !== 'readonly' && f.key !== 'schema_version')).map((f) => (
            <Field key={f.key} field={f} value={values[f.key] ?? ''} all={values} error={fieldErrors[f.key]} onChange={(v) => set(f.key, v)} />
          ))}
        </details>
        <p class="muted tiny center">Passcode: change it from your PC with <code>npm run setup-secrets -w backend -- --passcode</code></p>
        {Object.keys(changed).length > 0 && (
          <div class="save-bar">
            <button class="btn primary" type="submit" disabled={saving || !!loadError}>{saving ? 'Saving…' : 'Save changes'}</button>
          </div>
        )}
      </form>
    </section>
  );
}

export function Field({ field, value, error, onChange, all = {} }: {
  field: SettingField; value: string; error?: string; onChange: (v: string) => void; all?: Record<string, string>;
}) {
  const id = `f-${field.key}`;
  if (!fieldVisible(field, all)) return null;
  const presets = presetsFor(field, all);
  const picked = presets.find((p) => Number(p.value) === Number(value) && value !== '');
  let control: preact.JSX.Element;
  switch (field.type) {
    case 'select':
      control = (
        <select id={id} value={value} onChange={(e) => onChange(e.currentTarget.value)}>
          {field.default === '' && <option value="">Not set</option>}
          {field.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
      break;
    case 'number':
      control = (
        <div class="with-unit">
          <input id={id} type="text" inputMode="decimal" step={field.step} min={field.min} max={field.max}
            value={value} onInput={(e) => onChange(e.currentTarget.value)} />
          {field.unit && <span class="unit">{field.unit}</span>}
        </div>
      );
      break;
    case 'text':
      control = <input id={id} type="text" value={value} onInput={(e) => onChange(e.currentTarget.value)} />;
      break;
    case 'window': {
      const [a = '', b = ''] = value.split('-');
      control = (
        <div class="with-unit" role="group" aria-labelledby={`${id}-label`}>
          <input id={id} type="time" value={a} aria-label={`${field.label} start`} onInput={(e) => onChange(`${e.currentTarget.value}-${b}`)} />
          <span class="unit">to</span>
          <input type="time" value={b} aria-label={`${field.label} end`} onInput={(e) => onChange(`${a}-${e.currentTarget.value}`)} />
        </div>
      );
      break;
    }
    case 'date':
      control = <input id={id} type="date" value={value} onInput={(e) => onChange(e.currentTarget.value)} />;
      break;
    case 'days': {
      const selected = new Set(value.split(',').filter(Boolean));
      const toggle = (d: string) => {
        const next = new Set(selected);
        if (next.has(d)) next.delete(d); else next.add(d);
        onChange(WEEKDAYS.filter((w) => next.has(w)).join(','));
      };
      control = (
        <div class="chips" role="group" aria-labelledby={`${id}-label`}>
          {WEEKDAYS.map((d) => (
            <button type="button" key={d} class={`chip ${selected.has(d) ? 'on' : ''}`} aria-pressed={selected.has(d)} onClick={() => toggle(d)}>{d}</button>
          ))}
        </div>
      );
      break;
    }
    default:
      control = <div class="readonly" id={id}>{value}</div>;
  }
  return (
    <div class={`field ${error ? 'has-error' : ''}`}>
      <label id={`${id}-label`} for={field.type === 'days' ? undefined : id}>{field.label}</label>
      {presets.length > 0 && (
        <div class="chips presets" role="group" aria-label={`${field.label} quick picks`}>
          {presets.map((p) => (
            <button type="button" key={p.label + p.value} class={`chip ${picked === p ? 'on' : ''}`} aria-pressed={picked === p} onClick={() => onChange(p.value)}>
              {p.label}{p.label !== p.value && !p.label.startsWith('$') && !/^[d,]+$/.test(p.label) ? <span class="chip-val"> · {p.value}{field.unit ? ` ${field.unit.split('/')[0]!.split(' ')[0]}` : ''}</span> : null}
            </button>
          ))}
        </div>
      )}
      {control}
      {picked?.hint && <small class="hint">{picked.hint}</small>}
      {field.help && <small class="muted">{field.help}</small>}
      {error && <small class="error">{error}</small>}
    </div>
  );
}
