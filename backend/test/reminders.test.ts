import { afterEach, describe, expect, it, vi } from 'vitest';
import { b64urlEncode } from '../src/crypto';
import { handle } from '../src/index';
import { addSub, lastKind } from '../src/push';
import { chicagoSlot, dueIndex, runWeighReminder, setWeighReminder } from '../src/reminders';
import { makeEnv, req } from './helpers';

async function pushEnv() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const priv = JSON.stringify(await crypto.subtle.exportKey('jwk', kp.privateKey));
  const pub = b64urlEncode(new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey)));
  const env = makeEnv({ VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_JWK: priv });
  await addSub(env, 'https://web.push.apple.com/phone');
  const sent: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => { sent.push(String(input)); return new Response(null, { status: 201 }); }));
  return { env, sent };
}

afterEach(() => vi.unstubAllGlobals());

// 7:30 AM Central on Sat 14 Nov 2026 (CST, UTC−6) = 13:30 UTC.
const AT_730 = new Date('2026-11-14T13:30:00Z');

describe('weigh-in reminder', () => {
  it('rounds to Central quarter hours, across daylight saving', () => {
    expect(chicagoSlot(AT_730)).toBe('07:30');
    expect(chicagoSlot(new Date('2026-11-14T13:44:59Z'))).toBe('07:30');
    expect(chicagoSlot(new Date('2026-07-14T12:30:00Z'))).toBe('07:30'); // CDT, UTC−5
  });

  it('sends once at the chosen time when you have not weighed in', async () => {
    const { env, sent } = await pushEnv();
    await setWeighReminder(env, { on: true, time: '07:30' });
    const notYet = async () => false;
    expect(await runWeighReminder(env, new Date('2026-11-14T13:15:00Z'), notYet)).toBe('not_time');
    expect(await runWeighReminder(env, AT_730, notYet)).toBe('sent');
    expect(sent).toEqual(['https://web.push.apple.com/phone']);
    expect(await lastKind(env)).toBe('weigh');
    expect(await runWeighReminder(env, AT_730, notYet)).toBe('already_sent');
  });

  it('repeats every gap until you weigh in, up to the count', async () => {
    const { env, sent } = await pushEnv();
    await setWeighReminder(env, { on: true, time: '08:45', count: 3, gap: 45 });
    let weighed = false;
    const check = async () => weighed;
    const at = (hhmm: string) => new Date(`2026-11-14T${hhmm}:00-06:00`);
    expect(dueIndex({ on: true, time: '08:45', count: 3, gap: 45 }, 10 * 60 + 15)).toBe(2);
    expect(await runWeighReminder(env, at('08:45'), check)).toBe('sent');
    expect(await runWeighReminder(env, at('09:00'), check)).toBe('not_time');
    expect(await runWeighReminder(env, at('09:30'), check)).toBe('sent');
    expect(await runWeighReminder(env, at('09:30'), check)).toBe('already_sent');
    weighed = true;
    expect(await runWeighReminder(env, at('10:15'), check)).toBe('weighed');
    expect(await runWeighReminder(env, at('11:00'), check)).toBe('not_time'); // past the 3rd
    expect(sent).toHaveLength(2);
  });

  it('skips when you already weighed in, and when it is off', async () => {
    const { env, sent } = await pushEnv();
    expect(await runWeighReminder(env, AT_730, async () => false)).toBe('off');
    await setWeighReminder(env, { on: true, time: '07:30' });
    expect(await runWeighReminder(env, AT_730, async (d) => d === '2026-11-14')).toBe('weighed');
    expect(sent).toEqual([]);
  });

  it('rejects times that are not quarter hours', async () => {
    await expect(setWeighReminder(makeEnv(), { on: true, time: '07:10' })).rejects.toThrow(/quarter/);
  });

  it('tells the phone which notification a push was for (no login needed)', async () => {
    const env = makeEnv();
    const r = await handle(req('GET', '/push/last'), env);
    expect(await r.json()).toEqual({ kind: 'rest' });
  });
});
