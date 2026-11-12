// Automatic weekly backups: Google converts the Sheet to .xlsx (Drive export) and we keep the file in Workers KV,
// i.e. outside Google. Keeps the newest KEEP files. Runs from the cron trigger in wrangler.jsonc, or "Back up now".
import { chicagoDate } from '../../shared/schema';
import type { Env } from './env';
import { getAccessToken, KV_KEYS } from './google';
import { HttpError } from './http';

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const KEEP = 8;
const INDEX = 'backup:index';
const fileKey = (date: string) => `backup:file:${date}`;
const MAX_BYTES = 20 * 1024 * 1024; // KV values can be up to 25 MiB; Drive export caps at 10 MB

export interface BackupEntry { date: string; bytes: number; at: string }

export async function listBackups(kv: KVNamespace): Promise<BackupEntry[]> {
  try { return JSON.parse((await kv.get(INDEX)) ?? '[]') as BackupEntry[]; } catch { return []; }
}

export async function getBackup(kv: KVNamespace, date: string): Promise<ArrayBuffer | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return kv.get(fileKey(date), 'arrayBuffer');
}

export async function runBackup(env: Env, now = new Date()): Promise<BackupEntry> {
  const id = await env.PLATES_KV.get(KV_KEYS.spreadsheetId);
  if (!id) throw new HttpError(409, 'sheet_not_set_up', 'No Plates spreadsheet yet.');
  const token = await getAccessToken(env);
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}/export?mimeType=${encodeURIComponent(XLSX_TYPE)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) throw new HttpError(409, 'google_reconnect', 'Google access expired. Reconnect Google.');
  if (!res.ok) throw new HttpError(502, 'backup_failed', `Google couldn't export the Sheet (HTTP ${res.status}).`);
  const buf = await res.arrayBuffer();
  if (buf.byteLength < 100 || buf.byteLength > MAX_BYTES) throw new HttpError(502, 'backup_failed', `Unexpected backup size (${buf.byteLength} bytes).`);

  const entry: BackupEntry = { date: chicagoDate(now), bytes: buf.byteLength, at: now.toISOString() };
  await env.PLATES_KV.put(fileKey(entry.date), buf);
  const list = [entry, ...(await listBackups(env.PLATES_KV)).filter((b) => b.date !== entry.date)].sort((a, b) => b.date.localeCompare(a.date));
  for (const old of list.slice(KEEP)) await env.PLATES_KV.delete(fileKey(old.date));
  await env.PLATES_KV.put(INDEX, JSON.stringify(list.slice(0, KEEP)));
  return entry;
}
