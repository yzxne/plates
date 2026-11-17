// AI coach summary: a compact, pre-computed digest of the last few weeks that you paste into a Claude chat
// (Claude app → "Plates Coach" project). No AI here: the numbers come from tested code, so the chat only has to explain.
// Setup: docs/coach-prompt.md. Instructions for the chat: shared/coachPrompt.ts. Tests: backend/test/coachSummary.test.ts.
import { addDays, ageOn, constantsFrom, daysBetween, trendSeries, weekdayOf, type StoredCheckIn, type WeightPoint } from './coaching';
import { WEEKDAYS } from './schema';
import { epley1RM, findStall, isWorkingSet, type Workout } from './training';

// ---------- Inputs ----------

export interface CoachDay {
  date: string;
  complete: boolean;
  kcal: number;
  protein_g: number;
  target_kcal: number | null;
  target_protein_g: number | null;
}

/** One food row (FoodLog). Only what the summary needs. */
export interface CoachFood {
  date: string;
  food_name: string;
  entry_method: string;
  servings: number | null;
  kcal: number;
  protein_g: number;
  is_estimate: boolean;
}

export interface CoachInputs {
  today: string; // YYYY-MM-DD (America/Chicago)
  settings: Record<string, string>;
  weights: WeightPoint[];
  days: CoachDay[];
  checkins: StoredCheckIn[]; // any order
  workouts: Workout[]; // finished workouts, any order
  exerciseNames: Map<string, string>;
  food: CoachFood[]; // FoodLog rows for the window (archive rows not needed)
  sleep: { date: string; asleep_min: number; bed_time: string; wake_time: string }[];
  water: { date: string; oz: number }[];
  weeks?: number; // default 4
}

// ---------- Weight outliers ----------

/** Readings more than this far from the median of nearby weigh-ins are treated as mistakes (wrong unit, wrong Health field, typo). */
export const WEIGHT_OUTLIER_PCT = 0.1;

/**
 * Splits weigh-ins into kept and ignored. A reading is ignored when it is > 10 % away from the median of the
 * other weigh-ins within ±21 days (needs at least 2 of them, so a real change after a long gap isn't thrown out).
 */
export function splitWeightOutliers<T extends WeightPoint>(points: T[]): { kept: T[]; outliers: T[] } {
  const kept: T[] = [];
  const outliers: T[] = [];
  points.forEach((p, i) => {
    const near = points
      .filter((q, j) => j !== i && Math.abs(daysBetween(q.date, p.date)) <= 21)
      .map((q) => q.weight_lb)
      .sort((a, b) => a - b);
    if (near.length < 2) { kept.push(p); return; }
    const mid = near.length % 2 ? near[(near.length - 1) / 2]! : (near[near.length / 2 - 1]! + near[near.length / 2]!) / 2;
    (Math.abs(p.weight_lb - mid) / mid > WEIGHT_OUTLIER_PCT ? outliers : kept).push(p);
  });
  return { kept, outliers };
}

// ---------- Helpers ----------

/** Names the Drinks tab logs (entry_method "drink"). The water card also uses "drink" (e.g. Monster), so the name decides. */
const DRINK_NAMES = new Set(['shot', 'beer', 'light beer', 'ipa / craft beer', 'hard seltzer', 'wine', 'mixed drink', 'sweet cocktail']);
const ALCOHOL_RE = /\b(beer|lager|ipa|ale|stout|wine|vodka|whiske?y|bourbon|tequila|rum|gin|liquor|seltzer|margarita|daiquiri|cocktail|shot|white claw|truly)\b/i;
const NOT_ALCOHOL_RE = /\b(root beer|ginger beer|ginger ale|espresso|wheatgrass|monster|soda)\b/i;

/** Drinks-tab pours, or searched foods whose name reads like alcohol ("Beer, light"). */
export function isAlcohol(f: Pick<CoachFood, 'entry_method' | 'food_name'>): boolean {
  const n = f.food_name.trim().toLowerCase();
  if (f.entry_method === 'drink') return DRINK_NAMES.has(n);
  return ALCOHOL_RE.test(n) && !NOT_ALCOHOL_RE.test(n);
}

/** Entries whose numbers are a guess (AI photo/text estimates, pasted AI answers, quick adds without a food). */
const isGuess = (f: CoachFood) => f.is_estimate || ['ai', 'paste_ai', 'quick'].includes(f.entry_method);

