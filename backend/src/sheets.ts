import { SETTINGS_DEFAULTS, TABS, TAB_NAMES, type Cell, type Row, type TabName } from '../../shared/schema';
import { HttpError } from './http';

const API = 'https://sheets.googleapis.com/v4/spreadsheets';

// Overridable in tests so retries don't actually wait.
export const timing = {
  sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
};

const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const RETRY_DELAYS_MS = [1000, 2000, 4000];

export function colLetter(n: number): string {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export const q = (tab: string) => `'${tab.replace(/'/g, "''")}'`;

export function nowIso(nowMs = Date.now()): string {
  return new Date(nowMs).toISOString();
}

/** fetch() against Google APIs with exponential backoff on 429/5xx. */
export async function googleFetch(token: string, url: string, init: RequestInit = {}): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
    if (res.ok) return res.status === 204 ? null : res.json();

    if (RETRY_STATUSES.has(res.status) && attempt < RETRY_DELAYS_MS.length) {
      await timing.sleep(RETRY_DELAYS_MS[attempt]! + Math.floor(Math.random() * 250));
      continue;
    }

    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body?.error?.message) message = body.error.message;
    } catch { /* ignore */ }

    if (res.status === 404) throw new HttpError(404, 'sheet_not_found', 'The Plates spreadsheet was not found (deleted or moved to trash?)');
    if (res.status === 403) throw new HttpError(403, 'sheet_forbidden', `Google refused access: ${message}`);
    if (res.status === 401) throw new HttpError(409, 'google_reconnect', 'Google access expired. Reconnect Google.');
    if (res.status === 429) throw new HttpError(429, 'sheets_rate_limited', 'Google Sheets is busy (rate limit). Try again in a minute.');
    throw new HttpError(502, 'sheets_error', `Google Sheets error: ${message}`);
  }
}

function toCell(v: unknown): Cell {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  return JSON.stringify(v);
}

export function rowToValues(headers: readonly string[], row: Row): Cell[] {
  return headers.map((h) => toCell(row[h]));
}

interface ParsedTab { headers: string[]; rows: { rowNumber: number; data: Row }[] }

export function parseValues(values: unknown[][] | undefined): ParsedTab {
  const all = values ?? [];
  const headers = (all[0] ?? []).map((h) => String(h));
  const rows: ParsedTab['rows'] = [];
  for (let i = 1; i < all.length; i++) {
    const r = all[i] ?? [];
    if (r.every((c) => c === '' || c === null || c === undefined)) continue;
    const data: Row = {};
    headers.forEach((h, j) => { data[h] = toCell(r[j]); });
    rows.push({ rowNumber: i + 1, data });
  }
  return { headers, rows };
}

/** Body for spreadsheets.create: every tab, frozen header row, default settings. */
export function buildCreateBody(title: string, nowMs = Date.now()) {
  const ts = nowIso(nowMs);
  return {
    properties: { title, timeZone: 'America/Chicago' },
    sheets: TAB_NAMES.map((tab, index) => {
      const headers = TABS[tab];
      const rows: Cell[][] = [[...headers]];
      if (tab === 'Settings') {
        for (const [key, value] of Object.entries(SETTINGS_DEFAULTS)) {
          rows.push(rowToValues(headers, { id: crypto.randomUUID(), key, value, created_at: ts, updated_at: ts }));
        }
      }
      return {
        properties: { title: tab, index, gridProperties: { frozenRowCount: 1, columnCount: headers.length } },
        data: [{
          startRow: 0,
          startColumn: 0,
          rowData: rows.map((r) => ({
            values: r.map((c) => ({
              userEnteredValue: typeof c === 'number' ? { numberValue: c }
                : typeof c === 'boolean' ? { boolValue: c }
                  : { stringValue: c },
            })),
          })),
        }],
      };
    }),
  };
}

export class Sheets {
  constructor(private token: string, public readonly spreadsheetId: string) {}

  static async create(token: string, title = 'Plates', nowMs = Date.now()): Promise<{ spreadsheetId: string; url: string }> {
    const res = (await googleFetch(token, API, { method: 'POST', body: JSON.stringify(buildCreateBody(title, nowMs)) })) as {
      spreadsheetId: string;
      spreadsheetUrl: string;
    };
    return { spreadsheetId: res.spreadsheetId, url: res.spreadsheetUrl };
  }

