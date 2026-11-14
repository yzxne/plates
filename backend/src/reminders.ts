// Weigh-in reminder: a cron runs every 15 minutes; at your chosen time (Central), if there's no weigh-in for today
// yet, every subscribed device gets a "Time to weigh in" push. At most once per day.
import { chicagoDate } from '../../shared/schema';
import type { Env } from './env';
import { HttpError } from './http';
import { sendToAll } from './push';

const KEY = 'remind:weigh';
const SENT_KEY = 'remind:weigh:sent';

export interface WeighReminder { on: boolean; time: string } // time = "HH:MM", 24 h, Central
export const DEFAULT_REMINDER: WeighReminder = { on: false, time: '07:30' };

export async function getWeighReminder(env: Env): Promise<WeighReminder> {
  try { return { ...DEFAULT_REMINDER, ...(JSON.parse((await env.PLATES_KV.get(KEY)) ?? '{}') as Partial<WeighReminder>) }; } catch { return DEFAULT_REMINDER; }
}

export async function setWeighReminder(env: Env, body: unknown): Promise<WeighReminder> {
  const b = (body ?? {}) as Record<string, unknown>;
  const time = String(b.time ?? '');
  if (!/^([01]\d|2[0-3]):(00|15|30|45)$/.test(time)) throw new HttpError(400, 'bad_time', 'time must be HH:MM on a quarter hour');
  const r: WeighReminder = { on: b.on === true, time };
  await env.PLATES_KV.put(KEY, JSON.stringify(r));
  return r;
}

/** "HH:MM" in Central time, rounded down to the quarter hour. */
export function chicagoSlot(at: Date): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(at).map((x) => [x.type, x.value]));
  return `${p.hour}:${String(Math.floor(Number(p.minute) / 15) * 15).padStart(2, '0')}`;
}

/**
 * Called by the 15-minute cron. `weighedToday` is injected so tests don't need the Sheet.
 * Returns what happened, for logs and tests.
 */
export async function runWeighReminder(env: Env, at: Date, weighedToday: (date: string) => Promise<boolean>): Promise<'off' | 'not_time' | 'already_sent' | 'weighed' | 'sent'> {
  const r = await getWeighReminder(env);
  if (!r.on) return 'off';
  if (chicagoSlot(at) !== r.time) return 'not_time';
  const today = chicagoDate(at);
  if ((await env.PLATES_KV.get(SENT_KEY)) === today) return 'already_sent';
  await env.PLATES_KV.put(SENT_KEY, today);
  if (await weighedToday(today)) return 'weighed';
  await sendToAll(env, 'weigh');
  return 'sent';
}
