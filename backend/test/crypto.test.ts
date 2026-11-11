import { describe, expect, it } from 'vitest';
import {
  b64urlDecode, b64urlEncode, decryptString, encryptString, hashPasscode, randomBytes, verifyPasscode,
} from '../src/crypto';
import { signToken, verifyToken } from '../src/session';

const SECRET = 'x'.repeat(48);

describe('base64url', () => {
  it('round-trips bytes and accepts standard base64', () => {
    const bytes = randomBytes(33);
    expect(b64urlDecode(b64urlEncode(bytes))).toEqual(bytes);
    expect(new TextDecoder().decode(b64urlDecode('aGk/Pz8='))).toBe('hi???');
  });
});

describe('passcode hashing', () => {
  it('verifies the right passcode and rejects a wrong one', async () => {
    const stored = await hashPasscode('correct horse', 1000);
    expect(stored).toMatch(/^pbkdf2_sha256\$1000\$/);
    expect(await verifyPasscode('correct horse', stored)).toBe(true);
    expect(await verifyPasscode('correct hors', stored)).toBe(false);
  });

  it('uses a random salt', async () => {
    expect(await hashPasscode('same', 1000)).not.toBe(await hashPasscode('same', 1000));
  });

  it('rejects malformed hashes and unsafe iteration counts', async () => {
    await expect(verifyPasscode('a', 'nope')).rejects.toThrow(/format/);
    await expect(verifyPasscode('a', 'pbkdf2_sha256$5000000$AAAA$AAAA')).rejects.toThrow(/iteration/);
  });

  it('keeps the default iteration count within the Workers limit', async () => {
    const stored = await hashPasscode('abc12345');
    const iterations = Number(stored.split('$')[1]);
    expect(iterations).toBeGreaterThanOrEqual(10_000);
    expect(iterations).toBeLessThanOrEqual(100_000);
  });
});

describe('AES-GCM token storage', () => {
  it('round-trips and detects tampering', async () => {
    const key = b64urlEncode(randomBytes(32));
    const enc = await encryptString(key, 'refresh-token-value');
    expect(enc).not.toContain('refresh');
    expect(await decryptString(key, enc)).toBe('refresh-token-value');
    const [iv, ct] = enc.split('.');
    const flipped = ct!.slice(0, -2) + (ct!.endsWith('A') ? 'BB' : 'AA');
    await expect(decryptString(key, `${iv}.${flipped}`)).rejects.toThrow();
  });

  it('rejects keys that are not 32 bytes', async () => {
    await expect(encryptString(b64urlEncode(randomBytes(16)), 'x')).rejects.toThrow(/32/);
  });
});

describe('signed tokens', () => {
  it('accepts a valid session token', async () => {
    const { token } = await signToken(SECRET, 'session', 60);
    expect(await verifyToken(SECRET, token, 'session')).not.toBeNull();
  });

  it('rejects expired, wrong-type, wrong-secret and tampered tokens', async () => {
    const now = Date.now();
    const { token } = await signToken(SECRET, 'session', 60, now);
    expect(await verifyToken(SECRET, token, 'session', now + 61_000)).toBeNull();
    expect(await verifyToken(SECRET, token, 'oauth_state', now)).toBeNull();
    expect(await verifyToken('y'.repeat(48), token, 'session', now)).toBeNull();
    const [body, sig] = token.split('.');
    expect(await verifyToken(SECRET, `${body}x.${sig}`, 'session', now)).toBeNull();
    expect(await verifyToken(SECRET, 'garbage', 'session', now)).toBeNull();
  });

  it('refuses short secrets', async () => {
    await expect(signToken('short', 'session', 60)).rejects.toThrow(/SESSION_SECRET/);
  });
});
