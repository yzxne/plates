import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SETTINGS_DEFAULTS, TABS, TAB_NAMES } from '../../shared/schema';
import { hashPasscode } from '../src/crypto';
import { _resetGoogleCache, KV_KEYS } from '../src/google';
import { handle } from '../src/index';
import { _resetRateLimit } from '../src/lockout';
import { timing } from '../src/sheets';
import { FakeGoogle, makeEnv, req, WORKER } from './helpers';

const PASSCODE = 'test-passcode-1';
let env: ReturnType<typeof makeEnv>;
let google: FakeGoogle;

async function login(): Promise<string> {
  const res = await handle(req('POST', '/auth/login', { body: { passcode: PASSCODE } }), env);
  expect(res.status).toBe(200);
  return ((await res.json()) as { token: string }).token;
}

async function connectGoogle(token: string): Promise<void> {
  const start = await handle(req('POST', '/oauth/google/start', { token }), env);
  const { url } = (await start.json()) as { url: string };
  const state = new URL(url).searchParams.get('state')!;
  const cb = await handle(req('GET', `/oauth/google/callback?code=good-code&state=${encodeURIComponent(state)}`, { origin: null }), env);
  expect(cb.status).toBe(302);
  expect(cb.headers.get('Location')).toBe('https://yzxne.github.io/plates/?google=connected');
}

async function call(method: string, path: string, token: string, body?: unknown) {
  const res = await handle(req(method, path, { token, body }), env);
  return { status: res.status, body: (await res.json()) as any, res };
}

