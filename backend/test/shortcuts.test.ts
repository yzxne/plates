import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TABS } from '../../shared/schema';
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
let session: string;
let sheetId: string;

const aiReply = (items: unknown[]) => new Response(JSON.stringify({
  id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', stop_reason: 'end_turn',
  content: [{ type: 'text', text: JSON.stringify({ items }) }], usage: { input_tokens: 1000, output_tokens: 200 },
}), { status: 200, headers: { 'Content-Type': 'application/json' } });

const usdaFood = (fdcId: number, description: string, kcal: number) => ({
  fdcId, description, dataType: 'SR Legacy',
  foodNutrients: [{ nutrientId: 1008, value: kcal }, { nutrientId: 1003, value: 13 }, { nutrientId: 1004, value: 10 }, { nutrientId: 1005, value: 1 }],
});

const as = async (token: string, method: string, path: string, body?: unknown) => {
  const res = await handle(req(method, path, { token, body, origin: null }), env);
  return { status: res.status, body: (await res.json()) as any };
};
const call = (method: string, path: string, body?: unknown) => as(session, method, path, body);
const col = (tab: keyof typeof TABS, name: string) => (TABS[tab] as readonly string[]).indexOf(name);

beforeEach(async () => {
  env = makeEnv({ PASSCODE_HASH: await hashPasscode(PASS, 1000), ANTHROPIC_API_KEY: 'sk-ant-test' });
  google = new FakeGoogle();
  google.otherHosts = (r) => {
    const host = new URL(r.url).hostname;
    if (host === 'api.anthropic.com') return aiReply([{ name: 'egg, whole, cooked', grams: 100 }, { name: 'mystery sauce', grams: 0 }]);
    if (host === 'api.nal.usda.gov') return new Response(JSON.stringify({ foods: [usdaFood(1, 'Egg, whole, cooked, hard-boiled', 155)] }), { status: 200 });
    return undefined;
  };
  google.install();
  _resetGoogleCache(); _resetRateLimit(); _resetSchemaCheck(); _resetSessionCache();
  timing.sleep = async () => {};
  session = ((await (await handle(req('POST', '/auth/login', { body: { passcode: PASS } }), env)).json()) as { token: string }).token;
  const start = await call('POST', '/oauth/google/start');
  const state = new URL(start.body.url).searchParams.get('state')!;
  await handle(req('GET', `/oauth/google/callback?code=good-code&state=${encodeURIComponent(state)}`, { origin: null }), env);
  sheetId = (await call('POST', '/sheet/setup')).body.spreadsheet_id;
});

afterEach(() => vi.unstubAllGlobals());

describe('Shortcuts key', () => {
  it('is created once, works, and stops working when revoked or replaced', async () => {
    expect((await call('GET', '/shortcut-key')).body.exists).toBe(false);
    const { key } = (await call('POST', '/shortcut-key')).body;
    expect(key).toMatch(/^plk_/);
    expect((await call('GET', '/shortcut-key')).body.exists).toBe(true);
    expect((await as(key, 'GET', '/shortcut/summary')).status).toBe(200);
    // The session token is not a shortcut key, and the shortcut key can't use the app's API.
    expect((await as(session, 'GET', '/shortcut/summary')).status).toBe(401);
    expect((await as(key, 'POST', '/sheet/read', { tabs: ['Weights'] })).status).toBe(401);
    const { key: key2 } = (await call('POST', '/shortcut-key')).body;
    expect((await as(key, 'GET', '/shortcut/summary')).status).toBe(401);
    await call('POST', '/shortcut-key/revoke');
    expect((await as(key2, 'GET', '/shortcut/summary')).status).toBe(401);
  });
});

describe('Shortcut endpoints', () => {
  let key: string;
  beforeEach(async () => { key = (await call('POST', '/shortcut-key')).body.key; });

  it('logs weight from Health (kg converted, repeats skipped)', async () => {
    const a = await as(key, 'POST', '/shortcut/weight', { weight: '78.0', unit: 'kg', date: '2026-11-12' });
    expect(a.body).toMatchObject({ added: true, message: 'Logged 172 lb.' });
    const b = await as(key, 'POST', '/shortcut/weight', { weight: 78, unit: 'kg', date: '2026-11-12' });
    expect(b.body.added).toBe(false);
    expect((await as(key, 'POST', '/shortcut/weight', { weight: 20 })).status).toBe(400);
    // No Health weigh-in today → empty value → quietly nothing.
    expect((await as(key, 'POST', '/shortcut/weight', { weight: '', unit: 'lb' })).body).toMatchObject({ ok: true, added: false });
    // Real case: a wrong unit sent 434 lb when the last weigh-in was ~172 → refused with a hint.
    const odd = await as(key, 'POST', '/shortcut/weight', { weight: 434, date: '2026-11-13' });
    expect(odd.status).toBe(422);
    expect(odd.body.message).toMatch(/far from your last weigh-in \(172 lb\)/);
    const rows = google.tabValues(sheetId, 'Weights');
    expect(rows).toHaveLength(2);
    expect(rows[1]![col('Weights', 'weight_lb')]).toBe(172);
  });

  it('quick-logs food from text, saves the food, updates day totals and reports what it missed', async () => {
    const r = await as(key, 'POST', '/shortcut/log', { text: '2 eggs and mystery sauce', meal: 'breakfast' });
    expect(r.status).toBe(200);
    expect(r.body.kcal).toBe(155);
    expect(r.body.message).toMatch(/Logged egg to Breakfast, about 155 kcal\. Couldn't find: mystery sauce/);
    const log = google.tabValues(sheetId, 'FoodLog');
    expect(log).toHaveLength(2);
    expect(log[1]![col('FoodLog', 'entry_method')]).toBe('shortcut');
    expect(log[1]![col('FoodLog', 'meal')]).toBe('breakfast');
    expect(google.tabValues(sheetId, 'Foods')).toHaveLength(2);
    const days = google.tabValues(sheetId, 'Days');
    expect(days[1]![col('Days', 'total_kcal')]).toBe(155);
    // Summary reads it back
    const s = await as(key, 'GET', '/shortcut/summary');
    expect(s.body).toMatchObject({ kcal: 155, items: 1, day_complete: false });
    expect(s.body.text).toMatch(/155 kcal/);
  });
});