const round = (n: number, step = 1) => Math.round(n / step) * step;
const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const r0 = (n: number | null) => (n == null ? null : Math.round(n));
const r1 = (n: number | null) => (n == null ? null : Math.round(n * 10) / 10);

/** Start of the week containing `date`, weeks starting on `startDay` (Mon..Sun). */
function weekStart(date: string, startDay: string): string {
  const want = Math.max(0, WEEKDAYS.indexOf(startDay as (typeof WEEKDAYS)[number]));
  const have = WEEKDAYS.indexOf(weekdayOf(date));
  return addDays(date, -((have - want + 7) % 7));
}

function bestE1rm(w: Workout, exerciseId: string): number {
  let best = 0;
  for (const e of w.exercises) {
    if (e.exercise_id !== exerciseId) continue;
    for (const s of e.sets) if (isWorkingSet(s) && s.weight_lb && s.reps) best = Math.max(best, epley1RM(s.weight_lb, s.reps));
  }
  return best;
}

const PAIN_RE = /\b(pain|hurt|hurts|hurting|ache|aching|sore|tweak|tweaked|injur\w*|discomfort|tendon\w*|strain\w*)\b/i;
const BODY_RE = /\b(elbow|shoulder|knee|back|wrist|hip|neck|ankle|hamstring|groin|chest|bicep|tricep|forearm|tendons?)\b/gi;

// ---------- Output ----------

export interface CoachWeek {
  start: string;
  end: string;
  partial: boolean;
  days_logged: number;
  complete_days: number;
  avg_kcal: number | null;
  avg_target_kcal: number | null;
  avg_protein_g: number | null;
  protein_goal_g: number | null;
  protein_days_hit: number;
  food_source: 'plates' | 'imported totals (Cal AI)' | 'mixed';
  pct_kcal_guessed: number | null;
  alcohol: { drinks: number; kcal: number; days: string[] };
  weigh_ins: number;
  trend_start_lb: number | null;
  trend_end_lb: number | null;
  workouts: { date: string; name: string; minutes: number; working_sets: number }[];
  workouts_planned: number;
  sleep: { nights: number; avg_min: number | null; shortest_min: number | null };
  water: { days: number; avg_oz: number | null };
}

export interface CoachLift {
  exercise: string;
  sessions_in_window: number;
  last_done: string;
  best_e1rm_window: number;
  best_e1rm_before: number | null;
  stalled_since: string | null;
}

export interface CoachNote { date: string; exercise: string | null; text: string }

export interface CoachSummary {
  kind: 'plates-coach-summary';
  version: 1;
  as_of: string;
  window: { from: string; to: string; weeks: number };
  profile: {
    sex: string | null; age: number | null; height_in: number | null;
    goal: string; goal_rate_lb_per_week: number | null; protein_g_per_lb: number | null;
    training_days: string[]; checkin_weekday: string; water_goal_oz: number | null;
  };
  weight: {
    trend_lb: number | null; trend_change_4wk_lb: number | null; last_weigh_in: string | null;
    days_since_weigh_in: number | null; weigh_ins_last_14d: number; ignored_outliers: { date: string; weight_lb: number }[];
  };
  latest_checkin: { date: string; expenditure_kcal: number; confidence: string; trend_lb: number; avg_target_kcal: number; protein_g: number | null; reason: string } | null;
  checkin_history: { date: string; expenditure_kcal: number; avg_target_kcal: number; confidence: string }[];
  weeks: CoachWeek[];
  last_7_days: {
    date: string; kcal: number | null; target: number | null; protein_g: number | null; complete: boolean;
    alcohol_kcal: number; workout: string | null; sleep_min: number | null; weight_lb: number | null;
  }[];
  lifts: CoachLift[];
  pain_notes_120d: CoachNote[];
  recent_notes: CoachNote[];
  flags: string[];
}

// ---------- Builder ----------

