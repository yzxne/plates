// Estimate-accuracy report (brief §6A "later"): do estimated foods under- or over-count, judged by your weight trend?
// Method and caveats: docs/algorithm.md → "Estimate accuracy". Pure functions; nothing here changes your data.

import { addDays, daysBetween, type TrendPoint } from './coaching';
import type { LogEntry } from './nutrition';

export const ACCURACY_SOURCES = ['restaurant', 'cafeteria', 'homemade', 'ai_other', 'calai'] as const;
export type AccuracySource = (typeof ACCURACY_SOURCES)[number];
export const SOURCE_LABELS: Record<AccuracySource, string> = {
  restaurant: 'Restaurant estimates',
  cafeteria: 'Cafeteria estimates',
  homemade: 'Homemade estimates',
  ai_other: 'Other AI estimates',
  calai: 'Cal AI (imported)',
};
/** Settings key holding your chosen correction factor for each source you can still log. */
export const CORRECTION_KEYS: Partial<Record<AccuracySource, string>> = {
  restaurant: 'correction_restaurant',
  cafeteria: 'correction_cafeteria',
  homemade: 'correction_homemade',
};

/** Your chosen correction for an AI estimate source (1 = none). */
export function correctionFor(source: string, settings: Record<string, string>): number {
  const key = CORRECTION_KEYS[source as AccuracySource];
  const f = key ? Number(settings[key]) : 1;
  return Number.isFinite(f) && f >= 0.5 && f <= 2 ? f : 1;
}

/** Which estimate bucket an entry belongs to, or null for weighed / scanned / searched food. */
export function sourceOf(e: Pick<LogEntry, 'entry_method' | 'is_estimate' | 'food_source'>): AccuracySource | null {
  if (e.entry_method.startsWith('import_calai')) return 'calai';
  if (!e.is_estimate) return null;
  if (e.food_source === 'restaurant' || e.food_source === 'cafeteria' || e.food_source === 'homemade') return e.food_source;
  return 'ai_other';
}

export interface DayLog { date: string; kcal: number; est: Partial<Record<AccuracySource, number>> }

export interface Block {
  from: string;
  to: string;
  days: number; // complete days logged
  logged: number; // avg kcal/day
  estimated: number; // avg estimated kcal/day
  bySource: Partial<Record<AccuracySource, number>>; // avg kcal/day
  storage: number; // kcal/day going into (+) or out of (−) body stores, from the trend slope
  impliedBurn: number; // logged − storage (what you burned if the log were exact)
  clean: boolean; // few estimates → used to learn your real burn
  gap?: number; // (reference burn + storage) − logged: kcal/day missing from the log
}

export interface SourceResult { source: AccuracySource; blocks: number; estimatedKcal: number; factor: number | null }

export interface AccuracyReport {
  blocks: Block[];
  reference: number | null; // kcal/day burn used as the yardstick
  referenceFrom: 'regression' | 'formula' | null;
  overall: { factor: number | null; gap: number | null; blocks: number };
  sources: SourceResult[];
  confidence: 'not enough data' | 'rough' | 'fair';
}

export interface AccuracyOptions {
  blockDays?: number; // default 28
  minCompleteDays?: number; // per block, default 14
  minWeighIns?: number; // per block, default 2
  cleanShare?: number; // estimated share below this = clean block, default 0.2
  energyPerLb: number;
  formulaBurn: number | null; // fallback yardstick (resting formula × activity) when there are no clean blocks
}

const round = (n: number, step: number) => Number((Math.round(n / step) * step).toFixed(2));
const clampFactor = (f: number) => Math.min(2, Math.max(0.5, f));

/** Splits history into back-to-back blocks ending today and measures each. */
export function buildBlocks(days: DayLog[], trend: TrendPoint[], until: string, o: AccuracyOptions): Block[] {
  const blockDays = o.blockDays ?? 28;
  const byDate = new Map(days.map((d) => [d.date, d]));
  const trendBy = new Map(trend.map((t) => [t.date, t]));
  const first = [days[0]?.date, trend[0]?.date].filter(Boolean).sort()[0];
  if (!first) return [];
  const out: Block[] = [];
  for (let to = until; addDays(to, -(blockDays - 1)) >= first; to = addDays(to, -blockDays)) {
    const from = addDays(to, -(blockDays - 1));
    const logs: DayLog[] = [];
    let weighIns = 0;
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const x = byDate.get(d);
      if (x && x.kcal > 0) logs.push(x);
      if (trendBy.get(d)?.scale != null) weighIns++;
    }
    const t0 = trendBy.get(addDays(from, -1)) ?? trendBy.get(from);
    const t1 = trendBy.get(to);
    if (logs.length < (o.minCompleteDays ?? 14) || weighIns < (o.minWeighIns ?? 2) || !t0 || !t1) continue;
    const n = logs.length;
    const logged = logs.reduce((s, x) => s + x.kcal, 0) / n;
    const bySource: Partial<Record<AccuracySource, number>> = {};
    for (const x of logs) for (const [k, v] of Object.entries(x.est)) bySource[k as AccuracySource] = (bySource[k as AccuracySource] ?? 0) + (v ?? 0) / n;
    const estimated = Object.values(bySource).reduce((s, v) => s + (v ?? 0), 0);
    const slope = (t1.trend - t0.trend) / Math.max(1, daysBetween(t0.date, t1.date)); // lb/day
    const storage = slope * o.energyPerLb;
    out.push({
      from, to, days: n, logged, estimated, bySource, storage, impliedBurn: logged - storage,
      clean: estimated / logged < (o.cleanShare ?? 0.2),
    });
  }
  return out.reverse();
}

