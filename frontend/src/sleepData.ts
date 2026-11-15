// Sleep (Sleep tab), sent each morning by an iPhone Shortcut from Apple Health. Read-only in the app.
import { readTabs } from './foodData';

export interface Night { date: string; asleep_min: number; bed_time: string; wake_time: string }

/** Under this, the workout screen suggests holding weights instead of pushing. */
export const SHORT_SLEEP_MIN = 6 * 60;

let cache: Night[] | null = null;

/** Nights, newest first. Empty (not an error) before the Sleep tab exists. */
export async function loadSleep(force = false): Promise<Night[]> {
  if (cache && !force) return cache;
  try {
    const d = await readTabs(['Sleep']);
    cache = (d.Sleep ?? [])
      .filter((r) => !r.deleted_at && Number(r.asleep_min) > 0)
      .map((r) => ({ date: String(r.date), asleep_min: Number(r.asleep_min), bed_time: String(r.bed_time ?? ''), wake_time: String(r.wake_time ?? '') }))
      .sort((a, b) => b.date.localeCompare(a.date));
  } catch {
    cache = [];
  }
  return cache;
}

export const nightOf = (nights: Night[], date: string) => nights.find((n) => n.date === date) ?? null;

export const sleepLabel = (min: number) => `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, '0')} m`;

/** Average minutes asleep over the 7 mornings ending `date` (only nights that were sent). */
export function weekAverage(nights: Night[], date: string): { avg: number; nights: number } | null {
  const end = new Date(`${date}T12:00:00Z`).getTime();
  const week = nights.filter((n) => { const t = new Date(`${n.date}T12:00:00Z`).getTime(); return t <= end && t > end - 7 * 86400000; });
  return week.length ? { avg: week.reduce((s, n) => s + n.asleep_min, 0) / week.length, nights: week.length } : null;
}
