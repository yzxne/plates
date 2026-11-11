// Small Web Crypto helpers (work in Workers and Node).

const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Accepts base64url or standard base64 (with or without padding). */
export function b64urlDecode(input: string): Uint8Array<ArrayBuffer> {
  const s = input.trim().replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  const padded = s + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

// ---------- HMAC (session + OAuth state tokens) ----------

async function hmacKey(secret: string): Promise<CryptoKey> {
  if (!secret || secret.length < 32) throw new Error('SESSION_SECRET missing or too short');
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function hmacSign(secret: string, data: string): Promise<string> {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(data));
  return b64urlEncode(new Uint8Array(sig));
}

export async function hmacVerify(secret: string, data: string, sig: string): Promise<boolean> {
  let sigBytes: Uint8Array<ArrayBuffer>;
  try {
    sigBytes = b64urlDecode(sig);
  } catch {
    return false;
  }
  return crypto.subtle.verify('HMAC', await hmacKey(secret), sigBytes, enc.encode(data));
}

// ---------- Passcode hashing (PBKDF2-SHA256) ----------

// [Assumption] 20,000 iterations keeps login inside the Workers free plan's 10 ms CPU budget.
// The hash string stores its own iteration count, so this can be raised later without breaking logins.
// Online guessing is limited by the lockout in lockout.ts; the hash itself lives only in Worker secrets.
export const DEFAULT_PBKDF2_ITERATIONS = 20_000;
const MAX_PBKDF2_ITERATIONS = 100_000; // Workers rejects higher counts

async function pbkdf2(passcode: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(passcode), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

/** Returns "pbkdf2_sha256$<iterations>$<salt>$<hash>". */
export async function hashPasscode(passcode: string, iterations = DEFAULT_PBKDF2_ITERATIONS): Promise<string> {
  if (iterations < 1000 || iterations > MAX_PBKDF2_ITERATIONS) throw new Error('Bad iteration count');
  const salt = randomBytes(16);
  const hash = await pbkdf2(passcode, salt, iterations);
  return `pbkdf2_sha256$${iterations}$${b64urlEncode(salt)}$${b64urlEncode(hash)}`;
}

export async function verifyPasscode(passcode: string, stored: string): Promise<boolean> {
  const parts = stored.trim().split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2_sha256') throw new Error('PASSCODE_HASH has the wrong format');
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1000 || iterations > MAX_PBKDF2_ITERATIONS) {
    throw new Error('PASSCODE_HASH has a bad iteration count');
  }
  const salt = b64urlDecode(parts[2]!);
  const expected = b64urlDecode(parts[3]!);
  const actual = await pbkdf2(passcode, salt, iterations);
  return timingSafeEqual(actual, expected);
}

// ---------- AES-GCM (Google tokens at rest in KV) ----------

async function aesKey(keyB64: string): Promise<CryptoKey> {
  const raw = b64urlDecode(keyB64 ?? '');
  if (raw.length !== 32) throw new Error('TOKEN_ENC_KEY must be 32 random bytes, base64-encoded');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptString(keyB64: string, plaintext: string): Promise<string> {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(keyB64), enc.encode(plaintext));
  return `${b64urlEncode(iv)}.${b64urlEncode(new Uint8Array(ct))}`;
}

export async function decryptString(keyB64: string, payload: string): Promise<string> {
  const [ivPart, ctPart] = payload.split('.');
  if (!ivPart || !ctPart) throw new Error('Bad encrypted payload');
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64urlDecode(ivPart) },
    await aesKey(keyB64),
    b64urlDecode(ctPart),
  );
  return dec.decode(pt);
}
