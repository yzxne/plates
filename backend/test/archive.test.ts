import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TABS } from '../../shared/schema';
import { archiveCutoff } from '../src/archive';
import { hashPasscode } from '../src/crypto';
import { _resetGoogleCache } from '../src/google';
import { _resetSchemaCheck, handle } from '../src/index';
import { _resetRateLimit } from '../src/lockout';
import { _resetSessionCache } from '../src/session';
import { timing } from '../src/sheets';
import { FakeGoogle, makeEnv, req } from './helpers';

const PASS = 'pass-1234';
let env: ReturnType<typeof makeEnv>;
let google: FakeGoogle;
let token: string;
let sheetId: string;
const call = async (method: string, path: string, body?: unknown) => {
  const res = await handle(req(method, path, { token, body }), env);
  return { status: res.status, body: (await res.json()) as any };
};
const ids = (tab: 'FoodLog' | 'FoodArchive') => google.tabValues(sheetId, tab).slice(1).map((r) => r[0]);

beforeEach(async () => {
  env = makeEnv({ PASSCODE_HASH: await hashPasscode(PASS, 1000) });
  google = new FakeGoogle();
  google.install();
  _resetGoogleCache(); _resetRateLimit(); _resetSchemaCheck(); _resetSessionCache();
  timing.sleep = async () => {};
  token = ((await (await handle(req('POST', '/auth/login', { body: { passcode: PASS } }), env)).json()) as { token: string }).token;
  const start = await call('POST', '/oauth/google/start');
  const state = new URL(start.body.url).searchParams.get('state')!;
  await handle(req('GET', `/oauth/google/callback?code=good-code&state=${encodeURIComponent(state)}`, { origin: null }), env);
  sheetId = (await call('POST', '/sheet/setup')).body.spreadsheet_id;
});

afterEach(() => vi.unstubAllGlobals());

describe('archive old food', () => {
  it('moves rows older than 12 months to FoodArchive and keeps the rest', async () => {
    const cutoff = archiveCutoff();
    const old1 = '2024-01-05';
    const old2 = '2024-03-10';
    await call('POST', '/sheet/append', { tab: 'FoodLog', rows: [
      { id: 'a', date: old1, meal: 'lunch', food_name: 'Old A', kcal: 100 },
      { id: 'n1', date: '2099-01-01', meal: 'lunch', food_name: 'New 1', kcal: 200 },
      { id: 'b', date: old2, meal: 'dinner', food_name: 'Old B', kcal: 300 },
      { id: 'c', date: old2, meal: 'snack', food_name: 'Old C', kcal: 50 },
      { id: 'n2', date: '2099-01-02', meal: 'lunch', food_name: 'New 2', kcal: 400 },
    ] });
    // Pretend an earlier run copied "a" already but stopped before deleting.
    await call('POST', '/sheet/append', { tab: 'FoodArchive', rows: [{ id: 'a', date: old1, meal: 'lunch', food_name: 'Old A', kcal: 100 }] });

    expect((await call('GET', '/food/archive')).body).toMatchObject({ before: cutoff, total: 5, movable: 3 });
    const r = await call('POST', '/food/archive');
    expect(r.body).toMatchObject({ moved: 3, archive_through: old2 });
    expect(ids('FoodLog')).toEqual(['n1', 'n2']);
    expect(ids('FoodArchive').sort()).toEqual(['a', 'b', 'c']); // no duplicate "a"
    const row = google.tabValues(sheetId, 'FoodArchive').find((x) => x[0] === 'b')!;
    expect(row[(TABS.FoodArchive as readonly string[]).indexOf('kcal')]).toBe(300);
    const s = await call('GET', '/sheet/settings');
    expect(s.body.settings.archive_through).toBe(old2);
    // Running again does nothing
    expect((await call('POST', '/food/archive')).body.moved).toBe(0);
  });
});
