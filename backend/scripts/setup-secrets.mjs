// Sets the backend's secrets in Cloudflare without showing them on screen or saving them to disk.
//   npm run setup-secrets -w backend                 -> all secrets
//   npm run setup-secrets -w backend -- --passcode   -> only change the passcode
//   npm run setup-secrets -w backend -- --google     -> only the Google client ID/secret
// Requires `npx wrangler login` first.

import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ITERATIONS = 20000; // must match DEFAULT_PBKDF2_ITERATIONS in src/crypto.ts (hash stores its own count)

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function hashPasscode(passcode) {
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(passcode, salt, ITERATIONS, 32, 'sha256');
  return `pbkdf2_sha256$${ITERATIONS}$${b64url(salt)}$${b64url(hash)}`;
}

function ask(prompt, { hidden = false } = {}) {
  return new Promise((resolvePromise, reject) => {
    process.stdout.write(prompt);
    const stdin = process.stdin;
    if (!stdin.isTTY) return reject(new Error('Run this in a terminal (PowerShell).'));
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const cleanup = () => { stdin.off('data', onData); stdin.setRawMode(false); stdin.pause(); };
    function onData(chunk) {
      for (const c of chunk) {
        if (c === '\r' || c === '\n') { cleanup(); process.stdout.write('\n'); return resolvePromise(value); }
        if (c === '\u0003') { cleanup(); process.stdout.write('\n'); return reject(new Error('Cancelled')); }
        if (c === '\u007f' || c === '\b') {
          if (value.length) { value = value.slice(0, -1); if (!hidden) process.stdout.write('\b \b'); }
          continue;
        }
        value += c;
        process.stdout.write(hidden ? '*' : c);
      }
    }
    stdin.on('data', onData);
  });
}

function putSecret(name, value) {
  process.stdout.write(`Saving ${name} to Cloudflare... `);
  const r = spawnSync(`npx wrangler secret put ${name}`, {
    cwd: backendDir, input: value, shell: true, stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf8',
  });
  if (r.status !== 0) {
    console.log('FAILED');
    console.error((r.stderr || r.stdout || '').trim());
    process.exit(1);
  }
  console.log('done');
}

async function setPasscode() {
  for (;;) {
    const a = await ask('New passcode (8+ characters): ', { hidden: true });
    if (a.length < 8) { console.log('Too short. Use at least 8 characters.'); continue; }
    const b = await ask('Type it again: ', { hidden: true });
    if (a !== b) { console.log("They don't match. Try again."); continue; }
    putSecret('PASSCODE_HASH', hashPasscode(a));
    return;
  }
}

async function setGoogle() {
  const id = (await ask('Google OAuth Client ID (ends with .apps.googleusercontent.com): ')).trim();
  if (!id.endsWith('.apps.googleusercontent.com')) { console.log('That does not look like a Client ID. Skipped.'); return; }
  const secret = (await ask('Google OAuth Client secret: ', { hidden: true })).trim();
  if (!secret) { console.log('Empty. Skipped.'); return; }
  putSecret('GOOGLE_CLIENT_ID', id);
  putSecret('GOOGLE_CLIENT_SECRET', secret);
}

async function setUsda() {
  const key = (await ask('USDA FoodData Central API key: ', { hidden: true })).trim();
  if (!key) { console.log('Empty. Skipped.'); return; }
  putSecret('USDA_API_KEY', key);
}

const args = new Set(process.argv.slice(2));
try {
  if (args.has('--passcode')) {
    await setPasscode();
  } else if (args.has('--google')) {
    await setGoogle();
  } else if (args.has('--usda')) {
    await setUsda();
  } else {
    console.log('This sets your Plates backend secrets in Cloudflare. Nothing is saved on this PC.\n');
    putSecret('SESSION_SECRET', b64url(randomBytes(32)));
    putSecret('TOKEN_ENC_KEY', b64url(randomBytes(32)));
    await setPasscode();
    await setGoogle();
    await setUsda();
  }
  console.log('\nAll set.');
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
