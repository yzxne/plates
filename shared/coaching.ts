// Coaching math (brief §7). Every constant is a Setting with a default; see docs/algorithm.md for sources.
import { WEEKDAYS } from './schema';

export const LB_PER_KG = 2.2046226218;
export const CM_PER_IN = 2.54;

export interface CoachConstants {
  trendAlpha: number; // EWMA smoothing per day
  energyPerLb: number; // kcal per lb of body-weight change
  windowDays: number; // expenditure look-back
  maxChange: number; // max change in average daily target between check-ins (kcal/day)
  trainingShiftPct: number; // training days get this % more than the daily average
  fatPct: number; // fat as % of calories (never below the fat minimum)
  minCalories: number; // safety floor for any day's target
}

export const DEFAULT_CONSTANTS: CoachConstants = {
  trendAlpha: 0.1,
  energyPerLb: 2700,
  windowDays: 21,
  maxChange: 150,
  trainingShiftPct: 10,
  fatPct: 25,
  minCalories: 1200,
};

export function constantsFrom(s: Record<string, string>): CoachConstants {
  const n = (k: string, d: number) => { const v = Number(s[k]); return s[k] !== undefined && s[k] !== '' && Number.isFinite(v) ? v : d; };
  return {
    trendAlpha: n('trend_alpha', DEFAULT_CONSTANTS.trendAlpha),
    energyPerLb: n('energy_per_lb', DEFAULT_CONSTANTS.energyPerLb),
    windowDays: n('expenditure_window_days', DEFAULT_CONSTANTS.windowDays),
    maxChange: n('max_target_change', DEFAULT_CONSTANTS.maxChange),
    trainingShiftPct: n('training_day_shift_pct', DEFAULT_CONSTANTS.trainingShiftPct),
    fatPct: n('fat_pct', DEFAULT_CONSTANTS.fatPct),
    minCalories: n('min_calories', DEFAULT_CONSTANTS.minCalories),
  };
}

