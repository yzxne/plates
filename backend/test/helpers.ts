import { vi } from 'vitest';
import type { Env } from '../src/env';
import { b64urlEncode, randomBytes } from '../src/crypto';

export class MemoryKV {
  store = new Map<string, string>();
  writes = 0;
  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async put(key: string, value: string, _opts?: { expirationTtl?: number }): Promise<void> {
    this.writes++;
    this.store.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.writes++;
    this.store.delete(key);
  }
}

export const TEST_ORIGIN = 'https://yzxne.github.io';
export const WORKER = 'https://plates-api.example.workers.dev';

export function makeEnv(overrides: Partial<Env> = {}): Env & { PLATES_KV: MemoryKV & KVNamespace } {
  return {
    PLATES_KV: new MemoryKV() as unknown as MemoryKV & KVNamespace,
    ALLOWED_ORIGINS: TEST_ORIGIN,
    APP_URL: 'https://yzxne.github.io/plates/',
    SESSION_SECRET: b64urlEncode(randomBytes(32)),
    TOKEN_ENC_KEY: b64urlEncode(randomBytes(32)),
    GOOGLE_CLIENT_ID: 'test-client.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'test-secret',
    ...overrides,
  } as Env & { PLATES_KV: MemoryKV & KVNamespace };
}

export function req(method: string, path: string, opts: { body?: unknown; token?: string; origin?: string | null; ip?: string } = {}): Request {
  const headers: Record<string, string> = { 'CF-Connecting-IP': opts.ip ?? '1.2.3.4' };
  if (opts.origin !== null) headers.Origin = opts.origin ?? TEST_ORIGIN;
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  return new Request(WORKER + path, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

// ---------- Fake Google (OAuth + Sheets API, in memory) ----------

type Grid = unknown[][];
interface FakeTab { sheetId: number; columnCount: number; grid: Grid }

function colToNum(col: string): number {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/** Parses "'Tab'!A5:E5", "'Tab'!A1", "'Tab'!A:Z", "'Tab'!1:1". Returns 0-based start row/col. */
function parseRange(range: string): { tab: string; row: number; col: number; kind: 'cell' | 'cols' | 'row' } {
  const m = /^'((?:[^']|'')+)'!(.+)$/.exec(range);
  if (!m) throw new Error(`Bad range ${range}`);
  const tab = m[1]!.replace(/''/g, "'");
  const ref = m[2]!;
  let mm: RegExpExecArray | null;
  if ((mm = /^([A-Z]+)(\d+)(?::[A-Z]+\d+)?$/.exec(ref))) return { tab, row: Number(mm[2]) - 1, col: colToNum(mm[1]!) - 1, kind: 'cell' };
  if ((mm = /^([A-Z]+):[A-Z]+$/.exec(ref))) return { tab, row: 0, col: colToNum(mm[1]!) - 1, kind: 'cols' };
  if ((mm = /^(\d+):\d+$/.exec(ref))) return { tab, row: Number(mm[1]) - 1, col: 0, kind: 'row' };
  throw new Error(`Unsupported range ${range}`);
}

function trimGrid(grid: Grid): Grid {
  const out = grid.map((r) => {
    const row = [...r];
    while (row.length && (row[row.length - 1] === '' || row[row.length - 1] === undefined)) row.pop();
    return row;
  });
  while (out.length && out[out.length - 1]!.length === 0) out.pop();
  return out;
}

export class FakeGoogle {
  spreadsheets = new Map<string, { title: string; tabs: Map<string, FakeTab> }>();
  calls: { method: string; url: string }[] = [];
  failNext: number[] = []; // statuses to return for the next Sheets calls
  refreshValid = true;
  issuedRefresh = 'refresh-123';
  private nextSheetId = 100;
  /** Optional handler for non-Google hosts (USDA, Open Food Facts). */
  otherHosts?: (r: Request) => Response | undefined;

