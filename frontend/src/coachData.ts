// Coaching data: weigh-ins, daily intake, check-ins; runs the weekly check-in automatically.
import {
  addDays, constantsFrom, expenditureOn, initialExpenditure, lastCheckInDay, runCheckIn, targetsFor, trendSeries,
  type DayIntake, type DayTarget, type ExpenditurePoint, type StoredCheckIn, type TrendPoint, type WeightPoint,
} from '../../shared/coaching';
import type { Row } from '../../shared/schema';
import { today } from './dates';
import { readTabs, uuid, write } from './foodData';
import { getSettings } from './settingsStore';

export interface CoachData {
  weights: WeightPoint[];
  intake: DayIntake[];
  dayTargets: Map<string, { kcal: number; protein_g: number; fat_g: number; carbs_g: number }>; // saved on Days rows
  macros: Map<string, { protein_g: number; fat_g: number; carbs_g: number }>; // eaten, from Days totals
  checkins: StoredCheckIn[];
  trend: TrendPoint[];
  initial: number | null;
}

let cache: CoachData | null = null;
let loading: Promise<CoachData> | null = null;
type Listener = (d: CoachData) => void;
const listeners = new Set<Listener>();

export function subscribeCoach(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function cachedCoach(): CoachData | null {
  return cache;
}

function rowToCheckIn(r: Row): StoredCheckIn {
  let plan = {};
  try { plan = JSON.parse(String(r.day_targets_json || '{}')); } catch { plan = {}; }
  return {
    date: String(r.date), plan, avg: Math.round(Number(r.weekly_budget_kcal) / 7), expenditure: Number(r.expenditure_kcal),
    confidence: String(r.confidence ?? ''), reason: String(r.reason ?? ''), trend: Number(r.trend_weight_lb),
  };
}

export function loadCoach(force = false): Promise<CoachData> {
  if (cache && !force) return Promise.resolve(cache);
  loading ??= readTabs(['Weights', 'Days', 'CheckIns'])
    .then((d) => {
      const s = getSettings();
      const weights = (d.Weights ?? []).map((r) => ({ date: String(r.date), weight_lb: Number(r.weight_lb) })).filter((w) => w.weight_lb > 0);
      const intake: DayIntake[] = (d.Days ?? []).map((r) => ({
        date: String(r.date), kcal: Number(r.total_kcal) || 0, complete: r.day_complete === true || r.day_complete === 'TRUE',
      })).sort((a, b) => a.date.localeCompare(b.date));
      const dayTargets = new Map<string, { kcal: number; protein_g: number; fat_g: number; carbs_g: number }>();
      for (const r of d.Days ?? []) {
        if (Number(r.target_kcal) > 0) {
          dayTargets.set(String(r.date), { kcal: Number(r.target_kcal), protein_g: Number(r.target_protein_g), fat_g: Number(r.target_fat_g), carbs_g: Number(r.target_carbs_g) });
        }
      }
      const macros = new Map<string, { protein_g: number; fat_g: number; carbs_g: number }>();
      for (const r of d.Days ?? []) {
        macros.set(String(r.date), { protein_g: Number(r.total_protein_g) || 0, fat_g: Number(r.total_fat_g) || 0, carbs_g: Number(r.total_carbs_g) || 0 });
      }
      const checkins = (d.CheckIns ?? []).map(rowToCheckIn).sort((a, b) => a.date.localeCompare(b.date));
      const trend = trendSeries(weights, today(), constantsFrom(s).trendAlpha);
      const firstTrend = trend[0]?.trend ?? null;
      cache = { weights, intake, dayTargets, macros, checkins, trend, initial: initialExpenditure(s, firstTrend, today()) };
      for (const fn of listeners) fn(cache);
      return cache;
    })
    .finally(() => { loading = null; });
  return loading;
}

export function targetsForDate(date: string): DayTarget | null {
  return cache ? targetsFor(date, cache.checkins) : null;
}

/** Expenditure for each day in [from, today] (blended estimate). */
export function expenditureSeries(from: string): ExpenditurePoint[] {
  if (!cache) return [];
  const c = constantsFrom(getSettings());
  const out: ExpenditurePoint[] = [];
  const firstData = cache.trend[0]?.date;
  if (!firstData) return out;
  const prior = cache.initial ?? cache.checkins[0]?.expenditure ?? null;
  if (prior == null) return out;
  for (let d = from < firstData ? firstData : from; d <= today(); d = addDays(d, 1)) {
    out.push(expenditureOn(addDays(d, -1), cache.intake.filter((x) => x.date < d), cache.trend, prior, c));
    out[out.length - 1]!.date = d;
  }
  return out;
}

export type CheckInOutcome = { ran: true; date: string; avg: number; reason: string } | { ran: false; why: string };

/**
 * Runs the weekly check-in if one is due: on the chosen weekday (or later that week if the app wasn't opened),
 * and once right away when there's none yet. Saves to CheckIns. `force` re-runs it for today.
 */
export async function ensureCheckIn(force = false): Promise<CheckInOutcome> {
  const s = getSettings();
  if (s.setup_complete !== 'true') return { ran: false, why: 'Setup not finished' };
  const data = await loadCoach(true);
  const t = today();
  const latest = data.checkins.at(-1);
  const due = !latest ? t : lastCheckInDay(t, s.checkin_weekday || 'Mon');
  if (!force && latest && latest.date >= due) return { ran: false, why: 'Not due' };
  const date = force ? t : due;
  const r = runCheckIn({
    date,
    settings: s,
    trend: data.trend.filter((p) => p.date <= date),
    intake: data.intake.filter((d) => d.date < date), // the check-in day itself isn't finished yet
    initial: initialExpenditure(s, data.trend.filter((p) => p.date <= date).at(-1)?.trend ?? null, date),
    previousExpenditure: latest && latest.date < date ? latest.expenditure : data.checkins.filter((c) => c.date < date).at(-1)?.expenditure ?? null,
    previousAvg: data.checkins.filter((c) => c.date < date).at(-1)?.avg ?? null,
  });
  if (!r) {
    return { ran: false, why: data.weights.length ? 'Add sex, birth date and height in Settings to get targets.' : 'Log a weigh-in to get your first targets.' };
  }
  const existing = data.checkins.find((c) => c.date === date);
  const row = {
    date: r.date, trend_weight_lb: r.trend_weight_lb, expenditure_kcal: r.expenditure_kcal, confidence: r.confidence,
    weekly_budget_kcal: r.weekly_budget_kcal, day_targets_json: JSON.stringify(r.plan), reason: r.reason,
  };
  if (existing) await write('/sheet/upsert', { tab: 'CheckIns', key: 'date', rows: [row] }, `Check-in ${date}`);
  else await write('/sheet/append', { tab: 'CheckIns', rows: [{ id: uuid(), ...row }] }, `Check-in ${date}`);
  await loadCoach(true);
  return { ran: true, date, avg: r.avg_target_kcal, reason: r.reason };
}