/**
 * Weighted least squares of y = a + b·x. Here y = what you'd have burned if the log were exact (logged − storage)
 * and x = estimated kcal/day. If estimates are off by factor k, then y = burn − (k − 1)·x, so k = 1 − b and a = burn.
 */
function fit(points: { x: number; y: number; w: number }[]): { a: number; b: number } | null {
  const W = points.reduce((s, p) => s + p.w, 0);
  if (!W) return null;
  const mx = points.reduce((s, p) => s + p.w * p.x, 0) / W;
  const my = points.reduce((s, p) => s + p.w * p.y, 0) / W;
  const sxx = points.reduce((s, p) => s + p.w * (p.x - mx) ** 2, 0);
  if (sxx <= 0) return null;
  const b = points.reduce((s, p) => s + p.w * (p.x - mx) * (p.y - my), 0) / sxx;
  return { a: my - b * mx, b };
}

const MIN_SPREAD = 150; // kcal/day difference in estimated food between stretches needed to compare them
const spread = (xs: number[]) => (xs.length ? Math.max(...xs) - Math.min(...xs) : 0);

export function accuracyReport(days: DayLog[], trend: TrendPoint[], until: string, o: AccuracyOptions): AccuracyReport {
  const blocks = buildBlocks(days, trend, until, o);
  const totalDays = blocks.reduce((s, b) => s + b.days, 0);
  const share = totalDays ? blocks.reduce((s, b) => s + (b.estimated / b.logged) * b.days, 0) / totalDays : 0;
  const pts = (x: (b: Block) => number) => blocks.map((b) => ({ x: x(b), y: b.impliedBurn, w: b.days }));

  let reference: number | null = null;
  let referenceFrom: AccuracyReport['referenceFrom'] = null;
  let factor: number | null = null;

  // 1) Compare stretches with more vs fewer estimated calories (works when some food is weighed/scanned).
  const f = blocks.length >= 3 && share <= 0.7 && spread(blocks.map((b) => b.estimated)) >= MIN_SPREAD ? fit(pts((b) => b.estimated)) : null;
  if (f) { reference = f.a; referenceFrom = 'regression'; factor = 1 - f.b; }
  // 2) Nearly everything estimated (e.g. Cal AI history): compare against the resting-rate formula instead.
  else if (blocks.length >= 2 && share > 0.7 && o.formulaBurn) {
    reference = o.formulaBurn;
    referenceFrom = 'formula';
    const e = blocks.reduce((s, b) => s + b.estimated * b.days, 0);
    const g = blocks.reduce((s, b) => s + (o.formulaBurn! + b.storage - b.logged) * b.days, 0);
    factor = e > 0 ? 1 + g / e : null;
  }

  for (const b of blocks) {
    b.clean = b.estimated / b.logged < (o.cleanShare ?? 0.2);
    if (reference != null) b.gap = reference + b.storage - b.logged;
  }
  const est = blocks.filter((b) => b.estimated > 0);
  const overall = {
    blocks: est.length,
    factor: factor == null ? null : round(clampFactor(factor), 0.05),
    gap: reference != null && est.length ? est.reduce((s, b) => s + (b.gap ?? 0) * b.days, 0) / est.reduce((s, b) => s + b.days, 0) : null,
  };

  // Per source: same comparison using only that source's calories (other estimates count as noise).
  const sources: SourceResult[] = ACCURACY_SOURCES.map((source) => {
    const xs = blocks.map((b) => b.bySource[source] ?? 0);
    const estimatedKcal = blocks.reduce((s, b) => s + (b.bySource[source] ?? 0) * b.days, 0);
    let sf: number | null = null;
    if (referenceFrom === 'regression' && blocks.length >= 3 && spread(xs) >= MIN_SPREAD) {
      const r = fit(pts((b) => b.bySource[source] ?? 0));
      if (r) sf = round(clampFactor(1 - r.b), 0.05);
    } else if (referenceFrom === 'formula' && overall.factor != null && estimatedKcal > 0.6 * blocks.reduce((s, b) => s + b.estimated * b.days, 0)) {
      sf = overall.factor; // one source is most of the estimates → the overall result is about it
    }
    return { source, blocks: xs.filter((x) => x > 0).length, estimatedKcal, factor: sf };
  }).filter((s) => s.estimatedKcal > 0);

  const confidence: AccuracyReport['confidence'] = overall.factor == null
    ? 'not enough data'
    : referenceFrom === 'regression' && blocks.length >= 6 && spread(blocks.map((b) => b.estimated)) >= 300 ? 'fair' : 'rough';
  return { blocks, reference, referenceFrom, overall, sources, confidence };
}

/** Applies a correction factor to AI-estimated grams (only when you've chosen one; 1 = off). */
export function correctGrams(grams: number, factor: number): number {
  return factor > 0 && factor !== 1 ? Math.round(grams * factor) : grams;
}
