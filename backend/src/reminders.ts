// Weigh-in reminder: a cron runs every 15 minutes. Starting at your chosen time (Central) it sends "Time to weigh in",
// then repeats every `gap` minutes, up to `count` times a day, stopping as soon as today's weigh-in is logged.
import { chicagoDate } from '../../shared/schema';
import type { Env } from './env';
import { HttpError } from './http';
import { sendToAll } from './push';

const KEY = 'remind:weigh';
const SENT_KEY = 'remind:weigh:sent'; // "YYYY-MM-DD:n" = reminders already sent today

export interface WeighReminder { on: boolean; time: string; count: number; gap: number } // time "HH:MM" 24 h, Central
export const DEFAULT_REMINDER: WeighReminder = { on: false, time: '08:45', count: 3, gap: 45 };
const COUNTS = [1, 2, 3, 4];
const GAPS = [30, 45, 60, 90];

export async function getWeighReminder(env: Env): Promise<WeighReminder> {
  try { return { ...DEFAULT_REMINDER, ...(JSON.parse((await env.PLATES_KV.get(KEY)) ?? '{}') as Partial<WeighReminder>) }; } catch { return DEFAULT_REMINDER; }
}

export async function setWeighReminder(env: Env, body: unknown): Promise<WeighReminder> {
  const b = (body ?? {}) as Record<string, unknown>;
  const time = String(b.time ?? '');
  if (!/^([01]\d|2[0-3]):(00|15|30|45)$/.test(time)) throw new HttpError(400, 'bad_time', 'time must be HH:MM on a quarter hour');
  const count = b.count == null ? DEFAULT_REMINDER.count : Number(b.count);
  const gap = b.gap == null ? DEFAULT_REMINDER.gap : Number(b.gap);
  if (!COUNTS.includes(count)) throw new HttpError(400, 'bad_count', 'count must be 1–4');
  if (!GAPS.includes(gap)) throw new HttpError(400, 'bad_gap', 'gap must be 30, 45, 60 or 90 minutes');
  const r: WeighReminder = { on: b.on === true, time, count, gap };
  await env.PLATES_KV.put(KEY, JSON.stringify(r));
  return r;
}

/** Minutes after midnight in Central time, rounded down to the quarter hour. */
export function chicagoMinutes(at: Date): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(at).map((x) => [x.type, x.value]));
  return Number(p.hour) * 60 + Math.floor(Number(p.minute) / 15) * 15;
}
export const chicagoSlot = (at: Date) => {
  const m = chicagoMinutes(at);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/** Which reminder (0-based) is due at this quarter hour, or null. 45-min gaps land on quarter hours too. */
export function dueIndex(r: WeighReminder, minutes: number): number | null {
  const [h, m] = r.time.split(':').map(Number);
  const diff = minutes - (h! * 60 + m!);
  if (diff < 0 || diff % r.gap !== 0) return null;
  const k = diff / r.gap;
  return k < r.count ? k : null;
}

/** Called by the 15-minute cron. `weighedToday` is injected so tests don't need the Sheet. */
export async function runWeighReminder(env: Env, at: Date, weighedToday: (date: string) => Promise<boolean>): Promise<'off' | 'not_time' | 'already_sent' | 'weighed' | 'sent'> {
  const r = await getWeighReminder(env);
  if (!r.on) return 'off';
  const k = dueIndex(r, chicagoMinutes(at));
  if (k == null) return 'not_time';
  const today = chicagoDate(at);
  const [day, n] = ((await env.PLATES_KV.get(SENT_KEY)) ?? '').split(':');
  const sentToday = day === today ? Number(n) || 0 : 0;
  if (sentToday > k) return 'already_sent';
  await env.PLATES_KV.put(SENT_KEY, `${today}:${k + 1}`);
  if (await weighedToday(today)) return 'weighed';
  await sendToAll(env, 'weigh');
  return 'sent';
}
