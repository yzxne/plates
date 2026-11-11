// AI estimate contract (brief §6 / §6A). The AI returns item names + grams (+ range, confidence) only;
// calories and macros always come from USDA / saved-food matching, never from the AI.

export const AI_MODEL = 'claude-haiku-5-5';
// Claude Haiku 5.5 list prices for prompts ≤ 100K tokens (checked 2026-11-11, docs/phase0-report.md).
export const AI_PRICE_PER_TOKEN = { input: 0.10 / 1e6, output: 0.50 / 1e6, cacheRead: 0.01 / 1e6, cacheWrite: 0.125 / 1e6 };

export type Confidence = 'low' | 'medium' | 'high';
export type Source = 'restaurant' | 'cafeteria' | 'homemade';
export type Portion = 'small' | 'regular' | 'large' | '';
export type OilLevel = 'light' | 'normal' | 'heavy' | '';

export interface AiItem {
  name: string;
  grams: number;
  grams_low: number;
  grams_high: number;
  confidence: Confidence;
  notes: string;
}

/** JSON schema sent to the API (structured output). */
export const AI_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'grams', 'grams_low', 'grams_high', 'confidence', 'notes'],
        properties: {
          name: { type: 'string', description: 'Generic food name a nutrition database would use, e.g. "white rice, cooked"' },
          grams: { type: 'number', description: 'Best estimate of the edible weight in grams' },
          grams_low: { type: 'number' },
          grams_high: { type: 'number' },
          confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
          notes: { type: 'string', description: 'Short reason, e.g. "mounded, ~3 cm tall"' },
        },
      },
    },
  },
} as const;

export interface AiValidation { ok: boolean; items: AiItem[]; error: string }

/** Validates AI output — from the API or pasted from the Claude/Gemini app (code fences and missing ranges tolerated). */
export function validateAiResult(raw: unknown): AiValidation {
  let data: unknown = raw;
  if (typeof raw === 'string') {
    const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return { ok: false, items: [], error: 'No JSON object found. It should start with { and end with }.' };
    try {
      data = JSON.parse(text.slice(start, end + 1));
    } catch {
      return { ok: false, items: [], error: 'That isn’t valid JSON. Copy the whole answer, including { and }.' };
    }
  }
  const items = (data as { items?: unknown })?.items;
  if (!Array.isArray(items) || items.length === 0) return { ok: false, items: [], error: 'Expected {"items": [...]} with at least one food.' };
  if (items.length > 20) return { ok: false, items: [], error: 'Too many items (max 20).' };
  const out: AiItem[] = [];
  for (const [i, it] of items.entries()) {
    const o = it as Record<string, unknown>;
    const name = typeof o?.name === 'string' ? o.name.trim().slice(0, 120) : '';
    const grams = Number(o?.grams);
    if (!name) return { ok: false, items: [], error: `Item ${i + 1} has no name.` };
    if (!(grams > 0 && grams <= 3000)) return { ok: false, items: [], error: `Item ${i + 1} ("${name}") needs grams between 1 and 3000.` };
    let low = Number(o.grams_low);
    let high = Number(o.grams_high);
    if (!(low > 0) || low > grams) low = Math.round(grams * 0.75);
    if (!(high > 0) || high < grams) high = Math.round(grams * 1.25);
    const conf = o.confidence === 'low' || o.confidence === 'high' ? o.confidence : 'medium';
    out.push({ name, grams: Math.round(grams), grams_low: Math.round(low), grams_high: Math.round(high), confidence: conf, notes: typeof o.notes === 'string' ? o.notes.slice(0, 200) : '' });
  }
  return { ok: true, items: out, error: '' };
}

export interface Usage { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }

export function costUsd(u: Usage): number {
  return u.input_tokens * AI_PRICE_PER_TOKEN.input
    + u.output_tokens * AI_PRICE_PER_TOKEN.output
    + (u.cache_read_input_tokens ?? 0) * AI_PRICE_PER_TOKEN.cacheRead
    + (u.cache_creation_input_tokens ?? 0) * AI_PRICE_PER_TOKEN.cacheWrite;
}

