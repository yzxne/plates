import { isTabName, SCHEMA_VERSION, SETTINGS_DEFAULTS, TABS, validateSettings, type Row, type TabName } from '../../shared/schema';
import { verifyPasscode } from './crypto';
import { REQUIRED_SECRETS, type Env } from './env';
import {
  buildAuthUrl, disconnectGoogle, exchangeCode, getAccessToken, googleConnection, KV_KEYS, redirectUri,
} from './google';
import { corsHeaders, errorResponse, HttpError, json, parseOrigins, readJson } from './http';
import { allowRequest, lockStatus, recordFailure, recordSuccess } from './lockout';
import {
  bearerToken, revokeOtherSessions, SESSION_TTL_SEC, sessionsValidAfter, signToken, STATE_TTL_SEC, verifyToken,
} from './session';
import { lookupUsdaBarcode, searchOff, searchUsda } from './food';
import { cleanContext, cleanImages, estimate, monthUsage } from './ai';
import { addSub, cancelRest, removeSub, scheduleRest, sendToAll, validEndpoint } from './push';
export { RestTimer } from './push';
import { checkTypedCode } from '../../shared/barcode';
import { applyFilters, Sheets, type Filters } from './sheets';
import { getBackup, KEEP, listBackups, runBackup, XLSX_TYPE } from './backups';
import { archiveOldFood, archivePreview } from './archive';
import {
  createShortcutKey, requireShortcutKey, revokeShortcutKey, shortcutKeyStatus, shortcutLog, shortcutSummary, shortcutWeight,
} from './shortcuts';

export default {
  fetch: (request: Request, env: Env) => handle(request, env),
  // Weekly backup (cron in wrangler.jsonc). Failures are logged; the next run tries again.
  scheduled: (_event: ScheduledController, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(runBackup(env).catch((err) => console.error('Scheduled backup failed', err)));
  },
} satisfies ExportedHandler<Env>;

export async function handle(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get('Origin');
  const allowed = parseOrigins(env.ALLOWED_ORIGINS);
  const originOk = !origin || allowed.includes(origin);
  const cors = origin && originOk ? corsHeaders(origin) : {};

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: originOk ? 204 : 403, headers: cors });
  }
  if (!originOk) return json({ error: 'origin_not_allowed', message: 'This origin is not allowed' }, 403);

  let res: Response;
  try {
    res = await route(request, env);
  } catch (err) {
    if (err instanceof HttpError) {
      res = errorResponse(err);
    } else {
      console.error('Unhandled error', err);
      res = json({ error: 'server_error', message: 'Something went wrong on the server' }, 500);
    }
  }
  for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
  return res;
}

function clientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? 'unknown';
}

async function requireSession(request: Request, env: Env): Promise<void> {
  if (!env.SESSION_SECRET) throw new HttpError(500, 'not_configured', 'SESSION_SECRET is not set on the backend');
  const token = bearerToken(request);
  const payload = token ? await verifyToken(env.SESSION_SECRET, token, 'session') : null;
  if (!payload || payload.iat < (await sessionsValidAfter(env.PLATES_KV))) {
    throw new HttpError(401, 'unauthorized', 'Please log in again');
  }
}

// Spreadsheets already checked against the current schema in this Worker instance.
const schemaChecked = new Set<string>();
export function _resetSchemaCheck(): void {
  schemaChecked.clear();
}

async function sheetFor(env: Env): Promise<Sheets> {
  const id = await env.PLATES_KV.get(KV_KEYS.spreadsheetId);
  if (!id) throw new HttpError(409, 'sheet_not_set_up', 'No Plates spreadsheet yet. Create it in Settings (gear icon on Today).');
  const sheets = new Sheets(await getAccessToken(env), id);
  // After an app update adds columns, upgrade the Sheet once (adds tabs/columns at the end; never moves data).
  const key = `${id}:v${SCHEMA_VERSION}`;
  if (!schemaChecked.has(key)) {
    const r = await sheets.ensureSchema();
    if (r.problems.length) console.warn('Schema problems', r.problems);
    schemaChecked.add(key);
  }
  return sheets;
}

