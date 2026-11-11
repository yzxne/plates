// Settings loaded once per session and shared by every screen (meal windows, setup flag, ...).
import { mealForMinutes, SETTINGS_DEFAULTS, type MealName } from '../../shared/schema';
import { api } from './api';
import { chicagoHour } from './dates';

type Values = Record<string, string>;
type Listener = (v: Values) => void;

let values: Values = { ...SETTINGS_DEFAULTS };
let loaded = false;
let loading: Promise<Values> | null = null;
const listeners = new Set<Listener>();

function emit() {
  for (const fn of listeners) fn(values);
}

export function getSettings(): Values {
  return values;
}

export function settingsLoaded(): boolean {
  return loaded;
}

export function subscribeSettings(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function loadSettings(force = false): Promise<Values> {
  if (loaded && !force) return Promise.resolve(values);
  loading ??= api<{ settings: Values }>('GET', '/sheet/settings')
    .then((r) => {
      values = { ...SETTINGS_DEFAULTS, ...r.settings };
      loaded = true;
      emit();
      return values;
    })
    .finally(() => { loading = null; });
  return loading;
}

/** Saves changed settings to the Sheet; throws on failure (callers decide whether to queue). */
export async function saveSettings(patch: Values): Promise<Values> {
  const r = await api<{ settings: Values }>('PUT', '/sheet/settings', { settings: patch });
  values = { ...SETTINGS_DEFAULTS, ...r.settings };
  loaded = true;
  emit();
  return values;
}

/** Applies values locally (e.g. after a queued save) so the app reflects them right away. */
export function setLocalSettings(patch: Values): void {
  values = { ...values, ...patch };
  emit();
}

/** Meal for "now", from the Settings time windows (America/Chicago clock). */
export function mealNow(): MealName {
  return mealForMinutes(Math.floor(chicagoHour() * 60), values);
}