// ---------- Prompt ----------

export interface EstimateContext {
  source: Source | '';
  place: string; // restaurant / cafeteria name
  portion: Portion;
  portionGrams: number | null;
  oil: OilLevel;
  plateIn: number | null; // photo scale reference
  hasSide: boolean;
  knownPortions: { label: string; grams: number }[]; // from Portions tab, for this place
  ingredients: { name: string; grams: number | null }[]; // homemade "list ingredients"
}

export const SYSTEM_PROMPT = [
  'You estimate food portions for a personal nutrition log.',
  'Identify each distinct food and estimate its edible weight in grams. Do NOT estimate calories or macros — another system looks those up.',
  'Name foods the way a nutrition database would (e.g. "chicken breast, grilled", "white rice, cooked", "brown gravy").',
  'Split mixed plates into components; count added fats (oil, butter, dressing, sauce) as their own items when they are significant.',
  'For each item give a best estimate, a realistic low–high range, and your confidence. Keep notes short.',
].join(' ');

const SOURCE_TEXT: Record<Source, string> = {
  restaurant: 'Restaurant food: assume restaurant-size portions and restaurant-level added fat (oil, butter, sauces).',
  cafeteria: 'Dining-hall / cafeteria food: assume standard serving tools (scoop, ladle, spatula portion).',
  homemade: 'Homemade food: assume moderate added fat.',
};

export function contextText(c: EstimateContext): string {
  const lines: string[] = [];
  if (c.source) lines.push(SOURCE_TEXT[c.source] + (c.place ? ` Place: ${c.place}.` : ''));
  if (c.portionGrams) lines.push(`The person says the total portion is about ${c.portionGrams} g.`);
  else if (c.portion) lines.push(`The person says the portion is ${c.portion}.`);
  if (c.oil) lines.push(`Oil/butter level: ${c.oil}.`);
  if (c.plateIn) lines.push(`Scale reference: the plate is ${c.plateIn} inches (${Math.round(c.plateIn * 2.54)} cm) across.`);
  if (c.hasSide) lines.push('Two photos: the first is top-down, the second is from the side (use it for height/volume).');
  if (c.knownPortions.length) {
    lines.push('This person has weighed or estimated these usual portions here — use these grams for matching items:');
    for (const p of c.knownPortions.slice(0, 15)) lines.push(`- ${p.label}: ${p.grams} g`);
  }
  if (c.ingredients.length) {
    lines.push('Ingredients they listed (keep the grams they gave; estimate only the blank ones; return one item per ingredient):');
    for (const i of c.ingredients.slice(0, 20)) lines.push(`- ${i.name}: ${i.grams != null ? `${i.grams} g` : '?'}`);
  }
  return lines.join('\n');
}

/** Prompt to paste into the Claude or Gemini app when the API cap is reached (same output contract). */
export function pastePrompt(description: string, c: EstimateContext): string {
  return [
    SYSTEM_PROMPT,
    description ? `Food: ${description}` : 'Food: see the attached photo(s).',
    contextText(c),
    'Reply with ONLY this JSON, nothing else:',
    '{"items":[{"name":"white rice, cooked","grams":180,"grams_low":140,"grams_high":220,"confidence":"medium","notes":"mounded, ~3 cm tall"}]}',
  ].filter(Boolean).join('\n\n');
}

// ---------- Name matching (portions, saved foods) ----------

const STOP = new Set(['a', 'an', 'the', 'of', 'with', 'and', 'cooked', 'raw', 'scoop', 'cup', 'serving', 'piece', 'slice', '1']);
export function nameTokens(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w))
    .map((w) => w.replace(/(ies)$/, 'y').replace(/(es|s)$/, ''));
}

/** 0–1 similarity: share of the shorter name's words found in the other. */
export function nameScore(a: string, b: string): number {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (!ta.length || !tb.length) return 0;
  const [short, long] = ta.length <= tb.length ? [ta, new Set(tb)] : [tb, new Set(ta)];
  return short.filter((w) => long.has(w)).length / short.length;
}