function appRedirect(env: Env, params: Record<string, string>): Response {
  const url = new URL(env.APP_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Response(null, { status: 302, headers: { Location: url.toString(), 'Cache-Control': 'no-store' } });
}

const MAX_ROWS = 500;

function validateRows(tab: TabName, rows: unknown, requireId: boolean): Row[] {
  if (!Array.isArray(rows) || rows.length === 0) throw new HttpError(400, 'bad_rows', 'rows must be a non-empty array');
  if (rows.length > MAX_ROWS) throw new HttpError(400, 'too_many_rows', `At most ${MAX_ROWS} rows per request`);
  const allowed = new Set<string>(TABS[tab]);
  return rows.map((r, i) => {
    if (!r || typeof r !== 'object' || Array.isArray(r)) throw new HttpError(400, 'bad_rows', `Row ${i} is not an object`);
    const row = r as Record<string, unknown>;
    const unknownKeys = Object.keys(row).filter((k) => !allowed.has(k));
    if (unknownKeys.length) throw new HttpError(400, 'unknown_columns', `${tab} has no column(s): ${unknownKeys.join(', ')}`);
    if (requireId && !row.id) throw new HttpError(400, 'missing_id', `Row ${i} needs an id`);
    for (const [k, v] of Object.entries(row)) {
      if (v !== null && !['string', 'number', 'boolean'].includes(typeof v)) {
        throw new HttpError(400, 'bad_value', `Row ${i}, ${k}: values must be text, numbers or true/false`);
      }
      if (typeof v === 'string' && v.length > 50_000) throw new HttpError(400, 'bad_value', `Row ${i}, ${k}: text too long`);
    }
    return row as Row;
  });
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method;
  const ip = clientIp(request);

  // ---------- Public ----------
  if (method === 'GET' && (path === '/' || path === '/health')) {
    return json({ ok: true, service: 'plates-api' });
  }

  if (method === 'POST' && path === '/auth/login') {
    if (!env.PASSCODE_HASH || !env.SESSION_SECRET) {
      throw new HttpError(500, 'not_configured', 'Passcode or session secret not set on the backend');
    }
    const lock = await lockStatus(env.PLATES_KV, ip);
    if (lock.locked) {
      throw new HttpError(429, 'locked', `Too many wrong passcodes. Try again in ${Math.ceil(lock.retryAfterSec / 60)} min.`, {
        retry_after_sec: lock.retryAfterSec,
      });
    }
    const body = await readJson<{ passcode?: unknown }>(request);
    const passcode = typeof body.passcode === 'string' ? body.passcode : '';
    if (!passcode || passcode.length > 200) throw new HttpError(400, 'bad_passcode', 'Enter your passcode');
    if (!(await verifyPasscode(passcode, env.PASSCODE_HASH))) {
      await recordFailure(env.PLATES_KV, ip);
      throw new HttpError(401, 'wrong_passcode', 'Wrong passcode');
    }
    await recordSuccess(env.PLATES_KV, ip);
    const { token, exp } = await signToken(env.SESSION_SECRET, 'session', SESSION_TTL_SEC);
    return json({ token, expires_at: new Date(exp * 1000).toISOString() });
  }

  // Google redirects the browser here (no Origin header, no bearer token). The signed state proves it started from the app.
  if (method === 'GET' && path === '/oauth/google/callback') {
    const state = url.searchParams.get('state') ?? '';
    if (!env.SESSION_SECRET || !(await verifyToken(env.SESSION_SECRET, state, 'oauth_state'))) {
      return appRedirect(env, { google: 'error', reason: 'expired' });
    }
    const error = url.searchParams.get('error');
    if (error) return appRedirect(env, { google: 'error', reason: error === 'access_denied' ? 'denied' : 'google' });
    const code = url.searchParams.get('code');
    if (!code) return appRedirect(env, { google: 'error', reason: 'no_code' });
    try {
      await exchangeCode(env, code, redirectUri(request.url));
    } catch (err) {
      const reason = err instanceof HttpError ? err.code : 'server';
      if (!(err instanceof HttpError)) console.error('OAuth exchange failed', err);
      return appRedirect(env, { google: 'error', reason });
    }
    return appRedirect(env, { google: 'connected' });
  }

  // ---------- Authenticated ----------
  if (!allowRequest(ip)) throw new HttpError(429, 'rate_limited', 'Too many requests. Slow down for a minute.');

  // ---------- iPhone Shortcuts (own key, not the session) ----------
  if (path.startsWith('/shortcut/')) {
    await requireShortcutKey(request, env.PLATES_KV);
    if (method === 'POST' && path === '/shortcut/weight') return json(await shortcutWeight(await sheetFor(env), await readJson(request)));
    if (method === 'GET' && path === '/shortcut/summary') return json(await shortcutSummary(await sheetFor(env)));
    if (method === 'POST' && path === '/shortcut/log') return json(await shortcutLog(env, await sheetFor(env), await readJson(request)));
    throw new HttpError(404, 'not_found', 'Not found');
  }

  await requireSession(request, env);

  // ---------- Move old food rows to FoodArchive ----------
  if (method === 'GET' && path === '/food/archive') return json(await archivePreview(await sheetFor(env)));
  if (method === 'POST' && path === '/food/archive') return json(await archiveOldFood(await sheetFor(env)));

  // ---------- Automatic backups ----------
  if (method === 'GET' && path === '/backups') return json({ backups: await listBackups(env.PLATES_KV), keep: KEEP });
  if (method === 'POST' && path === '/backups/run') return json(await runBackup(env));
  const backupMatch = /^\/backups\/(\d{4}-\d{2}-\d{2})$/.exec(path);
  if (method === 'GET' && backupMatch) {
    const buf = await getBackup(env.PLATES_KV, backupMatch[1]!);
    if (!buf) throw new HttpError(404, 'not_found', 'That backup is gone (only the newest 8 are kept).');
    return new Response(buf, {
      headers: {
        'Content-Type': XLSX_TYPE, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': `attachment; filename="plates-backup-${backupMatch[1]}.xlsx"`,
      },
    });
  }

  if (method === 'GET' && path === '/shortcut-key') return json(await shortcutKeyStatus(env.PLATES_KV));
  if (method === 'POST' && path === '/shortcut-key') return json(await createShortcutKey(env.PLATES_KV));
  if (method === 'POST' && path === '/shortcut-key/revoke') { await revokeShortcutKey(env.PLATES_KV); return json({ ok: true }); }

  if (method === 'GET' && path === '/auth/check') return json({ ok: true });

  // Signs out every other device (e.g. a lost phone). This device gets a fresh session.
  if (method === 'POST' && path === '/auth/logout-others') {
    await revokeOtherSessions(env.PLATES_KV);
    const { token, exp } = await signToken(env.SESSION_SECRET!, 'session', SESSION_TTL_SEC);
    return json({ token, expires_at: new Date(exp * 1000).toISOString() });
  }

  if (method === 'GET' && path === '/status') {
    const missingSecrets = REQUIRED_SECRETS.filter((k) => !env[k]);
    const conn = await googleConnection(env);
    const spreadsheetId = await env.PLATES_KV.get(KV_KEYS.spreadsheetId);
    const sheet: Record<string, unknown> = { set_up: !!spreadsheetId };
    if (conn.connected && spreadsheetId) {
      try {
        const meta = await new Sheets(await getAccessToken(env), spreadsheetId).meta();
        Object.assign(sheet, { ok: true, title: meta.title, url: meta.url });
      } catch (err) {
        Object.assign(sheet, {
          ok: false,
          error: err instanceof HttpError ? err.code : 'server_error',
          message: err instanceof HttpError ? err.message : 'Could not reach the spreadsheet',
        });
      }
    }
    const fresh = await googleConnection(env); // may change if the token refresh failed above
    return json({
      backend: { missing_secrets: missingSecrets, usda_key: !!env.USDA_API_KEY },
      google: { connected: fresh.connected, reconnect_needed: fresh.reconnectNeeded },
      sheet,
    });
  }

  if (method === 'POST' && path === '/oauth/google/start') {
    const { token } = await signToken(env.SESSION_SECRET!, 'oauth_state', STATE_TTL_SEC);
    return json({ url: buildAuthUrl(env, redirectUri(request.url), token) });
  }

  if (method === 'POST' && path === '/oauth/google/disconnect') {
    await disconnectGoogle(env);
    return json({ ok: true });
  }

  if (method === 'POST' && path === '/sheet/setup') {
    const body = await readJson<{ create_new?: unknown }>(request);
    const token = await getAccessToken(env);
    const existingId = await env.PLATES_KV.get(KV_KEYS.spreadsheetId);
    if (existingId && body.create_new !== true) {
      const sheets = new Sheets(token, existingId);
      try {
        const meta = await sheets.meta();
        const result = await sheets.ensureSchema();
        return json({ created: false, spreadsheet_id: existingId, url: meta.url, ...result });
      } catch (err) {
        if (err instanceof HttpError && err.code === 'sheet_not_found') {
          throw new HttpError(409, 'sheet_missing', 'Your saved Plates spreadsheet is gone (deleted or in trash). Restore it from Drive trash, or create a new one.');
        }
        throw err;
      }
    }
    const created = await Sheets.create(token, 'Plates');
    await env.PLATES_KV.put(KV_KEYS.spreadsheetId, created.spreadsheetId);
    return json({ created: true, spreadsheet_id: created.spreadsheetId, url: created.url, addedTabs: [], addedColumns: [], problems: [] });
  }

  if (method === 'GET' && path === '/sheet/settings') {
    const stored = await (await sheetFor(env)).readSettings();
    return json({ settings: { ...SETTINGS_DEFAULTS, ...stored } });
  }

  if (method === 'PUT' && path === '/sheet/settings') {
    const body = await readJson<{ settings?: unknown }>(request);
    if (!body.settings || typeof body.settings !== 'object' || Array.isArray(body.settings)) {
      throw new HttpError(400, 'bad_settings', 'settings must be an object');
    }
    const v = validateSettings(body.settings as Record<string, unknown>);
    if (!v.ok) throw new HttpError(400, 'invalid_settings', 'Some settings are not valid', { fields: v.errors });
    const sheets = await sheetFor(env);
    await sheets.upsertSettings(v.clean);
    const stored = await sheets.readSettings();
    return json({ settings: { ...SETTINGS_DEFAULTS, ...stored } });
  }

  if (method === 'POST' && path === '/sheet/read') {
    const body = await readJson<{ tabs?: unknown; filters?: unknown; include_deleted?: unknown }>(request);
    const tabs = Array.isArray(body.tabs) ? body.tabs : [];
    if (!tabs.length || !tabs.every(isTabName)) throw new HttpError(400, 'bad_tabs', 'tabs must list known tab names');
    const filters = (body.filters && typeof body.filters === 'object' ? body.filters : {}) as Record<string, Filters>;
    const parsed = await (await sheetFor(env)).readTabs(tabs as TabName[]);
    const data = Object.fromEntries(Object.entries(parsed).map(([t, p]) => [
      t,
      applyFilters(p.rows.map((r) => r.data), filters[t], body.include_deleted === true),
    ]));
    return json({ data });
  }

  if (method === 'POST' && path === '/sheet/upsert') {
    const body = await readJson<{ tab?: unknown; key?: unknown; rows?: unknown }>(request);
    if (!isTabName(body.tab)) throw new HttpError(400, 'bad_tab', 'Unknown tab');
    if (body.tab === 'Settings') throw new HttpError(400, 'use_settings_endpoint', 'Use PUT /sheet/settings for settings');
    const key = typeof body.key === 'string' ? body.key : '';
    if (!key || key === 'id' || !(TABS[body.tab] as readonly string[]).includes(key)) {
      throw new HttpError(400, 'bad_key', 'key must be a column of the tab (not id)');
    }
    const rows = validateRows(body.tab, body.rows, false);
    if (rows.some((r) => r[key] === undefined || r[key] === '')) throw new HttpError(400, 'missing_key', `Every row needs ${key}`);
    const saved = await (await sheetFor(env)).upsertBy(body.tab, key, rows);
    return json({ rows: saved });
  }

  // ---------- AI estimates ----------
  if (method === 'GET' && path === '/ai/usage') {
    const u = await monthUsage(await sheetFor(env));
    return json({ month_total: u.total, count: u.count, cap: u.cap, configured: !!env.ANTHROPIC_API_KEY });
  }
  if (method === 'POST' && path === '/ai/meal-scan') {
    const body = await readJson<{ images?: unknown; description?: unknown; context?: unknown }>(request, 7_000_000);
    const images = cleanImages(body.images);
    const context = { ...cleanContext(body.context), hasSide: images.length > 1 };
    const description = typeof body.description === 'string' ? body.description.trim().slice(0, 300) : '';
    return json(await estimate(env, await sheetFor(env), { description, images, context }));
  }
  if (method === 'POST' && path === '/ai/text-estimate') {
    const body = await readJson<{ description?: unknown; context?: unknown }>(request);
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    if (description.length < 3 || description.length > 500) throw new HttpError(400, 'bad_description', 'Describe the food in 3–500 characters.');
    return json(await estimate(env, await sheetFor(env), { description, images: [], context: { ...cleanContext(body.context), hasSide: false } }));
  }

  // ---------- Push notifications ----------
  if (method === 'GET' && path === '/push/key') {
    if (!env.VAPID_PUBLIC_KEY) throw new HttpError(500, 'push_not_configured', 'Notifications are not set up on the backend yet');
    return json({ key: env.VAPID_PUBLIC_KEY });
  }
  if (method === 'POST' && (path === '/push/subscribe' || path === '/push/unsubscribe')) {
    const body = await readJson<{ endpoint?: unknown }>(request);
    if (!validEndpoint(body.endpoint)) throw new HttpError(400, 'bad_endpoint', 'Not a recognised push endpoint');
    if (path === '/push/subscribe') await addSub(env, body.endpoint); else await removeSub(env, body.endpoint);
    return json({ ok: true });
  }
  if (method === 'POST' && path === '/push/rest') {
    const body = await readJson<{ seconds?: unknown }>(request);
    const seconds = Number(body.seconds);
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 1800) throw new HttpError(400, 'bad_seconds', 'seconds must be 0–1800');
    const at = await scheduleRest(env, seconds);
    return json({ ok: true, at: new Date(at).toISOString() });
  }
  if (method === 'POST' && path === '/push/rest/cancel') {
    await cancelRest(env);
    return json({ ok: true });
  }
  if (method === 'POST' && path === '/push/test') {
    return json(await sendToAll(env));
  }

  const barcodeMatch = /^\/food\/barcode\/(\d{8,14})$/.exec(path);
  if (method === 'GET' && barcodeMatch) {
    const check = checkTypedCode(barcodeMatch[1]!);
    if (!check.ok) throw new HttpError(400, 'bad_barcode', check.message);
    return json({ food: await lookupUsdaBarcode(check.code, env.USDA_API_KEY) });
  }

  if (method === 'GET' && path === '/food/search') {
    const q = (url.searchParams.get('q') ?? '').trim();
    const source = url.searchParams.get('source') ?? 'usda';
    if (q.length < 2 || q.length > 100) throw new HttpError(400, 'bad_query', 'Search for 2–100 characters');
    if (source === 'usda') return json({ source, foods: await searchUsda(q, env.USDA_API_KEY) });
    if (source === 'off') return json({ source, foods: await searchOff(q) });
    throw new HttpError(400, 'bad_source', 'source must be usda or off');
  }

  if (method === 'POST' && (path === '/sheet/append' || path === '/sheet/update')) {
    const body = await readJson<{ tab?: unknown; rows?: unknown }>(request);
    if (!isTabName(body.tab)) throw new HttpError(400, 'bad_tab', 'Unknown tab');
    if (body.tab === 'Settings') throw new HttpError(400, 'use_settings_endpoint', 'Use PUT /sheet/settings for settings');
    const isUpdate = path === '/sheet/update';
    const rows = validateRows(body.tab, body.rows, isUpdate);
    const sheets = await sheetFor(env);
    const saved = isUpdate ? await sheets.updateById(body.tab, rows) : await sheets.append(body.tab, rows);
    return json({ rows: saved });
  }

  throw new HttpError(404, 'not_found', 'Not found');
}