  install(): void {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => this.handle(new Request(input, init))));
  }

  private async handle(r: Request): Promise<Response> {
    const url = new URL(r.url);
    this.calls.push({ method: r.method, url: r.url });
    const ok = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const err = (status: number, message = 'fake error') => new Response(JSON.stringify({ error: { message } }), { status });

    if (url.hostname === 'oauth2.googleapis.com' && url.pathname === '/token') {
      const p = new URLSearchParams(await r.text());
      if (p.get('grant_type') === 'authorization_code') {
        if (p.get('code') !== 'good-code') return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
        return ok({ access_token: 'access-1', expires_in: 3599, refresh_token: this.issuedRefresh, scope: 'https://www.googleapis.com/auth/drive.file' });
      }
      if (p.get('grant_type') === 'refresh_token') {
        if (!this.refreshValid || p.get('refresh_token') !== this.issuedRefresh) {
          return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
        }
        return ok({ access_token: 'access-2', expires_in: 3599 });
      }
    }
    if (url.hostname === 'oauth2.googleapis.com' && url.pathname === '/revoke') return ok({});

    const other = this.otherHosts?.(r);
    if (other) return other;
    if (url.hostname !== 'sheets.googleapis.com') return err(404, `unexpected host ${url.hostname}`);
    if (!/^Bearer access-\d$/.test(r.headers.get('Authorization') ?? '')) return err(401, 'bad token');
    const forced = this.failNext.shift();
    if (forced) return err(forced);

    const path = decodeURIComponent(url.pathname.replace('/v4/spreadsheets', ''));
    const body = r.method === 'POST' ? await r.json() as Record<string, any> : {};

    if (path === '' && r.method === 'POST') {
      const id = `sheet-${this.nextSheetId++}`;
      const tabs = new Map<string, FakeTab>();
      for (const s of body.sheets) {
        const grid: Grid = (s.data?.[0]?.rowData ?? []).map((rd: any) =>
          rd.values.map((v: any) => v.userEnteredValue.stringValue ?? v.userEnteredValue.numberValue ?? v.userEnteredValue.boolValue));
        tabs.set(s.properties.title, { sheetId: this.nextSheetId++, columnCount: s.properties.gridProperties.columnCount, grid });
      }
      this.spreadsheets.set(id, { title: body.properties.title, tabs });
      return ok({ spreadsheetId: id, spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${id}/edit` });
    }

    const m = /^\/([^/:]+)(.*)$/.exec(path);
    const ss = m ? this.spreadsheets.get(m[1]!) : undefined;
    if (!m || !ss) return err(404, 'Requested entity was not found.');
    const rest = m[2]!;
    const tab = (name: string) => {
      const t = ss.tabs.get(name);
      if (!t) throw new Error(`no tab ${name}`);
      return t;
    };
    const write = (range: string, values: unknown[][]) => {
      const p = parseRange(range);
      const t = tab(p.tab);
      values.forEach((rowVals, i) => {
        const row = (t.grid[p.row + i] ??= []);
        rowVals.forEach((v, j) => {
          if (p.col + j >= t.columnCount) throw new Error(`write beyond grid in ${p.tab}`);
          row[p.col + j] = v;
        });
      });
    };

    if (rest === '' && r.method === 'GET') {
      return ok({
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${m[1]}/edit`,
        properties: { title: ss.title },
        sheets: [...ss.tabs.entries()].map(([title, t]) => ({
          properties: { title, sheetId: t.sheetId, gridProperties: { columnCount: t.columnCount } },
        })),
      });
    }
    if (rest === ':batchUpdate') {
      for (const rq of body.requests) {
        if (rq.addSheet) {
          const pr = rq.addSheet.properties;
          if (ss.tabs.has(pr.title)) return err(400, `Invalid requests[0].addSheet: A sheet with the name "${pr.title}" already exists. Please enter another name.`);
          ss.tabs.set(pr.title, { sheetId: this.nextSheetId++, columnCount: pr.gridProperties?.columnCount ?? 26, grid: [] });
        } else if (rq.updateSheetProperties) {
          const pr = rq.updateSheetProperties.properties;
          const t = [...ss.tabs.values()].find((x) => x.sheetId === pr.sheetId)!;
          t.columnCount = pr.gridProperties.columnCount;
        }
      }
      return ok({});
    }
    if (rest === '/values:batchGet') {
      const ranges = url.searchParams.getAll('ranges');
      return ok({
        valueRanges: ranges.map((range) => {
          const p = parseRange(range);
          const t = tab(p.tab);
          const grid = p.kind === 'row' ? [t.grid[p.row] ?? []] : t.grid;
          return { range, values: trimGrid(grid) };
        }),
      });
    }
    if (rest === '/values:batchUpdate') {
      for (const d of body.data) write(d.range, d.values);
      return ok({});
    }
    const appendMatch = /^\/values\/(.+):append$/.exec(rest);
    if (appendMatch) {
      const p = parseRange(appendMatch[1]!);
      const t = tab(p.tab);
      const start = trimGrid(t.grid).length;
      body.values.forEach((v: unknown[], i: number) => { t.grid[start + i] = [...v]; });
      return ok({});
    }
    return err(400, `unhandled ${r.method} ${rest}`);
  }

  /** Header row + data rows of a tab, as plain arrays. */
  tabValues(spreadsheetId: string, tabName: string): unknown[][] {
    return trimGrid(this.spreadsheets.get(spreadsheetId)!.tabs.get(tabName)!.grid);
  }
}