// ---------- Dates ----------

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}
export function weekdayOf(date: string): (typeof WEEKDAYS)[number] {
  return WEEKDAYS[(new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7]!;
}

// ---------- 1. Initial expenditure ----------

export function ageOn(birthDate: string, date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return null;
  const [by, bm, bd] = birthDate.split('-').map(Number) as [number, number, number];
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

/** Mifflin–St Jeor resting energy (kcal/day). Men: 10·kg + 6.25·cm − 5·age + 5; women: same − 161. */
export function mifflinStJeor(sex: 'male' | 'female', weightLb: number, heightIn: number, age: number): number {
  const kg = weightLb / LB_PER_KG;
  const cm = heightIn * CM_PER_IN;
  return 10 * kg + 6.25 * cm - 5 * age + (sex === 'male' ? 5 : -161);
}

export function initialExpenditure(s: Record<string, string>, weightLb: number | null, date: string): number | null {
  const sex = s.sex === 'male' || s.sex === 'female' ? s.sex : null;
  const height = Number(s.height_in);
  const age = ageOn(s.birth_date ?? '', date);
  const mult = Number(s.activity_multiplier) || 1.375;
  if (!sex || !(height > 0) || age == null || !(weightLb && weightLb > 0)) return null;
  return mifflinStJeor(sex, weightLb, height, age) * mult;
}

// ---------- 2. Trend weight ----------

export interface WeightPoint { date: string; weight_lb: number }
export interface TrendPoint { date: string; trend: number; scale: number | null }

/**
 * Daily trend weight (exponentially weighted moving average) from the first weigh-in to `until`.
 * Several weigh-ins on one day are averaged. A gap of g days moves the trend by 1 − (1 − α)^g of the
 * difference, so missing days neither stall nor overshoot it. Days without a weigh-in keep the trend.
 */
export function trendSeries(points: WeightPoint[], until: string, alpha = DEFAULT_CONSTANTS.trendAlpha): TrendPoint[] {
  const byDay = new Map<string, number[]>();
  for (const p of points) {
    if (!(p.weight_lb > 0)) continue;
    (byDay.get(p.date) ?? byDay.set(p.date, []).get(p.date)!).push(p.weight_lb);
  }
  const days = [...byDay.keys()].sort();
  if (!days.length) return [];
  const out: TrendPoint[] = [];
  let trend = avg(byDay.get(days[0]!)!);
  let lastDate = days[0]!;
  for (let date = days[0]!; date <= until; date = addDays(date, 1)) {
    const ws = byDay.get(date);
    let scale: number | null = null;
    if (ws) {
      scale = avg(ws);
      const gap = Math.max(1, daysBetween(lastDate, date));
      if (date !== days[0]) trend += (1 - (1 - alpha) ** gap) * (scale - trend);
      lastDate = date;
    }
    out.push({ date, trend, scale });
  }
  return out;
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

// ---------- 3. Expenditure ----------

export interface DayIntake { date: string; kcal: number; complete: boolean }
export type Confidence = 'low data' | 'settling' | 'stable';
export interface ExpenditurePoint { date: string; kcal: number; dataKcal: number | null; weight: number; confidence: Confidence }

/**
 * Expenditure for the window ending on `date`:
 *   data = average intake on complete days − (trend slope in lb/day × energy per lb)
 *   estimate = weight·data + (1 − weight)·prior, weight = min(1, completeDays/14) × min(1, weighInDays/10)
 * The data estimate needs ≥ 7 complete days and weigh-ins spanning ≥ 7 days; otherwise the prior is used.
 */
export function expenditureOn(
  date: string, intake: DayIntake[], trend: TrendPoint[], prior: number, c: CoachConstants = DEFAULT_CONSTANTS,
): ExpenditurePoint {
  const start = addDays(date, -(c.windowDays - 1));
  const complete = intake.filter((d) => d.complete && d.date >= start && d.date <= date && d.kcal > 0);
  const tr = trend.filter((t) => t.date >= start && t.date <= date);
  const weighIns = tr.filter((t) => t.scale != null);
  let dataKcal: number | null = null;
  if (complete.length >= 7 && weighIns.length >= 2 && daysBetween(weighIns[0]!.date, weighIns.at(-1)!.date) >= 7) {
    const first = tr[0]!;
    const last = tr.at(-1)!;
    const slope = (last.trend - first.trend) / Math.max(1, daysBetween(first.date, last.date)); // lb/day
    dataKcal = avg(complete.map((d) => d.kcal)) - slope * c.energyPerLb;
    dataKcal = Math.min(6000, Math.max(1000, dataKcal)); // sanity bounds
  }
  const w = dataKcal == null ? 0 : Math.min(1, complete.length / 14) * Math.min(1, weighIns.length / 10);
  const kcal = dataKcal == null ? prior : w * dataKcal + (1 - w) * prior;
  return { date, kcal, dataKcal, weight: w, confidence: w < 0.34 ? 'low data' : w < 0.8 ? 'settling' : 'stable' };
}

// ---------- 4. Weekly targets ----------

export interface DayTarget { kcal: number; protein_g: number; fat_g: number; carbs_g: number; training: boolean }
export type WeekPlan = Record<string, DayTarget>; // keyed Mon..Sun

/** Goal adjustment in kcal/day: lose → negative, gain → positive. */
export function goalDelta(goal: string, rateLbPerWeek: number, c: CoachConstants = DEFAULT_CONSTANTS): number {
  const daily = (Math.max(0, rateLbPerWeek) * c.energyPerLb) / 7;
  return goal === 'lose' ? -daily : goal === 'gain' ? daily : 0;
}

export function macrosFor(kcal: number, weightLb: number, s: Record<string, string>, c: CoachConstants = DEFAULT_CONSTANTS) {
  const protein = Math.round((Number(s.protein_g_per_lb) || 0.8) * weightLb);
  const fatMin = Number(s.fat_min_g) || 0;
  let fat = Math.max(fatMin, Math.round((kcal * c.fatPct) / 100 / 9));
  let carbs = Math.round((kcal - protein * 4 - fat * 9) / 4);
  if (carbs < 0) { // not enough calories: keep protein and the fat minimum, carbs to 0
    fat = Math.max(fatMin, Math.round((kcal - protein * 4) / 9));
    carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  }
  return { protein_g: protein, fat_g: fat, carbs_g: carbs };
}

/** Spreads a weekly budget over 7 days: training days get +shift %, other days share the rest equally. */
export function planWeek(avgKcal: number, trainingDays: string[], weightLb: number, s: Record<string, string>, c: CoachConstants = DEFAULT_CONSTANTS): WeekPlan {
  const T = WEEKDAYS.filter((d) => trainingDays.includes(d)).length;
  const train = T > 0 && T < 7 ? avgKcal * (1 + c.trainingShiftPct / 100) : avgKcal;
  const rest = T > 0 && T < 7 ? (avgKcal * 7 - train * T) / (7 - T) : avgKcal;
  const plan: WeekPlan = {};
  for (const d of WEEKDAYS) {
    const training = trainingDays.includes(d);
    const kcal = Math.round(Math.max(c.minCalories, training ? train : rest) / 10) * 10;
    plan[d] = { kcal, training, ...macrosFor(kcal, weightLb, s, c) };
  }
  return plan;
}

export interface CheckInResult {
  date: string;
  trend_weight_lb: number;
  expenditure_kcal: number;
  confidence: Confidence;
  avg_target_kcal: number;
  weekly_budget_kcal: number;
  plan: WeekPlan;
  reason: string;
}

/** Runs a check-in for `date`. `previousAvg` is the last check-in's average daily target (for the change cap). */
export function runCheckIn(args: {
  date: string; settings: Record<string, string>; trend: TrendPoint[]; intake: DayIntake[];
  initial: number | null; previousExpenditure: number | null; previousAvg: number | null;
}): CheckInResult | null {
  const c = constantsFrom(args.settings);
  const t = [...args.trend].filter((p) => p.date <= args.date).at(-1);
  if (!t) return null; // need at least one weigh-in
  const prior = args.previousExpenditure ?? args.initial;
  if (prior == null) return null; // need profile (sex, birth date, height) or a previous check-in
  const exp = expenditureOn(args.date, args.intake, args.trend, prior, c);
  const goal = args.settings.goal_type ?? 'maintain';
  const rate = Number(args.settings.goal_rate_lb_per_week) || 0;
  const delta = goalDelta(goal, rate, c);
  let target = exp.kcal + delta;
  const notes: string[] = [`Expenditure ${Math.round(exp.kcal)} kcal/day (${exp.confidence}).`];
  if (delta) notes.push(`Goal: ${goal} ${rate} lb/week → ${delta > 0 ? '+' : ''}${Math.round(delta)} kcal/day.`);
  if (args.previousAvg != null) {
    const change = target - args.previousAvg;
    if (Math.abs(change) > c.maxChange) {
      target = args.previousAvg + Math.sign(change) * c.maxChange;
      notes.push(`Change limited to ${change > 0 ? '+' : '−'}${c.maxChange} kcal/day from last week.`);
    } else {
      notes.push(`${change >= 0 ? '+' : '−'}${Math.abs(Math.round(change))} kcal/day vs last week.`);
    }
  } else {
    notes.push('First check-in.');
  }
  target = Math.max(c.minCalories, target);
  const training = (args.settings.training_days ?? '').split(',').filter(Boolean);
  const plan = planWeek(target, training, t.trend, args.settings, c);
  const weekly = Object.values(plan).reduce((s, d) => s + d.kcal, 0);
  return {
    date: args.date,
    trend_weight_lb: Math.round(t.trend * 10) / 10,
    expenditure_kcal: Math.round(exp.kcal),
    confidence: exp.confidence,
    avg_target_kcal: Math.round(weekly / 7),
    weekly_budget_kcal: weekly,
    plan,
    reason: notes.join(' '),
  };
}

/** Most recent check-in day (on or before `date`) for the chosen weekday. */
export function lastCheckInDay(date: string, weekday: string): string {
  let d = date;
  for (let i = 0; i < 7; i++, d = addDays(d, -1)) if (weekdayOf(d) === weekday) return d;
  return date;
}

export function nextCheckInDay(date: string, weekday: string): string {
  let d = addDays(date, 1);
  for (let i = 0; i < 7; i++, d = addDays(d, 1)) if (weekdayOf(d) === weekday) return d;
  return d;
}

export interface StoredCheckIn { date: string; plan: WeekPlan; avg: number; expenditure: number; confidence: string; reason: string; trend: number }

/** Targets for a date: the most recent check-in on or before it. */
export function targetsFor(date: string, checkins: StoredCheckIn[]): DayTarget | null {
  const ci = checkins.filter((c) => c.date <= date).sort((a, b) => b.date.localeCompare(a.date))[0];
  return ci?.plan[weekdayOf(date)] ?? null;
}