  private url(path = '', params?: Record<string, string | string[]>): string {
    const u = new URL(`${API}/${encodeURIComponent(this.spreadsheetId)}${path}`);
    for (const [k, v] of Object.entries(params ?? {})) {
      for (const one of Array.isArray(v) ? v : [v]) u.searchParams.append(k, one);
    }
    return u.toString();
  }

  async meta(): Promise<{ title: string; url: string; tabs: string[] }> {
    const res = (await googleFetch(this.token, this.url('', { fields: 'spreadsheetUrl,properties.title,sheets.properties.title' }))) as {
      spreadsheetUrl: string;
      properties: { title: string };
      sheets?: { properties: { title: string } }[];
    };
    return { title: res.properties.title, url: res.spreadsheetUrl, tabs: (res.sheets ?? []).map((s) => s.properties.title) };
  }

  /**
   * Adds missing tabs and missing trailing header columns. Never moves or deletes data.
   * Returns problems it would not fix automatically.
   */
  async ensureSchema(): Promise<{ addedTabs: string[]; addedColumns: string[]; problems: string[] }> {
    const { tabs } = await this.meta();
    const missing = TAB_NAMES.filter((t) => !tabs.includes(t));
    const existing = TAB_NAMES.filter((t) => tabs.includes(t));
    const addedColumns: string[] = [];
    const problems: string[] = [];
    const headerWrites: { range: string; values: Cell[][] }[] = [];

    if (missing.length) {
      await googleFetch(this.token, this.url(':batchUpdate'), {
        method: 'POST',
        body: JSON.stringify({
          requests: missing.map((title) => ({
            addSheet: { properties: { title, gridProperties: { frozenRowCount: 1, columnCount: TABS[title].length } } },
          })),
        }),
      });
      for (const t of missing) headerWrites.push({ range: `${q(t)}!A1`, values: [[...TABS[t]]] });
    }

    if (existing.length) {
      const res = (await googleFetch(this.token, this.url('/values:batchGet', {
        ranges: existing.map((t) => `${q(t)}!1:1`),
        valueRenderOption: 'UNFORMATTED_VALUE',
      }))) as { valueRanges?: { values?: unknown[][] }[] };
      existing.forEach((tab, i) => {
        const actual = (res.valueRanges?.[i]?.values?.[0] ?? []).map(String);
        const expected = TABS[tab];
        const isPrefix = actual.every((h, j) => h === expected[j]);
        if (isPrefix && actual.length === expected.length) return;
        if (isPrefix && actual.length < expected.length) {
          const extra = expected.slice(actual.length);
          headerWrites.push({ range: `${q(tab)}!${colLetter(actual.length + 1)}1`, values: [[...extra]] });
          addedColumns.push(...extra.map((c) => `${tab}.${c}`));
          return;
        }
        problems.push(`${tab}: header row doesn't match the expected columns (left unchanged)`);
      });
    }

    if (headerWrites.length) {
      // New columns may exceed the grid width; widen grids first.
      if (addedColumns.length) {
        const { sheets } = (await googleFetch(this.token, this.url('', { fields: 'sheets.properties(sheetId,title,gridProperties.columnCount)' }))) as {
          sheets: { properties: { sheetId: number; title: string; gridProperties: { columnCount: number } } }[];
        };
        const requests = sheets
          .filter((s) => isKnownTab(s.properties.title) && s.properties.gridProperties.columnCount < TABS[s.properties.title as TabName].length)
          .map((s) => ({
            updateSheetProperties: {
              properties: { sheetId: s.properties.sheetId, gridProperties: { columnCount: TABS[s.properties.title as TabName].length } },
              fields: 'gridProperties.columnCount',
            },
          }));
        if (requests.length) {
          await googleFetch(this.token, this.url(':batchUpdate'), { method: 'POST', body: JSON.stringify({ requests }) });
        }
      }
      await googleFetch(this.token, this.url('/values:batchUpdate'), {
        method: 'POST',
        body: JSON.stringify({ valueInputOption: 'RAW', data: headerWrites }),
      });
    }

    return { addedTabs: missing, addedColumns, problems };
  }

  /** Reads several tabs in one API call. Rows keyed by header name. */
  async readTabs(tabs: TabName[]): Promise<Record<string, ParsedTab>> {
    if (!tabs.length) return {};
    const res = (await googleFetch(this.token, this.url('/values:batchGet', {
      ranges: tabs.map((t) => `${q(t)}!A:${colLetter(TABS[t].length)}`),
      valueRenderOption: 'UNFORMATTED_VALUE',
    }))) as { valueRanges?: { values?: unknown[][] }[] };
    const out: Record<string, ParsedTab> = {};
    tabs.forEach((t, i) => { out[t] = parseValues(res.valueRanges?.[i]?.values); });
    return out;
  }

