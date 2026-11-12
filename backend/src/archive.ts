// Moves old FoodLog rows into FoodArchive so everyday FoodLog reads stay small (Workers free plan: ~10 ms CPU/request).
// Order is copy → check → delete, and ids already in FoodArchive are skipped, so a run that stops part-way can simply
// be repeated. The Sheet's own version history can undo it.
import { chicagoDate } from '../../shared/schema';
import { HttpError } from './http';
import type { Sheets } from './sheets';

export const ARCHIVE_AFTER_MONTHS = 12;

export function archiveCutoff(now = new Date(), months = ARCHIVE_AFTER_MONTHS): string {
  const d = new Date(`${chicagoDate(now)}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

/** How many FoodLog rows are older than the cutoff (dry run). */
export async function archivePreview(sheets: Sheets, now = new Date()) {
  const before = archiveCutoff(now);
  const rows = (await sheets.readTabs(['FoodLog'])).FoodLog!.rows;
  const old = rows.filter((r) => String(r.data.date) < before);
  return { before, total: rows.length, movable: old.length };
}

export async function archiveOldFood(sheets: Sheets, now = new Date()) {
  const before = archiveCutoff(now);
  const parsed = await sheets.readTabs(['FoodLog', 'FoodArchive']);
  const old = parsed.FoodLog!.rows.filter((r) => String(r.data.date) < before);
  if (!old.length) return { moved: 0, before, archive_through: null as string | null };

  const inArchive = new Set(parsed.FoodArchive!.rows.map((r) => String(r.data.id)));
  const toCopy = old.filter((r) => !inArchive.has(String(r.data.id))).map((r) => r.data);
  for (let i = 0; i < toCopy.length; i += 500) await sheets.append('FoodArchive', toCopy.slice(i, i + 500));

  // Check every row really is in the archive before deleting anything from FoodLog.
  const check = new Set((await sheets.readTabs(['FoodArchive'])).FoodArchive!.rows.map((r) => String(r.data.id)));
  const missing = old.filter((r) => !check.has(String(r.data.id)));
  if (missing.length) throw new HttpError(502, 'archive_incomplete', `${missing.length} rows didn't reach FoodArchive; nothing was removed. Try again.`);
  await sheets.deleteRows('FoodLog', old.map((r) => r.rowNumber));

  const latest = old.reduce((m, r) => (String(r.data.date) > m ? String(r.data.date) : m), '');
  const settings = await sheets.readSettings();
  const through = (settings.archive_through ?? '') > latest ? settings.archive_through! : latest;
  await sheets.upsertSettings({ archive_through: through });
  return { moved: old.length, before, archive_through: through };
}
