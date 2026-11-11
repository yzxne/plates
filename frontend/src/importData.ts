// Imports from Hevy (CSV) and Cal AI (PDF report): build a preview, then write after you confirm (brief Phase 7).
// Ids are derived from the source data, so running the same import twice skips what's already in the Sheet.
import {
  calAiEntries, csvObjects, mapHevy, mergeWeights, parseCalAi, parseHevyMeasurements, parseHevyWorkouts,
  weightImportId, type ImportedWeight,
} from '../../shared/importers';
import { entryToRow, rowToEntry, totals, type LogEntry } from '../../shared/nutrition';
import type { Row } from '../../shared/schema';
import { exerciseToRow, workoutRows, type Exercise, type Workout } from '../../shared/training';
import { api } from './api';
import { loadCoach } from './coachData';
import { uuid } from './foodData';
import { pdfLines } from './pdfText';
import { getSettings, saveSettings } from './settingsStore';
import { loadExercises, loadHistory } from './trainData';
import { loadWeights } from './weightData';

export interface ImportFile { name: string; kind: 'calai' | 'hevy-workouts' | 'hevy-weights' | 'unknown' }

export interface ImportPlan {
  files: ImportFile[];
  warnings: string[];
  // Food (Cal AI)
  entries: LogEntry[];
  foodDays: number;
  foodRange: [string, string] | null;
  skippedEntries: number; // already imported
  skippedDays: string[]; // already logged in Plates
  exercisesInReport: number;
  // Workouts (Hevy)
  workouts: Workout[];
  sets: number;
  skippedWorkouts: number;
  newExercises: Exercise[];
  matched: Record<string, string>;
  // Weights (both)
  weights: ImportedWeight[];
  skippedWeights: number;
}

export type Progress = (msg: string) => void;

async function readAll(tabs: string[], filters: Record<string, Record<string, string>> = {}): Promise<Record<string, Row[]>> {
  return (await api<{ data: Record<string, Row[]> }>('POST', '/sheet/read', { tabs, filters, include_deleted: true }, 45_000)).data;
}
const live = (rows: Row[] | undefined) => (rows ?? []).filter((r) => !r.deleted_at);

/** Reads the chosen files on this device and works out what would be imported. Nothing is written. */
export async function buildPlan(fileList: File[], progress: Progress): Promise<ImportPlan> {
  const files: ImportFile[] = [];
  const warnings: string[] = [];
  let calai: ReturnType<typeof parseCalAi> | null = null;
  let hevy: ReturnType<typeof parseHevyWorkouts> | null = null;
  const weightLists: ImportedWeight[][] = [];

  for (const f of fileList) {
    if (f.size > 60_000_000) { files.push({ name: f.name, kind: 'unknown' }); warnings.push(`${f.name} is too large.`); continue; }
    if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') {
      progress(`Reading ${f.name}…`);
      const lines = await pdfLines(f, (p, n) => { if (p % 20 === 0 || p === n) progress(`Reading ${f.name}: page ${p} of ${n}`); });
      const parsed = parseCalAi(lines);
      if (!parsed.days.length) { files.push({ name: f.name, kind: 'unknown' }); warnings.push(`${f.name}: no food days found. Only Cal AI "Summary Report" PDFs are supported.`); continue; }
      files.push({ name: f.name, kind: 'calai' });
      calai = parsed;
      warnings.push(...parsed.warnings);
      if (parsed.mismatchedDays.length) warnings.push(`${parsed.mismatchedDays.length} day(s) don't add up to the report's daily total (${parsed.mismatchedDays.slice(0, 3).join(', ')}…). Check them after importing.`);
      weightLists.push(parsed.weights);
      continue;
    }
    const text = await f.text();
    const header = Object.keys(csvObjects(text.split(/\r?\n/).slice(0, 2).join('\n'))[0] ?? {});
    if (header.includes('exercise_title')) {
      hevy = parseHevyWorkouts(text);
      files.push({ name: f.name, kind: 'hevy-workouts' });
      warnings.push(...hevy.warnings);
    } else if (header.includes('weight_lbs') && header.includes('date')) {
      weightLists.push(parseHevyMeasurements(text));
      files.push({ name: f.name, kind: 'hevy-weights' });
    } else {
      files.push({ name: f.name, kind: 'unknown' });
      warnings.push(`${f.name}: not a file Plates knows how to import.`);
    }
  }

  progress('Checking what is already in your Sheet…');
  const entriesAll = calai ? calAiEntries(calai.days, getSettings()) : [];
  const dates = [...new Set(entriesAll.map((e) => e.date))].sort();
  const range = dates.length ? { date__gte: dates[0]!, date__lte: dates[dates.length - 1]! } : null;
  const existing = await readAll(
    ['Weights', ...(hevy ? ['Workouts', 'Exercises'] : []), ...(range ? ['FoodLog', 'FoodArchive'] : [])],
    range ? { FoodLog: range, FoodArchive: range } : {},
  );

  // Food: skip entries already imported, and whole days you already logged in Plates.
  const archiveIds = new Set((existing.FoodArchive ?? []).map((r) => String(r.id)));
  const loggedDays = new Set(live(existing.FoodLog).map((r) => String(r.date)));
  const skippedDays = dates.filter((d) => loggedDays.has(d));
  const fresh = entriesAll.filter((e) => !loggedDays.has(e.date));
  const entries = fresh.filter((e) => !archiveIds.has(e.id));

  // Workouts
  let workouts: Workout[] = [];
  let newExercises: Exercise[] = [];
  let matched: Record<string, string> = {};
  let skippedWorkouts = 0;
  if (hevy) {
    const exercises = live(existing.Exercises).map((r) => ({
      id: String(r.id), name: String(r.name ?? ''), equipment: String(r.equipment ?? ''),
      primary: [], secondary: [], rest_sec: 90, notes: '',
    }));
    const m = mapHevy(hevy, exercises, uuid);
    const ids = new Set((existing.Workouts ?? []).map((r) => String(r.id)));
    // Also skip a workout you already logged in Plates that starts within 10 minutes of the Hevy one.
    const starts = live(existing.Workouts).filter((r) => !String(r.id).startsWith('hevy-')).map((r) => Date.parse(String(r.start_time)));
    workouts = m.workouts.filter((w) => {
      const dup = ids.has(w.id) || starts.some((s) => Math.abs(s - Date.parse(w.start_time)) < 10 * 60_000);
      if (dup) skippedWorkouts++;
      return !dup;
    });
    const used = new Set(workouts.flatMap((w) => w.exercises.map((e) => e.exercise_id)));
    newExercises = m.newExercises.filter((e) => used.has(e.id));
    matched = m.matched;
  }

  // Weights: one per date; skip dates that already have a weigh-in (or were imported before and deleted).
  const weightIds = new Set((existing.Weights ?? []).map((r) => String(r.id)));
  const weightDates = new Set(live(existing.Weights).map((r) => String(r.date)));
  const allWeights = mergeWeights(...weightLists);
  const weights = allWeights.filter((w) => !weightDates.has(w.date) && !weightIds.has(weightImportId(w.date)));

  return {
    files, warnings,
    entries, foodDays: new Set(entries.map((e) => e.date)).size,
    foodRange: entries.length ? [entries[0]!.date, entries[entries.length - 1]!.date] : null,
    skippedEntries: fresh.length - entries.length, skippedDays, exercisesInReport: calai?.exercises ?? 0,
    workouts, sets: workouts.reduce((n, w) => n + w.exercises.reduce((k, e) => k + e.sets.length, 0), 0),
    skippedWorkouts, newExercises, matched,
    weights, skippedWeights: allWeights.length - weights.length,
  };
}

