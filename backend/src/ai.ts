// Anthropic proxy for AI meal scans and text estimates (brief §6 / §6A).
// The phone never sees the API key. Every call checks the monthly cap first and is logged to AIUsage.
import Anthropic from '@anthropic-ai/sdk';
import {
  AI_MODEL, AI_RESULT_SCHEMA, contextText, costUsd, SYSTEM_PROMPT, validateAiResult, type AiItem, type EstimateContext,
} from '../../shared/ai';
import { chicagoDate } from '../../shared/schema';
import type { Env } from './env';
import { HttpError } from './http';
import type { Sheets } from './sheets';

const MAX_IMAGE_B64 = 3_000_000; // ~2.2 MB per image after base64; the phone sends ~200–400 KB
const MEDIA = new Set(['image/jpeg', 'image/png', 'image/webp']);

export interface ImageIn { data: string; media_type: string }

export async function monthUsage(sheets: Sheets, nowMs = Date.now()): Promise<{ total: number; count: number; cap: number }> {
  const month = chicagoDate(new Date(nowMs)).slice(0, 7);
  const [usage, settings] = await Promise.all([sheets.readTabs(['AIUsage']), sheets.readSettings()]);
  const rows = (usage.AIUsage?.rows ?? []).map((r) => r.data).filter((r) => String(r.date).startsWith(month));
  const total = rows.reduce((s, r) => s + (Number(r.cost_usd) || 0), 0);
  const capSetting = Number(settings.ai_monthly_cap_usd);
  return { total, count: rows.length, cap: Number.isFinite(capSetting) && settings.ai_monthly_cap_usd !== '' ? capSetting : 1 };
}

/** Cleans the context the phone sends (only known fields, bounded sizes). */
export function cleanContext(raw: unknown): EstimateContext {
  const c = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  const num = (v: unknown, lo: number, hi: number) => { const x = Number(v); return Number.isFinite(x) && x >= lo && x <= hi ? x : null; };
  const pick = <T extends string>(v: unknown, allowed: readonly T[]): T | '' => (allowed.includes(v as T) ? (v as T) : '');
  const list = (v: unknown) => (Array.isArray(v) ? v : []);
  return {
    source: pick(c.source, ['restaurant', 'cafeteria', 'homemade'] as const),
    place: str(c.place, 80),
    portion: pick(c.portion, ['small', 'regular', 'large'] as const),
    portionGrams: num(c.portionGrams, 1, 3000),
    oil: pick(c.oil, ['light', 'normal', 'heavy'] as const),
    plateIn: num(c.plateIn, 4, 20),
    hasSide: c.hasSide === true,
    knownPortions: list(c.knownPortions).slice(0, 15).flatMap((p) => {
      const g = num((p as Record<string, unknown>)?.grams, 1, 3000);
      const label = str((p as Record<string, unknown>)?.label, 80);
      return g && label ? [{ label, grams: g }] : [];
    }),
    ingredients: list(c.ingredients).slice(0, 20).flatMap((p) => {
      const name = str((p as Record<string, unknown>)?.name, 80);
      return name ? [{ name, grams: num((p as Record<string, unknown>)?.grams, 1, 3000) }] : [];
    }),
  };
}

export function cleanImages(raw: unknown): ImageIn[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 2) throw new HttpError(400, 'bad_images', 'Send a top-down photo (and optionally a side photo).');
  return raw.map((im, i) => {
    const o = im as Record<string, unknown>;
    if (typeof o?.data !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(o.data.slice(0, 200))) throw new HttpError(400, 'bad_images', `Photo ${i + 1} isn't a valid image.`);
    if (o.data.length > MAX_IMAGE_B64) throw new HttpError(413, 'image_too_large', `Photo ${i + 1} is too large.`);
    if (typeof o.media_type !== 'string' || !MEDIA.has(o.media_type)) throw new HttpError(400, 'bad_images', 'Photos must be JPEG, PNG or WebP.');
    return { data: o.data, media_type: o.media_type };
  });
}

export interface EstimateResult { items: AiItem[]; skipped: string[]; cost_usd: number; month_total: number; cap: number }

/** Calls Claude Haiku 5.5 with structured JSON output, logs usage, returns validated items. */
export async function estimate(env: Env, sheets: Sheets, args: { description: string; images: ImageIn[]; context: EstimateContext }, nowMs = Date.now()): Promise<EstimateResult> {
  if (!env.ANTHROPIC_API_KEY) throw new HttpError(500, 'ai_not_configured', 'The Anthropic API key is not set on the backend yet.');
  const before = await monthUsage(sheets, nowMs);
  if (before.total >= before.cap) {
    throw new HttpError(429, 'ai_cap_reached', `This month's AI cap ($${before.cap.toFixed(2)}) is used up. Use "Paste AI result" instead, or raise the cap in Settings.`, {
      month_total: before.total, cap: before.cap,
    });
  }

  const content: Anthropic.ContentBlockParam[] = [
    ...args.images.map((im): Anthropic.ImageBlockParam => ({
      type: 'image', source: { type: 'base64', media_type: im.media_type as 'image/jpeg', data: im.data },
    })),
    { type: 'text', text: [args.description ? `Food: ${args.description}` : 'Estimate the food in the photo(s).', contextText(args.context)].filter(Boolean).join('\n\n') },
  ];

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 45_000 });
  let msg: Anthropic.Message;
  try {
    msg = await client.messages.create({
      model: AI_MODEL,
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content }],
      output_config: { effort: 'low', format: { type: 'json_schema', schema: AI_RESULT_SCHEMA as unknown as Record<string, unknown> } },
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new HttpError(502, 'ai_key', 'Anthropic rejected the API key. Re-enter it with setup-secrets -- --anthropic.');
    if (err instanceof Anthropic.RateLimitError) throw new HttpError(429, 'ai_rate_limited', 'Anthropic is rate-limiting requests. Try again in a minute.');
    if (err instanceof Anthropic.BadRequestError) {
      const m = String(err.message);
      if (/credit balance/i.test(m)) throw new HttpError(402, 'ai_no_credit', 'Your Anthropic credit balance is empty. Add credit in the Claude Console.');
      throw new HttpError(502, 'ai_bad_request', `Anthropic refused the request: ${m.slice(0, 200)}`);
    }
    if (err instanceof Anthropic.APIError) throw new HttpError(502, 'ai_busy', 'Anthropic is busy or unavailable. Try again shortly.');
    throw err;
  }

  const cost = costUsd(msg.usage);
  await sheets.append('AIUsage', [{
    date: chicagoDate(new Date(nowMs)), request_id: msg.id, model: msg.model,
    input_tokens: msg.usage.input_tokens, output_tokens: msg.usage.output_tokens, cost_usd: Math.round(cost * 1e6) / 1e6,
  }], nowMs);

  if (msg.stop_reason === 'refusal') throw new HttpError(422, 'ai_refused', 'The AI declined this request. Try a different photo or description.');
  if (msg.stop_reason === 'max_tokens') throw new HttpError(502, 'ai_truncated', 'The AI answer was cut off. Try again.');
  const text = msg.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('');
  const v = validateAiResult(text);
  if (!v.ok) throw new HttpError(502, 'ai_bad_output', `The AI answer couldn't be read (${v.error}). Try again or enter it manually.`);
  return { items: v.items, skipped: v.skipped, cost_usd: cost, month_total: before.total + cost, cap: before.cap };
}
