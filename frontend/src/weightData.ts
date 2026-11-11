// Weigh-ins (Weights tab). Trend weight and charts come in Phase 5.
import type { Row } from '../../shared/schema';
import { readTabs, uuid, write } from './foodData';
import { APP_TIMEZONE } from '../../shared/schema';
import { today } from './dates';

export interface WeighIn { id: string; date: string; time: string; weight_lb: number; body_fat_pct: number | null }

let cache: WeighIn[] | null = null;

const rowToWeighIn = (r: Row): WeighIn => ({
  id: String(r.id),
  date: String(r.date),
  time: String(r.time ?? ''),
  weight_lb: Number(r.weight_lb),
  body_fat_pct: r.body_fat_pct === '' || r.body_fat_pct == null ? null : Number(r.body_fat_pct),
});

/** All weigh-ins, newest first. */
export async function loadWeights(force = false): Promise<WeighIn[]> {
  if (cache && !force) return cache;
  const d = await readTabs(['Weights']);
  cache = (d.Weights ?? []).map(rowToWeighIn).filter((w) => w.weight_lb > 0)
    .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  return cache;
}

export function lastWeight(): WeighIn | null {
  return cache?.[0] ?? null;
}

export async function addWeight(weight_lb: number, date = today()): Promise<{ w: WeighIn; ok: boolean }> {
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: APP_TIMEZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
  const w: WeighIn = { id: uuid(), date, time, weight_lb: Math.round(weight_lb * 10) / 10, body_fat_pct: null };
  const ok = await write('/sheet/append', { tab: 'Weights', rows: [{ id: w.id, date, time, weight_lb: w.weight_lb }] }, `Weigh-in ${w.weight_lb} lb`);
  cache = [w, ...(cache ?? [])];
  return { w, ok };
}

export async function deleteWeight(w: WeighIn): Promise<void> {
  await write('/sheet/update', { tab: 'Weights', rows: [{ id: w.id, deleted_at: new Date().toISOString() }] }, `Delete weigh-in ${w.weight_lb} lb`);
  cache = (cache ?? []).filter((x) => x.id !== w.id);
}