  /** Appends rows; fills id/created_at/updated_at when missing. Returns the stored rows. */
  async append(tab: TabName, rows: Row[], nowMs = Date.now()): Promise<Row[]> {
    if (!rows.length) return [];
    const headers = TABS[tab];
    const ts = nowIso(nowMs);
    const full = rows.map((r) => ({
      ...r,
      id: r.id ? String(r.id) : crypto.randomUUID(),
      ...((headers as readonly string[]).includes('created_at') ? { created_at: r.created_at ?? ts } : {}),
      ...((headers as readonly string[]).includes('updated_at') ? { updated_at: ts } : {}),
    }));
    await googleFetch(this.token, this.url(`/values/${encodeURIComponent(`${q(tab)}!A1`)}:append`, {
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
    }), { method: 'POST', body: JSON.stringify({ values: full.map((r) => rowToValues(headers, r)) }) });
    return full;
  }

  /** Merges each patch into the existing row with the same id. 2 API calls total. */
  async updateById(tab: TabName, patches: Row[], nowMs = Date.now()): Promise<Row[]> {
    if (!patches.length) return [];
    const headers = TABS[tab];
    const parsed = (await this.readTabs([tab]))[tab]!;
    const byId = new Map(parsed.rows.map((r) => [String(r.data.id), r]));
    const missing = patches.filter((p) => !byId.has(String(p.id)));
    if (missing.length) {
      throw new HttpError(404, 'row_not_found', `${tab}: no row with id ${missing.map((m) => m.id).join(', ')}`);
    }
    const ts = nowIso(nowMs);
    const lastCol = colLetter(headers.length);
    const updated: Row[] = [];
    const data = patches.map((p) => {
      const existing = byId.get(String(p.id))!;
      const merged: Row = { ...existing.data, ...p, id: existing.data.id! };
      if ((headers as readonly string[]).includes('created_at')) merged.created_at = existing.data.created_at ?? ts;
      if ((headers as readonly string[]).includes('updated_at')) merged.updated_at = ts;
      updated.push(merged);
      return { range: `${q(tab)}!A${existing.rowNumber}:${lastCol}${existing.rowNumber}`, values: [rowToValues(headers, merged)] };
    });
    await googleFetch(this.token, this.url('/values:batchUpdate'), {
      method: 'POST',
      body: JSON.stringify({ valueInputOption: 'RAW', data }),
    });
    return updated;
  }

  async readSettings(): Promise<Record<string, string>> {
    const parsed = (await this.readTabs(['Settings'])).Settings!;
    const out: Record<string, string> = {};
    for (const r of parsed.rows) {
      if (r.data.key !== '') out[String(r.data.key)] = String(r.data.value ?? '');
    }
    return out;
  }

  /** Updates existing setting rows and appends new keys. At most 3 API calls. */
  async upsertSettings(values: Record<string, string>, nowMs = Date.now()): Promise<void> {
    const parsed = (await this.readTabs(['Settings'])).Settings!;
    const byKey = new Map(parsed.rows.map((r) => [String(r.data.key), r]));
    const ts = nowIso(nowMs);
    const headers = TABS.Settings;
    const lastCol = colLetter(headers.length);
    const updates: { range: string; values: Cell[][] }[] = [];
    const appends: Row[] = [];

    for (const [key, value] of Object.entries(values)) {
      const existing = byKey.get(key);
      if (existing) {
        if (String(existing.data.value) === value) continue;
        const merged: Row = { ...existing.data, value, updated_at: ts };
        updates.push({ range: `${q('Settings')}!A${existing.rowNumber}:${lastCol}${existing.rowNumber}`, values: [rowToValues(headers, merged)] });
      } else {
        appends.push({ key, value });
      }
    }
    if (updates.length) {
      await googleFetch(this.token, this.url('/values:batchUpdate'), {
        method: 'POST',
        body: JSON.stringify({ valueInputOption: 'RAW', data: updates }),
      });
    }
    if (appends.length) await this.append('Settings', appends, nowMs);
  }
}

function isKnownTab(name: string): name is TabName {
  return (TAB_NAMES as string[]).includes(name);
}