beforeEach(async () => {
  env = makeEnv({ PASSCODE_HASH: await hashPasscode(PASSCODE, 1000) });
  google = new FakeGoogle();
  google.install();
  _resetGoogleCache();
  _resetRateLimit();
  timing.sleep = async () => {};
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CORS and health', () => {
  it('answers health checks', async () => {
    const res = await handle(req('GET', '/health'), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://yzxne.github.io');
  });

  it('allows preflight only from the app origin', async () => {
    const ok = await handle(req('OPTIONS', '/auth/login'), env);
    expect(ok.status).toBe(204);
    expect(ok.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
    const bad = await handle(req('OPTIONS', '/auth/login', { origin: 'https://evil.example' }), env);
    expect(bad.status).toBe(403);
    expect(bad.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('rejects API calls from other origins', async () => {
    const res = await handle(req('POST', '/auth/login', { origin: 'https://evil.example', body: { passcode: PASSCODE } }), env);
    expect(res.status).toBe(403);
  });
});

describe('passcode login', () => {
  it('rejects a wrong passcode, then locks after 5 tries', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await handle(req('POST', '/auth/login', { body: { passcode: 'nope' } }), env);
      expect(res.status).toBe(401);
    }
    const locked = await handle(req('POST', '/auth/login', { body: { passcode: PASSCODE } }), env);
    expect(locked.status).toBe(429);
    expect(((await locked.json()) as any).error).toBe('locked');
  });

  it('issues a token that unlocks protected endpoints', async () => {
    const noAuth = await handle(req('GET', '/auth/check'), env);
    expect(noAuth.status).toBe(401);
    const token = await login();
    expect((await call('GET', '/auth/check', token)).status).toBe(200);
    expect((await call('GET', '/auth/check', token + 'x')).status).toBe(401);
  });

  it('explains when the backend is not configured', async () => {
    env = makeEnv({ PASSCODE_HASH: undefined });
    const res = await handle(req('POST', '/auth/login', { body: { passcode: 'x' } }), env);
    expect(res.status).toBe(500);
    expect(((await res.json()) as any).error).toBe('not_configured');
  });
});

describe('Google OAuth', () => {
  it('builds a consent URL with only the drive.file scope and offline access', async () => {
    const token = await login();
    const { body } = await call('POST', '/oauth/google/start', token);
    const u = new URL(body.url);
    expect(u.origin).toBe('https://accounts.google.com');
    expect(u.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive.file');
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(u.searchParams.get('redirect_uri')).toBe(`${WORKER}/oauth/google/callback`);
  });

  it('stores the refresh token encrypted after the callback', async () => {
    const token = await login();
    await connectGoogle(token);
    const stored = await env.PLATES_KV.get(KV_KEYS.refresh);
    expect(stored).toBeTruthy();
    expect(stored).not.toContain(google.issuedRefresh);
    const status = await call('GET', '/status', token);
    expect(status.body.google).toEqual({ connected: true, reconnect_needed: false });
    expect(status.body.backend.missing_secrets).toEqual([]);
  });

  it('rejects a forged or expired state', async () => {
    const res = await handle(req('GET', '/oauth/google/callback?code=good-code&state=forged', { origin: null }), env);
    expect(res.headers.get('Location')).toContain('google=error');
    expect(await env.PLATES_KV.get(KV_KEYS.refresh)).toBeNull();
  });

  it('reports when Google access was revoked', async () => {
    const token = await login();
    await connectGoogle(token);
    await call('POST', '/sheet/setup', token);
    _resetGoogleCache();
    await env.PLATES_KV.delete(KV_KEYS.access);
    google.refreshValid = false;
    const res = await call('GET', '/sheet/settings', token);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('google_reconnect');
    const status = await call('GET', '/status', token);
    expect(status.body.google.reconnect_needed).toBe(true);
  });
});

describe('spreadsheet setup and settings (end to end with fake Google)', () => {
  let token: string;
  beforeEach(async () => {
    token = await login();
    await connectGoogle(token);
  });

  it('creates the spreadsheet with every tab, header row and default settings', async () => {
    const res = await call('POST', '/sheet/setup', token);
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(true);
    const id = res.body.spreadsheet_id;
    for (const tab of TAB_NAMES) {
      expect(google.tabValues(id, tab)[0]).toEqual([...TABS[tab]]);
    }
    const settingsRows = google.tabValues(id, 'Settings').slice(1);
    expect(settingsRows.map((r) => r[1])).toEqual(Object.keys(SETTINGS_DEFAULTS));

    const again = await call('POST', '/sheet/setup', token);
    expect(again.body.created).toBe(false);
    expect(google.spreadsheets.size).toBe(1);
  });

  it('a changed setting appears in the Sheet', async () => {
    const { body: setup } = await call('POST', '/sheet/setup', token);
    const put = await call('PUT', '/sheet/settings', token, { settings: { goal_type: 'lose', goal_rate_lb_per_week: '0.75', training_days: 'Fri,Mon' } });
    expect(put.status).toBe(200);
    expect(put.body.settings.goal_type).toBe('lose');
    expect(put.body.settings.training_days).toBe('Mon,Fri');

    const rows = google.tabValues(setup.spreadsheet_id, 'Settings');
    const goal = rows.find((r) => r[1] === 'goal_type')!;
    expect(goal[2]).toBe('lose');
    expect(String(goal[4]) >= String(goal[3])).toBe(true); // updated_at refreshed (may equal created_at within the same ms)

    const get = await call('GET', '/sheet/settings', token);
    expect(get.body.settings.goal_rate_lb_per_week).toBe('0.75');
  });

  it('rejects invalid settings with per-field messages and writes nothing', async () => {
    const { body: setup } = await call('POST', '/sheet/setup', token);
    const before = JSON.stringify(google.tabValues(setup.spreadsheet_id, 'Settings'));
    const res = await call('PUT', '/sheet/settings', token, { settings: { goal_rate_lb_per_week: '9', units: 'kg', bogus: '1' } });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.fields).sort()).toEqual(['bogus', 'goal_rate_lb_per_week', 'units']);
    expect(JSON.stringify(google.tabValues(setup.spreadsheet_id, 'Settings'))).toBe(before);
  });

  it('retries after a Google 429 and still saves', async () => {
    const { body: setup } = await call('POST', '/sheet/setup', token);
    google.failNext = [429, 503];
    const put = await call('PUT', '/sheet/settings', token, { settings: { fat_min_g: '60' } });
    expect(put.status).toBe(200);
    const row = google.tabValues(setup.spreadsheet_id, 'Settings').find((r) => r[1] === 'fat_min_g')!;
    expect(row[2]).toBe('60');
  });

  it('returns a clear error when Google keeps failing', async () => {
    await call('POST', '/sheet/setup', token);
    google.failNext = [429, 429, 429, 429];
    const put = await call('PUT', '/sheet/settings', token, { settings: { fat_min_g: '60' } });
    expect(put.status).toBe(429);
    expect(put.body.error).toBe('sheets_rate_limited');
  });

  it('appends, reads and updates rows by id', async () => {
    const { body: setup } = await call('POST', '/sheet/setup', token);
    const add = await call('POST', '/sheet/append', token, {
      tab: 'Weights',
      rows: [{ date: '2026-11-10', time: '07:05', weight_lb: 180.4 }, { date: '2026-11-11', weight_lb: 180.1, notes: '=HYPERLINK("x")' }],
    });
    expect(add.status).toBe(200);
    const [first, second] = add.body.rows;
    expect(first.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.created_at).toBeTruthy();

    const upd = await call('POST', '/sheet/update', token, { tab: 'Weights', rows: [{ id: first.id, weight_lb: 179.9 }] });
    expect(upd.status).toBe(200);
    expect(upd.body.rows[0].time).toBe('07:05'); // untouched column kept

    const read = await call('POST', '/sheet/read', token, { tabs: ['Weights'] });
    const rows = read.body.data.Weights;
    expect(rows.map((r: any) => r.weight_lb)).toEqual([179.9, 180.1]);
    expect(rows[1].notes).toBe('=HYPERLINK("x")'); // stored as text (RAW), not a formula
    expect(google.tabValues(setup.spreadsheet_id, 'Weights')).toHaveLength(3);
    expect(second.id).not.toBe(first.id);
  });

  it('validates tabs and columns', async () => {
    await call('POST', '/sheet/setup', token);
    expect((await call('POST', '/sheet/append', token, { tab: 'Nope', rows: [{}] })).status).toBe(400);
    expect((await call('POST', '/sheet/append', token, { tab: 'Weights', rows: [{ bogus: 1 }] })).body.error).toBe('unknown_columns');
    expect((await call('POST', '/sheet/append', token, { tab: 'Settings', rows: [{ key: 'x' }] })).body.error).toBe('use_settings_endpoint');
    expect((await call('POST', '/sheet/update', token, { tab: 'Weights', rows: [{ weight_lb: 1 }] })).body.error).toBe('missing_id');
    expect((await call('POST', '/sheet/update', token, { tab: 'Weights', rows: [{ id: 'missing', weight_lb: 1 }] })).status).toBe(404);
    expect((await call('POST', '/sheet/read', token, { tabs: ['Weights', 'Nope'] })).status).toBe(400);
  });

  it('repairs missing tabs and older header rows without touching data', async () => {
    const { body: setup } = await call('POST', '/sheet/setup', token);
    const ss = google.spreadsheets.get(setup.spreadsheet_id)!;
    ss.tabs.delete('AIUsage');
    const weights = ss.tabs.get('Weights')!;
    weights.grid[0] = weights.grid[0]!.slice(0, 6); // pretend an older schema ending at "notes"
    weights.grid[1] = ['w1', '2026-11-01', '', 181];

    const res = await call('POST', '/sheet/setup', token);
    expect(res.body.created).toBe(false);
    expect(res.body.addedTabs).toEqual(['AIUsage']);
    expect(res.body.addedColumns).toEqual(['Weights.created_at', 'Weights.updated_at', 'Weights.deleted_at']);
    expect(res.body.problems).toEqual([]);
    expect(google.tabValues(setup.spreadsheet_id, 'Weights')[0]).toEqual([...TABS.Weights]);
    expect(google.tabValues(setup.spreadsheet_id, 'Weights')[1]).toEqual(['w1', '2026-11-01', '', 181]);
  });

  it('never overwrites a mismatched header row', async () => {
    const { body: setup } = await call('POST', '/sheet/setup', token);
    google.spreadsheets.get(setup.spreadsheet_id)!.tabs.get('Foods')!.grid[0]![1] = 'My custom column';
    const res = await call('POST', '/sheet/setup', token);
    expect(res.body.problems[0]).toMatch(/^Foods/);
    expect(google.tabValues(setup.spreadsheet_id, 'Foods')[0]![1]).toBe('My custom column');
  });

  it('asks before replacing a deleted spreadsheet', async () => {
    const { body: setup } = await call('POST', '/sheet/setup', token);
    google.spreadsheets.delete(setup.spreadsheet_id);
    const res = await call('POST', '/sheet/setup', token);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('sheet_missing');
    const created = await call('POST', '/sheet/setup', token, { create_new: true });
    expect(created.body.created).toBe(true);
    expect(created.body.spreadsheet_id).not.toBe(setup.spreadsheet_id);
  });

  it('explains when no spreadsheet exists yet', async () => {
    const res = await call('GET', '/sheet/settings', token);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('sheet_not_set_up');
  });

  it('disconnect forgets tokens but keeps the spreadsheet id', async () => {
    await call('POST', '/sheet/setup', token);
    await call('POST', '/oauth/google/disconnect', token);
    expect(await env.PLATES_KV.get(KV_KEYS.refresh)).toBeNull();
    expect(await env.PLATES_KV.get(KV_KEYS.spreadsheetId)).toBeTruthy();
    expect(google.calls.some((c) => c.url.includes('/revoke'))).toBe(true);
  });

  it('keeps KV writes low (free tier: 1,000/day)', async () => {
    await call('POST', '/sheet/setup', token);
    const before = env.PLATES_KV.writes;
    for (let i = 0; i < 10; i++) await call('GET', '/sheet/settings', token);
    expect(env.PLATES_KV.writes - before).toBe(0);
  });
});