export const planIsEmpty = (p: ImportPlan) => !p.entries.length && !p.workouts.length && !p.weights.length;

const CHUNK = 400;

async function appendAll(tab: string, rows: Row[], label: string, progress: Progress): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    progress(`${label}: ${Math.min(i + CHUNK, rows.length)} of ${rows.length}`);
    await api('POST', '/sheet/append', { tab, rows: rows.slice(i, i + CHUNK) }, 60_000);
  }
}

/**
 * Writes the plan. Order: exercises → sets → workouts → food → day totals → weights.
 * If something fails part-way, running the same import again picks up where it stopped.
 */
export async function applyPlan(plan: ImportPlan, progress: Progress): Promise<void> {
  if (plan.newExercises.length) await appendAll('Exercises', plan.newExercises.map(exerciseToRow), 'Exercises', progress);
  if (plan.workouts.length) {
    const rows = plan.workouts.map(workoutRows);
    const setIds = new Set((await readAll(['Sets'])).Sets?.map((r) => String(r.id)) ?? []);
    await appendAll('Sets', rows.flatMap((r) => r.sets).filter((s) => !setIds.has(String(s.id))), 'Workout sets', progress);
    await appendAll('Workouts', rows.map((r) => r.workout), 'Workouts', progress);
  }
  if (plan.entries.length) {
    await appendAll('FoodArchive', plan.entries.map(entryToRow), 'Food entries', progress);
    // Day totals (from everything now archived for those dates) so coaching and charts count these days.
    const [from, to] = plan.foodRange!;
    const archived = live((await readAll(['FoodArchive'], { FoodArchive: { date__gte: from, date__lte: to } })).FoodArchive).map(rowToEntry);
    const touched = new Set(plan.entries.map((e) => e.date));
    const byDate = new Map<string, LogEntry[]>();
    for (const e of archived) if (touched.has(e.date)) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);
    const days: Row[] = [...byDate].map(([date, list]) => {
      const t = totals(list);
      return { date, day_complete: true, total_kcal: t.kcal, total_protein_g: t.protein_g, total_carbs_g: t.carbs_g, total_fat_g: t.fat_g };
    });
    for (let i = 0; i < days.length; i += CHUNK) {
      progress(`Day totals: ${Math.min(i + CHUNK, days.length)} of ${days.length}`);
      await api('POST', '/sheet/upsert', { tab: 'Days', key: 'date', rows: days.slice(i, i + CHUNK) }, 60_000);
    }
    const last = plan.foodRange![1];
    const through = getSettings().archive_through ?? '';
    if (last > through) await saveSettings({ archive_through: last });
  }
  if (plan.weights.length) {
    await appendAll('Weights', plan.weights.map((w) => ({
      id: weightImportId(w.date), date: w.date, time: '', weight_lb: w.weight_lb,
      body_fat_pct: w.body_fat_pct ?? '', notes: `Imported from ${w.source}`,
    })), 'Weigh-ins', progress);
  }
  progress('Refreshing…');
  await Promise.allSettled([loadExercises(true), loadHistory(true), loadWeights(true), loadCoach(true)]);
}
