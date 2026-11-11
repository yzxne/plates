// Parsers + mappers for importing other apps' exports (brief Phase 7). Pure functions, no network.
// Formats were checked against real sample files (Hevy CSV, Cal AI PDF report) — see docs/imports.md.

import { mealForMinutes } from './schema';
import type { LogEntry, Nutrients } from './nutrition';
import type { Exercise, SetType, Workout, WorkoutExercise } from './training';
import { APP_TIMEZONE } from './schema';

// ---------- Helpers ----------

/** Stable short hash (cyrb53) → hex. Used for import ids, so importing the same file twice finds the same rows. */
export function stableHash(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

/** RFC 4180 CSV → rows of strings (quoted fields, "" escapes, newlines inside quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** CSV with a header row → objects keyed by header. */
export function csvObjects(text: string): Record<string, string>[] {
  const [header, ...rows] = parseCsv(text);
  if (!header) return [];
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = (n: number) => String(n).padStart(2, '0');

/** "10 Nov 2026, 15:31" or "November 10, 2026" → { date: '2026-11-10', time: '15:31' }. */
export function parseLooseDate(s: string): { date: string; time: string } | null {
  let m = /^(\d{1,2}) ([A-Za-z]{3})[a-z]* (\d{4})(?:,? (\d{1,2}):(\d{2}))?$/.exec(s.trim());
  let y: number; let mo: number; let d: number; let time = '';
  if (m) {
    d = Number(m[1]); mo = MONTHS.indexOf(m[2]!.toLowerCase()) + 1; y = Number(m[3]);
    if (m[4]) time = `${pad(Number(m[4]))}:${m[5]}`;
  } else {
    m = /^([A-Za-z]{3})[a-z]* (\d{1,2}), (\d{4})$/.exec(s.trim());
    if (!m) return null;
    mo = MONTHS.indexOf(m[1]!.toLowerCase()) + 1; d = Number(m[2]); y = Number(m[3]);
  }
  if (mo < 1 || d < 1 || d > 31) return null;
  return { date: `${y}-${pad(mo)}-${pad(d)}`, time };
}

/** "3:12pm" → minutes since midnight. */
export function minutesFrom12h(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})\s*([ap])m$/i.exec(t.trim());
  if (!m) return null;
  const h = Number(m[1]) % 12 + (m[3]!.toLowerCase() === 'p' ? 12 : 0);
  return h * 60 + Number(m[2]);
}

function tzOffsetMin(at: Date): number {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIMEZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!, +parts.second!);
  return Math.round((asUtc - at.getTime()) / 60000);
}

/** Local America/Chicago date + "HH:MM" → ISO instant (handles daylight saving). */
export function chicagoIso(date: string, time: string): string {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  const [h, mi] = (time || '00:00').split(':').map(Number) as [number, number];
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let t = guess - tzOffsetMin(new Date(guess)) * 60000;
  const off2 = tzOffsetMin(new Date(t));
  t = guess - off2 * 60000;
  return new Date(t).toISOString();
}

