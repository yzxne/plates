import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPasscode } from '../src/crypto';
import { _resetGoogleCache } from '../src/google';
import { _resetSchemaCheck, handle } from '../src/index';
import { _resetRateLimit } from '../src/lockout';
import { timing } from '../src/sheets';
import { FakeGoogle, makeEnv, req } from './helpers';

const PASS = 'pass-1234';
let env: ReturnType<typeof makeEnv>;
let google: FakeGoogle;
let token: string;
let sheetId: string;
let anthropic: { calls: Request[]; reply: () => Response };

const okMessage = (items: unknown[], stop = 'end_turn') => new Response(JSON.stringify({
  id: 'msg_test_1', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', stop_reason: stop,
  content: [{ type: 'text', text: JSON.stringify({ items }) }],
  usage: { input_tokens: 3800, output_tokens: 600 },
}), { status: 200, headers: { 'Content-Type': 'application/json', 'request-id': 'req_1' } });

const call = async (method: string, path: string, body?: unknown) => {
  const res = await handle(req(method, path, { token, body }), env);
  return { status: res.status, body: (await res.json()) as any };
};

async function connect() {
  const start = await call('POST', '/oauth/google/start');
  const state = new URL(start.body.url).searchParams.get('state')!;
  await handle(req('GET', `/oauth/google/callback?code=good-code&state=${encodeURIComponent(state)}`, { origin: null }), env);
  sheetId = (await call('POST', '/sheet/setup')).body.spreadsheet_id;
}

beforeEach(async () => {
  env = makeEnv({ PASSCODE_HASH: await hashPasscode(PASS, 1000), ANTHROPIC_API_KEY: 'sk-ant-test' });
  google = new FakeGoogle();
  anthropic = { calls: [], reply: () => okMessage([{ name: 'white rice, cooked', grams: 180, grams_low: 140, grams_high: 220, confidence: 'medium', notes: '' }]) };
  google.otherHosts = (r) => {
    if (new URL(r.url).hostname !== 'api.anthropic.com') return undefined;
    anthropic.calls.push(r.clone());
    return anthropic.reply();
  };
  google.install();
  _resetGoogleCache();
  _resetRateLimit();
  _resetSchemaCheck();
  timing.sleep = async () => {};
  const res = await handle(req('POST', '/auth/login', { body: { passcode: PASS } }), env);
  token = ((await res.json()) as { token: string }).token;
  await connect();
});

afterEach(() => vi.unstubAllGlobals());

const jpeg = { data: 'AAAA'.repeat(100), media_type: 'image/jpeg' };

describe('AI endpoints (fake Anthropic)', () => {
  it('estimates from text, sends structured-output params, and logs usage', async () => {
    const res = await call('POST', '/ai/text-estimate', { description: 'chicken fried steak with gravy', context: { source: 'restaurant', place: 'Golden Corral', oil: 'heavy', junk: 'x' } });
    expect(res.status).toBe(200);
    expect(res.body.items[0]).toMatchObject({ name: 'white rice, cooked', grams: 180 });
    expect(res.body.cost_usd).toBeCloseTo(0.00068, 6);
    const sent = (await anthropic.calls[0]!.json()) as any;
    expect(anthropic.calls[0]!.headers.get('authorization')).toBe('Bearer sk-ant-test');
    expect(sent.model).toBe('claude-haiku-5-5');
    expect(sent.output_config).toMatchObject({ effort: 'low', format: { type: 'json_schema' } });
    expect(sent.messages[0].content.at(-1).text).toMatch(/Golden Corral/);
    const rows = google.tabValues(sheetId, 'AIUsage');
    expect(rows[0]).toContain('cost_usd');
    expect(rows).toHaveLength(2);
    const usage = await call('GET', '/ai/usage');
    expect(usage.body).toMatchObject({ count: 1, cap: 1, configured: true });
    expect(usage.body.month_total).toBeCloseTo(0.00068, 6);
  });

  it('sends photos as base64 image blocks and flags the side photo', async () => {
    const res = await call('POST', '/ai/meal-scan', { images: [jpeg, jpeg], context: { source: 'cafeteria' } });
    expect(res.status).toBe(200);
    const sent = (await anthropic.calls[0]!.json()) as any;
    expect(sent.messages[0].content.filter((b: any) => b.type === 'image')).toHaveLength(2);
    expect(sent.messages[0].content.at(-1).text).toMatch(/second is from the side/);
  });

  it('rejects bad photos and descriptions before calling the AI', async () => {
    expect((await call('POST', '/ai/meal-scan', { images: [] })).body.error).toBe('bad_images');
    expect((await call('POST', '/ai/meal-scan', { images: [{ data: 'AAAA', media_type: 'image/gif' }] })).body.error).toBe('bad_images');
    expect((await call('POST', '/ai/text-estimate', { description: 'a' })).body.error).toBe('bad_description');
    expect(anthropic.calls).toHaveLength(0);
  });

  it('blocks calls once the monthly cap is used up', async () => {
    await call('PUT', '/sheet/settings', { settings: { ai_monthly_cap_usd: '0.001' } });
    expect((await call('POST', '/ai/text-estimate', { description: 'rice bowl' })).status).toBe(200);
    expect((await call('POST', '/ai/text-estimate', { description: 'rice bowl' })).status).toBe(200);
    const blocked = await call('POST', '/ai/text-estimate', { description: 'rice bowl' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe('ai_cap_reached');
    expect(anthropic.calls).toHaveLength(2);
  });

  it('handles refusals, cut-off answers and unreadable output (usage still logged)', async () => {
    anthropic.reply = () => okMessage([], 'refusal');
    expect((await call('POST', '/ai/text-estimate', { description: 'rice bowl' })).body.error).toBe('ai_refused');
    anthropic.reply = () => okMessage([], 'max_tokens');
    expect((await call('POST', '/ai/text-estimate', { description: 'rice bowl' })).body.error).toBe('ai_truncated');
    anthropic.reply = () => okMessage([]);
    expect((await call('POST', '/ai/text-estimate', { description: 'rice bowl' })).body.error).toBe('ai_bad_output');
    expect(google.tabValues(sheetId, 'AIUsage')).toHaveLength(4);
  });

  it('explains key and credit problems', async () => {
    anthropic.reply = () => new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }), { status: 401 });
    expect((await call('POST', '/ai/text-estimate', { description: 'rice bowl' })).body.error).toBe('ai_key');
    anthropic.reply = () => new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low' } }), { status: 400 });
    expect((await call('POST', '/ai/text-estimate', { description: 'rice bowl' })).body.error).toBe('ai_no_credit');
  });

  it('says when the key is missing', async () => {
    env.ANTHROPIC_API_KEY = undefined;
    const res = await call('POST', '/ai/text-estimate', { description: 'rice bowl' });
    expect(res.body.error).toBe('ai_not_configured');
    expect((await call('GET', '/ai/usage')).body.configured).toBe(false);
  });
});
