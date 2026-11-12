import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KEEP } from '../src/backups';
import { hashPasscode } from '../src/crypto';
import { _resetGoogleCache } from '../src/google';
import worker, { _resetSchemaCheck, handle } from '../src/index';
import { _resetRateLimit } from '../src/lockout';
import { _resetSessionCache } from '../src/session';
import { timing } from '../src/sheets';
import { FakeGoogle, makeEnv, req } from './helpers';

const PASS = 'pass-1234';
let env: ReturnType<typeof makeEnv>;
let google: FakeGoogle;
let session: string;
let exports: string[];
let exportStatus = 200;

const call = async (method: string, path: string) => handle(req(method, path, { token: session }), env);

beforeEach(async () => {
  env = makeEnv({ PASSCODE_HASH: await hashPasscode(PASS, 1000) });
  google = new FakeGoogle();
  exports = [];
  exportStatus = 200;
  google.otherHosts = (r) => {
    const u = new URL(r.url);
    if (u.hostname !== 'www.googleapis.com' || !u.pathname.startsWith('/drive/v3/files/')) return undefined;
    exports.push(u.pathname + u.search);
    if (exportStatus !== 200) return new Response('{}', { status: exportStatus });
    return new Response(new Uint8Array(5000).fill(80), { status: 200, headers: { 'Content-Type': 'application/octet-stream' } });
  };
  google.install();
  _resetGoogleCache(); _resetRateLimit(); _resetSchemaCheck(); _resetSessionCache();
  timing.sleep = async () => {};
  session = ((await (await handle(req('POST', '/auth/login', { body: { passcode: PASS } }), env)).json()) as { token: string }).token;
  const start = (await (await call('POST', '/oauth/google/start')).json()) as { url: string };
  const state = new URL(start.url).searchParams.get('state')!;
  await handle(req('GET', `/oauth/google/callback?code=good-code&state=${encodeURIComponent(state)}`, { origin: null }), env);
  await call('POST', '/sheet/setup');
});

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('automatic backups', () => {
  it('exports the Sheet as xlsx, stores it, lists it and downloads it', async () => {
    const run = await call('POST', '/backups/run');
    expect(run.status).toBe(200);
    expect(exports[0]).toMatch(/\/export\?mimeType=application%2Fvnd\.openxmlformats/);
    const list = (await (await call('GET', '/backups')).json()) as { backups: { date: string; bytes: number }[] };
    expect(list.backups).toHaveLength(1);
    expect(list.backups[0]!.bytes).toBe(5000);
    const dl = await call('GET', `/backups/${list.backups[0]!.date}`);
    expect(dl.status).toBe(200);
    expect(dl.headers.get('Content-Type')).toMatch(/spreadsheetml/);
    expect((await dl.arrayBuffer()).byteLength).toBe(5000);
    expect((await call('GET', '/backups/2020-01-01')).status).toBe(404);
  });

  it('keeps only the newest backups and runs from the weekly cron', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    for (let i = 0; i < KEEP + 2; i++) {
      vi.setSystemTime(new Date(Date.UTC(2026, 10, 2 + i * 7, 16)));
      await new Promise<void>((resolve) => worker.scheduled!({} as ScheduledController, env, { waitUntil: (p: Promise<unknown>) => void p.then(() => resolve()) } as unknown as ExecutionContext));
    }
    vi.useRealTimers();
    const list = (await (await call('GET', '/backups')).json()) as { backups: { date: string }[] };
    expect(list.backups, JSON.stringify(list)).toHaveLength(KEEP);
    expect(list.backups[0]!.date).toBe('2027-01-04'); // 10th weekly run
    expect(list.backups.at(-1)!.date).toBe('2026-11-16'); // the 2 oldest were dropped
    expect(env.PLATES_KV.store.has('backup:file:2026-11-02')).toBe(false); // oldest deleted
  });

  it('reports Google errors and needs a session', async () => {
    exportStatus = 403;
    expect((await call('POST', '/backups/run')).status).toBe(502);
    const noAuth = await handle(req('GET', '/backups'), env);
    expect(noAuth.status).toBe(401);
  });
});