const numOrNull = (v: string | undefined): number | null => {
  if (v == null || v.trim() === '') return null;
  const n = Number(v.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

// ---------- Weights ----------

export interface ImportedWeight { date: string; weight_lb: number; body_fat_pct: number | null; source: string }

/** Hevy measurement_data.csv → weigh-ins (rows without a weight are skipped). */
export function parseHevyMeasurements(csv: string): ImportedWeight[] {
  const out: ImportedWeight[] = [];
  for (const r of csvObjects(csv)) {
    const d = parseLooseDate(r.date ?? '');
    const w = numOrNull(r.weight_lbs);
    if (!d || !w || w < 50 || w > 700) continue;
    out.push({ date: d.date, weight_lb: Math.round(w * 10) / 10, body_fat_pct: numOrNull(r.fat_percent), source: 'Hevy' });
  }
  return out;
}

/** One weigh-in per date: first source wins (later duplicates dropped). */
export function mergeWeights(...lists: ImportedWeight[][]): ImportedWeight[] {
  const byDate = new Map<string, ImportedWeight>();
  for (const list of lists) for (const w of list) if (!byDate.has(w.date)) byDate.set(w.date, w);
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export const weightImportId = (date: string) => `import-w-${date}`;

// ---------- Hevy workouts ----------

export interface HevyParse {
  workouts: { title: string; start: string; end: string; description: string; exercises: { name: string; notes: string; sets: { type: SetType; weight_lb: number | null; reps: number | null; rpe: number | null }[] }[] }[];
  skippedSets: number; // sets with only distance/time (no weight or reps)
  warnings: string[];
}

const HEVY_COLUMNS = ['title', 'start_time', 'end_time', 'exercise_title', 'set_index', 'set_type', 'weight_lbs', 'reps'];
const hevySetType = (t: string): SetType => (t === 'warmup' ? 'W' : t === 'failure' ? 'F' : 'N');
const unescapeNotes = (s: string) => s.replace(/\\n/g, '\n').trim();

export function parseHevyWorkouts(csv: string): HevyParse {
  const rows = csvObjects(csv);
  const warnings: string[] = [];
  if (!rows.length) return { workouts: [], skippedSets: 0, warnings: ['The file has no rows.'] };
  const missing = HEVY_COLUMNS.filter((c) => !(c in rows[0]!));
  if (missing.length) {
    return { workouts: [], skippedSets: 0, warnings: [`This doesn't look like a Hevy workout export (missing: ${missing.join(', ')}).`] };
  }
  if ('weight_kg' in rows[0]! && !('weight_lbs' in rows[0]!)) warnings.push('Weights are in kg; Plates uses lb.');
  const out: HevyParse['workouts'] = [];
  const byKey = new Map<string, HevyParse['workouts'][number]>();
  let skippedSets = 0;
  let lastExerciseKey = '';
  for (const r of rows) {
    const key = `${r.start_time}|${r.title}`;
    let w = byKey.get(key);
    if (!w) {
      w = { title: r.title || 'Workout', start: r.start_time!, end: r.end_time!, description: unescapeNotes(r.description ?? ''), exercises: [] };
      byKey.set(key, w);
      out.push(w);
      lastExerciseKey = '';
    }
    const exKey = `${key}|${r.exercise_title}`;
    let ex = w.exercises[w.exercises.length - 1];
    if (!ex || lastExerciseKey !== exKey) {
      ex = { name: r.exercise_title || 'Exercise', notes: unescapeNotes(r.exercise_notes ?? ''), sets: [] };
      w.exercises.push(ex);
      lastExerciseKey = exKey;
    }
    const weight = numOrNull(r.weight_lbs);
    const reps = numOrNull(r.reps);
    if (weight == null && reps == null) { skippedSets++; continue; }
    ex.sets.push({ type: hevySetType(r.set_type ?? ''), weight_lb: weight, reps, rpe: numOrNull(r.rpe) });
  }
  for (const w of out) w.exercises = w.exercises.filter((e) => e.sets.length);
  if (skippedSets) warnings.push(`${skippedSets} cardio/timed set(s) have no weight or reps and are skipped.`);
  return { workouts: out.filter((w) => w.exercises.length), skippedSets, warnings };
}

const norm = (s: string) => s.toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
const fullNorm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const EQUIPMENT_WORDS: [RegExp, string][] = [
  [/barbell|ez bar|w.?bar|trap bar/i, 'Barbell'], [/dumbbell/i, 'Dumbbell'], [/cable/i, 'Cable'],
  [/machine|smith|sled|plate loaded|pec deck|t.?bar/i, 'Machine'], [/kettlebell/i, 'Kettlebell'], [/band/i, 'Band'],
  [/bodyweight|weighted|assisted|parallel bars|pull.?up|chin.?up|dip|push.?up|plank|leg raise/i, 'Bodyweight'],
];

const MUSCLE_RULES: [RegExp, string][] = [
  [/leg raise|knee raise|crunch|plank|sit.?up|\babs?\b|ab wheel|russian twist|pallof|dead bug|core/i, 'Abs'],
  [/chest dip/i, 'Chest'],
  [/jm press/i, 'Triceps'],
  [/calf/i, 'Calves'],
  [/leg curl|hamstring|romanian|\brdl\b|good morning|nordic/i, 'Hamstrings'],
  [/hip thrust|glute|abduct|kickback.*(cable|machine)?.*glute/i, 'Glutes'],
  [/leg extension|squat|leg press|lunge|hack|split squat|step.?up|adduct/i, 'Quads'],
  [/shrug/i, 'Traps'],
  [/tricep|pushdown|push down|skull|kickback|close.?grip bench|\bdips?\b/i, 'Triceps'],
  [/lateral raise|rear delt|reverse fly|face pull|shoulder press|overhead press|military|upright row|front raise|arnold/i, 'Shoulders'],
  [/pulldown|pull.?up|chin.?up|pullover|lat /i, 'Lats'],
  [/row|deadlift|back extension|hyperextension/i, 'Back'],
  [/wrist|forearm|reverse curl/i, 'Forearms'],
  [/curl/i, 'Biceps'],
  [/bench|chest|fly|flye|pec|push.?up|incline press|decline press|chest press/i, 'Chest'],
];

/** Best-guess equipment and primary muscle for an exercise name (you can edit them later in Train). */
export function guessExercise(name: string): { equipment: string; primary: string[] } {
  const paren = /\(([^)]*)\)/.exec(name)?.[1] ?? '';
  const equipment = EQUIPMENT_WORDS.find(([re]) => re.test(paren))?.[1] ?? EQUIPMENT_WORDS.find(([re]) => re.test(name))?.[1] ?? 'Other';
  const muscle = MUSCLE_RULES.find(([re]) => re.test(name))?.[1];
  return { equipment, primary: muscle ? [muscle] : [] };
}

/** Finds the Plates exercise for a Hevy name: same full name, or same base name with matching equipment. */
export function matchExercise(name: string, exercises: Exercise[]): Exercise | undefined {
  const full = fullNorm(name);
  const exact = exercises.find((e) => fullNorm(e.name) === full);
  if (exact) return exact;
  const base = norm(name);
  const { equipment } = guessExercise(name);
  return exercises.find((e) => norm(e.name) === base && (e.equipment === equipment || !/\(/.test(name)));
}

export interface HevyMapped { workouts: Workout[]; newExercises: Exercise[]; matched: Record<string, string> }

export const hevyWorkoutId = (start: string, title: string) => `hevy-${stableHash(`${start}|${title}`)}`;

/** Hevy workouts → Plates workouts. New exercises are created once per distinct Hevy name. */
export function mapHevy(parsed: HevyParse, existing: Exercise[], makeId: () => string): HevyMapped {
  const newExercises: Exercise[] = [];
  const matched: Record<string, string> = {};
  const idFor = new Map<string, string>();
  const exerciseId = (name: string): string => {
    const k = fullNorm(name);
    const known = idFor.get(k);
    if (known) return known;
    const found = matchExercise(name, existing);
    let id: string;
    if (found) { id = found.id; matched[name] = found.name; } else {
      const g = guessExercise(name);
      const ex: Exercise = { id: makeId(), name, equipment: g.equipment, primary: g.primary, secondary: [], rest_sec: 90, notes: '' };
      newExercises.push(ex);
      id = ex.id;
    }
    idFor.set(k, id);
    return id;
  };
  const workouts: Workout[] = [];
  for (const w of parsed.workouts) {
    const s = parseLooseDate(w.start);
    const e = parseLooseDate(w.end);
    if (!s) continue;
    const id = hevyWorkoutId(w.start, w.title);
    const start_time = chicagoIso(s.date, s.time);
    const end_time = e ? chicagoIso(e.date, e.time) : start_time;
    const exercises: WorkoutExercise[] = w.exercises.map((x, xi) => ({
      exercise_id: exerciseId(x.name),
      rest_sec: 90,
      note: x.notes,
      sets: x.sets.map((st, si) => ({
        id: `${id}-${xi}-${si}`, type: st.type, weight_lb: st.weight_lb, reps: st.reps,
        rep_min: null, rep_max: null, completed: true, rpe: st.rpe, note: '',
      })),
    }));
    workouts.push({ id, routine_id: '', name: w.title, date: s.date, start_time, end_time: end_time < start_time ? start_time : end_time, notes: w.description, exercises });
  }
  return { workouts, newExercises, matched };
}

// ---------- Cal AI PDF report ----------

export interface CalAiItem { name: string; time: string; n: Nutrients }
export interface CalAiDay { date: string; items: CalAiItem[]; reportedKcal: number | null }
export interface CalAiParse { days: CalAiDay[]; weights: ImportedWeight[]; exercises: number; mismatchedDays: string[]; warnings: string[] }

const MONTH_NAMES = '(?:January|February|March|April|May|June|July|August|September|October|November|December)';
const DAY_RE = new RegExp(`^${MONTH_NAMES} \\d{1,2}, \\d{4}$`);
const WEIGHT_RE = new RegExp(`^([\\d.]+)\\s*lbs\\s+(${MONTH_NAMES} \\d{1,2}, \\d{4})$`);
const NUM = '(-?[\\d,]*\\.?\\d+)';
const ITEM_RE = new RegExp(`^(.*?)\\s*${NUM}\\s+${NUM}g\\s+${NUM}g\\s+${NUM}g\\s+${NUM}g\\s+${NUM}g\\s+${NUM}mg\\s+(\\d{1,2}:\\d{2}\\s*[ap]m)\\s*$`, 'i');
const TOTAL_RE = /^TOTAL\s+Calories eaten:\s*([\d,]+)/i;
const n = (s: string) => Number(s.replace(/,/g, ''));

/** Cal AI "Summary Report" PDF text (one string per visual line, in page order) → days of food + weigh-ins. */
export function parseCalAi(lines: string[]): CalAiParse {
  const days: CalAiDay[] = [];
  const weights: ImportedWeight[] = [];
  const warnings: string[] = [];
  let day: CalAiDay | null = null;
  let mode: 'none' | 'food' | 'exercise' = 'none';
  let pending: string[] = [];
  let exercises = 0;
  let sawReport = false;
  for (const raw of lines) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    if (/^Summary Report$/i.test(line) || /Report$/.test(line)) { sawReport = true; continue; }
    if (/^Start: /.test(line)) continue;
    const wm = WEIGHT_RE.exec(line);
    if (wm) {
      const d = parseLooseDate(wm[2]!);
      if (d && Number(wm[1]) > 50) weights.push({ date: d.date, weight_lb: Number(wm[1]), body_fat_pct: null, source: 'Cal AI' });
      continue;
    }
    if (DAY_RE.test(line)) {
      const d = parseLooseDate(line)!;
      day = { date: d.date, items: [], reportedKcal: null };
      days.push(day);
      mode = 'none'; pending = [];
      continue;
    }
    if (!day) continue;
    if (/^Foods Calories Protein/i.test(line)) { mode = 'food'; pending = []; continue; }
    if (/^Exercise Calories/i.test(line)) { mode = 'exercise'; pending = []; continue; }
    const tm = TOTAL_RE.exec(line);
    if (tm) { day.reportedKcal = n(tm[1]!); mode = 'none'; pending = []; continue; }
    if (mode === 'exercise') { if (/\d+ mins?\b/.test(line)) exercises++; continue; }
    if (mode !== 'food') continue;
    const m = ITEM_RE.exec(line);
    if (!m) { pending.push(line); continue; }
    const name = [...pending, m[1] ?? ''].join(' ').replace(/\s+/g, ' ').trim() || 'Food';
    pending = [];
    day.items.push({
      name, time: m[9]!.replace(/\s+/g, '').toLowerCase(),
      n: { kcal: n(m[2]!), protein_g: n(m[3]!), carbs_g: n(m[4]!), fat_g: n(m[5]!), fiber_g: n(m[6]!), sugar_g: n(m[7]!), sodium_mg: n(m[8]!) },
    });
  }
  if (!sawReport && !days.length) warnings.push("This doesn't look like a Cal AI report.");
  const withFood = days.filter((d) => d.items.length);
  // Older reports have 0 for fiber/sugar/sodium on every item — that means "not tracked", not zero.
  for (const d of withFood) {
    if (d.items.every((i) => !i.n.fiber_g && !i.n.sugar_g && !i.n.sodium_mg)) {
      for (const i of d.items) { i.n.fiber_g = null; i.n.sugar_g = null; i.n.sodium_mg = null; }
    }
  }
  const mismatchedDays = withFood
    .filter((d) => d.reportedKcal != null && Math.abs(d.items.reduce((s, i) => s + i.n.kcal, 0) - d.reportedKcal) > 1)
    .map((d) => d.date);
  return { days: withFood, weights, exercises, mismatchedDays, warnings };
}

/** Cal AI days → FoodLog-shaped entries (stored in the FoodArchive tab). Meal comes from the time eaten. */
export function calAiEntries(days: CalAiDay[], settings: Record<string, string>): LogEntry[] {
  const out: LogEntry[] = [];
  for (const d of days) {
    const seen = new Map<string, number>();
    for (const it of d.items) {
      const base = `${d.date}|${it.time}|${it.name}|${it.n.kcal}`;
      const k = (seen.get(base) ?? 0) + 1;
      seen.set(base, k);
      const minutes = minutesFrom12h(it.time);
      out.push({
        id: `calai-${stableHash(`${base}|${k}`)}`,
        date: d.date,
        meal: minutes == null ? 'snack' : mealForMinutes(minutes, settings),
        food_id: '',
        food_name: it.name,
        grams: null,
        servings: null,
        n: it.n,
        entry_method: 'import_calai',
        notes: `Cal AI, ${it.time}`,
        food_source: '',
        place: '',
        is_estimate: false,
      });
    }
  }
  return out;
}
