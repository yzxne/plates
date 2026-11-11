import { useEffect, useMemo, useState } from 'preact/hooks';
import { SETTINGS_DEFAULTS, SETTINGS_FIELDS, validateSettings, WEEKDAYS, type SettingField } from '../../../shared/schema';
import { api, ApiError, errorMessage } from '../api';
import { IconBack } from '../components/Icons';
import { mergeSettingsBodies, queue } from '../queue';
import { showToast } from '../toast';

type Values = Record<string, string>;

const SETTINGS_KEY = 'settings';

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
      const res = await api<{ settings: Values }>('GET', '/sheet/settings');
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
      const res = await api<{ settings: Values }>('PUT', '/sheet/settings', { settings: v.clean });
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
        <h1>Settings</h1>
      </header>

      {loadError && (
        <div class="card">
          <p class={notReady ? 'muted' : 'error'}>
            {notReady ? 'Connect Google and create the spreadsheet (More → Google connection) before saving settings.' : errorMessage(loadError)}
          </p>
          {!notReady && <button class="btn" onClick={load}>Try again</button>}
        </div>
      )}
      {banner && <div class="card warn" role="alert">{banner}</div>}
      {hasPending && !banner && <div class="card warn">Some changes haven't reached the Sheet yet. Save again or use Retry on the More screen.</div>}

      <form class="card form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        {SETTINGS_FIELDS.filter((f) => f.key !== 'schema_version').map((f) => (
          <Field key={f.key} field={f} value={values[f.key] ?? ''} error={fieldErrors[f.key]} onChange={(v) => set(f.key, v)} />
        ))}
        <button class="btn primary sticky-save" type="submit" disabled={saving || !!loadError || Object.keys(changed).length === 0}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </form>

      <div class="card">
        <h2>Passcode</h2>
        <p class="muted">Change it from your PC: <code>npm run setup-secrets -w backend -- --passcode</code></p>
      </div>
    </section>
  );
}

function Field({ field, value, error, onChange }: { field: SettingField; value: string; error?: string; onChange: (v: string) => void }) {
  const id = `f-${field.key}`;
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
          <input id={id} type="number" inputMode="decimal" step={field.step} min={field.min} max={field.max}
            value={value} onInput={(e) => onChange(e.currentTarget.value)} />
          {field.unit && <span class="unit">{field.unit}</span>}
        </div>
      );
      break;
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
      {control}
      {field.help && <small class="muted">{field.help}</small>}
      {error && <small class="error">{error}</small>}
    </div>
  );
}
