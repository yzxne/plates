import { APP_TIMEZONE, chicagoDate } from '../../shared/schema';

export const today = () => chicagoDate();

/** Adds days to a YYYY-MM-DD date (calendar math, no time zone surprises). */
export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function dateLabel(date: string, now = today()): string {
  if (date === now) return 'Today';
  if (date === shiftDate(now, -1)) return 'Yesterday';
  if (date === shiftDate(now, 1)) return 'Tomorrow';
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
}

/** Current hour (with fraction) on the America/Chicago clock. */
export function chicagoHour(at: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: APP_TIMEZONE, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(at);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h + m / 60;
}
