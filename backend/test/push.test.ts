import { afterEach, describe, expect, it, vi } from 'vitest';
import { b64urlDecode, b64urlEncode } from '../src/crypto';
import { addSub, listSubs, sendToAll, validEndpoint, vapidJwt } from '../src/push';
import { makeEnv } from './helpers';

async function keys() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  return { kp, priv: JSON.stringify(jwk), pub: b64urlEncode(raw) };
}

afterEach(() => vi.unstubAllGlobals());

describe('web push', () => {
  it('signs a valid ES256 VAPID JWT', async () => {
    const { kp, priv } = await keys();
    const jwt = await vapidJwt(priv, 'https://web.push.apple.com', 1_800_000_000_000);
    const [h, p, s] = jwt.split('.');
    expect(JSON.parse(new TextDecoder().decode(b64urlDecode(h!)))).toEqual({ typ: 'JWT', alg: 'ES256' });
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(p!)));
    expect(payload).toEqual({ aud: 'https://web.push.apple.com', exp: 1_800_000_000 + 43200, sub: 'https://github.com/yzxne/plates' });
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, kp.publicKey, b64urlDecode(s!), new TextEncoder().encode(`${h}.${p}`));
    expect(ok).toBe(true);
    expect(b64urlDecode(s!).length).toBe(64);
  });

  it('only accepts known push services', () => {
    expect(validEndpoint('https://web.push.apple.com/QWxhZGRpbg')).toBe(true);
    expect(validEndpoint('https://fcm.googleapis.com/fcm/send/abc')).toBe(true);
    expect(validEndpoint('https://evil.example/push')).toBe(false);
    expect(validEndpoint('http://web.push.apple.com/x')).toBe(false);
    expect(validEndpoint(42)).toBe(false);
  });

  it('sends empty pushes with VAPID auth and drops expired subscriptions', async () => {
    const { pub, priv } = await keys();
    const env = makeEnv({ VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_JWK: priv });
    await addSub(env, 'https://web.push.apple.com/gone');
    await addSub(env, 'https://web.push.apple.com/live');
    const calls: Request[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const r = new Request(input, init);
      calls.push(r);
      return new Response(null, { status: r.url.endsWith('/gone') ? 410 : 201 });
    }));
    expect(await sendToAll(env)).toEqual({ sent: 1, removed: 1 });
    const auth = calls[0]!.headers.get('Authorization')!;
    expect(auth.startsWith('vapid t=')).toBe(true);
    expect(auth.endsWith(', k=' + pub)).toBe(true);
    expect(auth.slice(8, auth.indexOf(',')).split('.')).toHaveLength(3);
    expect(calls[0]!.headers.get('TTL')).toBe('120');
    expect((await listSubs(env)).map((s) => s.endpoint)).toEqual(['https://web.push.apple.com/live']);
  });

  it('explains when push is not configured', async () => {
    await expect(sendToAll(makeEnv())).rejects.toThrow(/not set up/);
  });
});