export function buildCoachSummary(input: CoachInputs): CoachSummary {
  const { today, settings: s } = input;
  const nWeeks = Math.max(1, Math.min(12, input.weeks ?? 4));
  const startDay = s.checkin_weekday || 'Mon';
  const thisWeek = weekStart(today, startDay);
  const from = addDays(thisWeek, -7 * (nWeeks - 1));
  const archiveThrough = s.archive_through || '';
  const flags: string[] = [];

  // Weight
  const { kept, outliers } = splitWeightOutliers(input.weights.filter((w) => w.weight_lb > 0 && w.date <= today));
  const trend = trendSeries(kept, today, constantsFrom(s).trendAlpha);
  const trendOn = (d: string) => {
    let t: number | null = null;
    for (const p of trend) { if (p.date > d) break; t = p.trend; }
    return t;
  };
  const lastWeigh = kept.map((w) => w.date).sort().at(-1) ?? null;
  const daysSinceWeigh = lastWeigh ? daysBetween(lastWeigh, today) : null;
  const trendNow = trendOn(today);
  const trend4 = trendOn(addDays(today, -28));
  const recentOutliers = outliers.filter((o) => o.date >= addDays(today, -60));
  if (daysSinceWeigh != null && daysSinceWeigh >= 3) flags.push(`No weigh-in for ${daysSinceWeigh} days (last ${lastWeigh}).`);
  if (!lastWeigh) flags.push('No weigh-ins yet.');
  for (const o of recentOutliers) flags.push(`Ignored a weigh-in of ${o.weight_lb} lb on ${o.date} (far from nearby weigh-ins).`);

  // Settings / profile
  const trainingDays = (s.training_days || '').split(',').map((d) => d.trim()).filter(Boolean);
  const proteinPerLb = Number(s.protein_g_per_lb) || null;
  const proteinGoal = proteinPerLb && trendNow ? round(proteinPerLb * trendNow) : null;

  // Check-ins
  const checkins = [...input.checkins].sort((a, b) => a.date.localeCompare(b.date));
  const latest = checkins.at(-1) ?? null;
  const latestProtein = latest ? Object.values(latest.plan)[0]?.protein_g ?? null : null;
  if (latest && proteinGoal && latestProtein && Math.abs(latestProtein - proteinGoal) >= 10) {
    flags.push(`Latest check-in (${latest.date}) set protein to ${latestProtein} g, but Settings now give ${proteinGoal} g (${proteinPerLb} g/lb × trend). The next check-in will use the new value.`);
  }
  const usedRate = latest ? /\b(\d+(?:\.\d+)?) lb\/week\b/.exec(latest.reason)?.[1] : undefined;
  if (latest && usedRate && s.goal_rate_lb_per_week && Math.abs(Number(usedRate) - Number(s.goal_rate_lb_per_week)) > 0.01) {
    flags.push(`Latest check-in used ${usedRate} lb/week, but Settings now say ${s.goal_rate_lb_per_week} lb/week. The next check-in will use the new rate.`);
  }

  // Indexes
  const dayBy = new Map(input.days.map((d) => [d.date, d]));
  const foodIn = (a: string, b: string) => input.food.filter((f) => f.date >= a && f.date <= b);
  const sleepBy = new Map(input.sleep.map((n) => [n.date, n]));
  const workouts = input.workouts.filter((w) => w.end_time).sort((a, b) => a.start_time.localeCompare(b.start_time));
  const name = (id: string) => input.exerciseNames.get(id) ?? 'Unknown exercise';
  const minutes = (w: Workout) => Math.max(0, Math.round((Date.parse(w.end_time) - Date.parse(w.start_time)) / 60000));
  const workingSets = (w: Workout) => w.exercises.reduce((n, e) => n + e.sets.filter((x) => isWorkingSet(x)).length, 0);

  // Weeks
  const weeks: CoachWeek[] = [];
  const suspicious: string[] = [];
  for (let i = 0; i < nWeeks; i++) {
    const start = addDays(from, 7 * i);
    const end = addDays(start, 6);
    const last = end < today ? end : today;
    const dates: string[] = [];
    for (let d = start; d <= last; d = addDays(d, 1)) dates.push(d);
    const ds = dates.map((d) => dayBy.get(d)).filter((d): d is CoachDay => !!d && d.kcal > 0);
    const complete = ds.filter((d) => d.complete);
    for (const d of complete) {
      const floor = d.target_kcal ? d.target_kcal * 0.5 : 1000;
      if (d.kcal < floor) suspicious.push(d.date);
    }
    const goodDays = complete.filter((d) => !suspicious.includes(d.date));
    const food = foodIn(start, last);
    const plateFood = food.filter((f) => f.date > archiveThrough);
    const kcalAll = plateFood.reduce((n, f) => n + f.kcal, 0);
    const kcalGuess = plateFood.filter(isGuess).reduce((n, f) => n + f.kcal, 0);
    const booze = food.filter(isAlcohol);
    const imported = dates.filter((d) => d <= archiveThrough).length;
    const weekWeights = kept.filter((w) => w.date >= start && w.date <= last);
    const wk = workouts.filter((w) => w.date >= start && w.date <= last);
    const nights = dates.map((d) => sleepBy.get(d)).filter((n): n is NonNullable<typeof n> => !!n && n.asleep_min > 0);
    const waterDays = new Map<string, number>();
    for (const w of input.water) if (w.date >= start && w.date <= last) waterDays.set(w.date, (waterDays.get(w.date) ?? 0) + w.oz);
    const targets = goodDays.map((d) => d.target_kcal).filter((t): t is number => !!t);
    weeks.push({
      start, end, partial: end > today,
      days_logged: ds.length,
      complete_days: complete.length,
      avg_kcal: r0(avg(goodDays.map((d) => d.kcal))),
      avg_target_kcal: r0(avg(targets)),
      avg_protein_g: r0(avg(goodDays.map((d) => d.protein_g))),
      protein_goal_g: proteinGoal,
      protein_days_hit: proteinGoal ? goodDays.filter((d) => d.protein_g >= proteinGoal * 0.95).length : 0,
      food_source: imported === 0 ? 'plates' : imported >= dates.length ? 'imported totals (Cal AI)' : 'mixed',
      pct_kcal_guessed: kcalAll > 0 ? Math.round((kcalGuess / kcalAll) * 100) : null,
      alcohol: {
        drinks: round(booze.reduce((n, f) => n + (f.entry_method === 'drink' ? f.servings ?? 1 : 1), 0), 0.5),
        kcal: round(booze.reduce((n, f) => n + f.kcal, 0)),
        days: [...new Set(booze.map((f) => f.date))].sort(),
      },
      weigh_ins: weekWeights.length,
      trend_start_lb: r1(trendOn(addDays(start, -1))),
      trend_end_lb: r1(trendOn(last)),
      workouts: wk.map((w) => ({ date: w.date, name: w.name, minutes: minutes(w), working_sets: workingSets(w) })),
      workouts_planned: trainingDays.length,
      sleep: { nights: nights.length, avg_min: r0(avg(nights.map((n) => n.asleep_min))), shortest_min: nights.length ? Math.min(...nights.map((n) => n.asleep_min)) : null },
      water: { days: waterDays.size, avg_oz: r0(avg([...waterDays.values()])) },
    });
  }
  if (suspicious.length) {
    flags.push(`Days marked complete but logged under half the target (likely partial logs, left out of averages): ${suspicious.join(', ')}.`);
  }
  if (weeks.some((w) => w.food_source !== 'plates')) flags.push(`Food on or before ${archiveThrough} is imported Cal AI daily totals (no item detail, and alcohol was rarely logged then).`);
  if (!input.sleep.some((n) => n.date >= from)) flags.push('No sleep data in this window yet.');
  if (!input.water.some((w) => w.date >= from)) flags.push('No water data in this window yet.');

  // Last 7 days
  const last7: CoachSummary['last_7_days'] = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDays(today, -i);
    const day = dayBy.get(d);
    const ws = kept.filter((w) => w.date === d).map((w) => w.weight_lb);
    const wo = workouts.filter((w) => w.date === d).map((w) => w.name);
    last7.push({
      date: d,
      kcal: day && day.kcal > 0 ? Math.round(day.kcal) : null,
      target: day?.target_kcal ?? null,
      protein_g: day && day.kcal > 0 ? Math.round(day.protein_g) : null,
      complete: day?.complete ?? false,
      alcohol_kcal: Math.round(foodIn(d, d).filter(isAlcohol).reduce((n, f) => n + f.kcal, 0)),
      workout: wo.length ? wo.join(' + ') : null,
      sleep_min: sleepBy.get(d)?.asleep_min ?? null,
      weight_lb: ws.length ? r1(avg(ws)) : null,
    });
  }

  // Lifts: every exercise done in the window that gives a 1RM estimate
  const inWindow = workouts.filter((w) => w.date >= from && w.date <= today);
  const ids = [...new Set(inWindow.flatMap((w) => w.exercises.map((e) => e.exercise_id)))];
  const lifts: CoachLift[] = [];
  for (const id of ids) {
    const done = inWindow.filter((w) => w.exercises.some((e) => e.exercise_id === id));
    const bestWin = Math.max(0, ...done.map((w) => bestE1rm(w, id)));
    if (!bestWin) continue;
    const before = Math.max(0, ...workouts.filter((w) => w.date < from).map((w) => bestE1rm(w, id)));
    const stall = findStall(id, workouts, today);
    lifts.push({
      exercise: name(id),
      sessions_in_window: done.length,
      last_done: done.at(-1)!.date,
      best_e1rm_window: Math.round(bestWin),
      best_e1rm_before: before ? Math.round(before) : null,
      stalled_since: stall?.since ?? null,
    });
  }
  lifts.sort((a, b) => b.sessions_in_window - a.sessions_in_window || a.exercise.localeCompare(b.exercise));

  // Notes
  const notes: CoachNote[] = [];
  for (const w of workouts) {
    if (w.notes.trim().length > 2) notes.push({ date: w.date, exercise: null, text: w.notes.trim() });
    for (const e of w.exercises) if (e.note.trim().length > 2) notes.push({ date: w.date, exercise: name(e.exercise_id), text: e.note.trim() });
  }
  const pain = notes.filter((n) => n.date >= addDays(today, -120) && PAIN_RE.test(n.text));
  const recentNotes = notes.filter((n) => n.date >= from).slice(-15);
  const parts = new Map<string, number>();
  for (const n of pain) for (const m of n.text.matchAll(BODY_RE)) parts.set(m[0].toLowerCase(), (parts.get(m[0].toLowerCase()) ?? 0) + 1);
  for (const [part, count] of parts) if (count >= 3) flags.push(`"${part}" comes up in ${count} pain/discomfort notes in the last 120 days.`);

  return {
    kind: 'plates-coach-summary',
    version: 1,
    as_of: today,
    window: { from, to: today, weeks: nWeeks },
    profile: {
      sex: s.sex || null,
      age: s.birth_date ? ageOn(s.birth_date, today) : null,
      height_in: Number(s.height_in) || null,
      goal: s.goal_type || 'maintain',
      goal_rate_lb_per_week: s.goal_type && s.goal_type !== 'maintain' ? Number(s.goal_rate_lb_per_week) || null : null,
      protein_g_per_lb: proteinPerLb,
      training_days: trainingDays,
      checkin_weekday: startDay,
      water_goal_oz: Number(s.water_goal_oz) || null,
    },
    weight: {
      trend_lb: r1(trendNow),
      trend_change_4wk_lb: trendNow != null && trend4 != null ? r1(trendNow - trend4) : null,
      last_weigh_in: lastWeigh,
      days_since_weigh_in: daysSinceWeigh,
      weigh_ins_last_14d: kept.filter((w) => w.date > addDays(today, -14)).length,
      ignored_outliers: recentOutliers.map((o) => ({ date: o.date, weight_lb: o.weight_lb })),
    },
    latest_checkin: latest
      ? { date: latest.date, expenditure_kcal: latest.expenditure, confidence: latest.confidence, trend_lb: latest.trend, avg_target_kcal: latest.avg, protein_g: latestProtein, reason: latest.reason }
      : null,
    checkin_history: checkins.slice(-8).map((c) => ({ date: c.date, expenditure_kcal: c.expenditure, avg_target_kcal: c.avg, confidence: c.confidence })),
    weeks,
    last_7_days: last7,
    lifts: lifts.slice(0, 20),
    pain_notes_120d: pain.slice(-15),
    recent_notes: recentNotes,
    flags,
  };
}

/** What the "Copy" button puts on the clipboard: a one-line header so the chat knows what it's reading, then the JSON. */
export function coachSummaryText(summary: CoachSummary): string {
  return `Plates coach summary (as of ${summary.as_of}, last ${summary.window.weeks} weeks). Numbers are computed by the app; field meanings are in your project instructions.\n\n${JSON.stringify(summary)}`;
}
