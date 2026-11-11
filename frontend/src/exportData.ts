// Exports (brief Phase 7): a full .xlsx copy of the Sheet, and a weekly summary note (.md) for Obsidian.
// Both are built on this device; nothing is uploaded anywhere.
import { MEAL_LABELS, MEALS, rowToEntry, totals } from '../../shared/nutrition';
import { TAB_NAMES, TABS, type Row, type TabName } from '../../shared/schema';
import { formatDuration, setsPerMuscle, workoutTotals } from '../../shared/training';
import { api } from './api';
import { cachedCoach, loadCoach } from './coachData';
import { addDays } from '../../shared/coaching';
import { readTabs } from './foodData';
import { exerciseMap, loadExercises, loadHistory } from './trainData';

export type Progress = (msg: string) => void;

/** Shares the file (iPhone share sheet → Save to Files) or downloads it (computer). */
export async function saveFile(blob: Blob, name: string): Promise<void> {
  const file = new File([blob], name, { type: blob.type });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] }) && /iPhone|iPad|Android/i.test(navigator.userAgent)) {
    try {
      await nav.share({ files: [file], title: name });
      return;
    } catch (err) {
      if ((err as Error).name === 'AbortError') return; // you closed the share sheet
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

const stamp = (d = new Date()) => d.toISOString().slice(0, 10);

/** Every tab of the Sheet as one Excel workbook (deleted rows left out). */
export async function exportXlsx(progress: Progress): Promise<void> {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const sheets = [];
  for (const tab of TAB_NAMES) {
    progress(`Reading ${tab}…`);
    // One tab per request keeps each backend call small.
    const rows = (await api<{ data: Record<string, Row[]> }>('POST', '/sheet/read', { tabs: [tab] }, 45_000)).data[tab] ?? [];
    const cols = (TABS[tab as TabName] as readonly string[]).filter((c) => c !== 'deleted_at');
    const data = [
      cols.map((c) => ({ value: c, fontWeight: 'bold' as const })),
      ...rows.map((r) => cols.map((c) => {
        const v = r[c];
        return v === '' || v == null ? null : v;
      })),
    ];
    sheets.push({ sheet: tab, data, stickyRowsCount: 1, columns: cols.map((c) => ({ width: Math.min(40, Math.max(10, c.length + 2)) })) });
  }
  progress('Building the file…');
  const blob = await writeXlsxFile(sheets).toBlob();
  await saveFile(blob, `plates-${stamp()}.xlsx`);
}

const r0 = (n: number) => Math.round(n).toLocaleString('en-US');
const r1 = (n: number) => (Math.round(n * 10) / 10).toString();
const dayName = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

/** Markdown summary for the Mon–Sun week starting `monday`. */
export async function weeklyMarkdown(monday: string): Promise<string> {
  const sunday = addDays(monday, 6);
  const range = { date__gte: monday, date__lte: sunday };
  const [d, coach, history] = await Promise.all([
    readTabs(['Days', 'FoodLog', 'FoodArchive', 'CheckIns'], { Days: range, FoodLog: range, FoodArchive: range, CheckIns: range }),
    loadCoach().catch(() => cachedCoach()),
    loadHistory().catch(() => []),
    loadExercises().catch(() => []),
  ]);
  const entries = [...(d.FoodArchive ?? []), ...(d.FoodLog ?? [])].map(rowToEntry);
  const days = new Map((d.Days ?? []).map((r) => [String(r.date), r]));
  const lines: string[] = [
    '---', `week: ${monday}`, 'tags: [plates, weekly]', '---', '',
    `# Plates week of ${dayName(monday)} – ${dayName(sunday)}`, '',
    '## Nutrition', '',
    '| Day | Calories | Target | Protein | Carbs | Fat | Complete |',
    '|---|---:|---:|---:|---:|---:|:---:|',
  ];
  const logged: { kcal: number; p: number; c: number; f: number }[] = [];
  for (let date = monday; date <= sunday; date = addDays(date, 1)) {
    const list = entries.filter((e) => e.date === date);
    const t = totals(list);
    const row = days.get(date);
    const target = Number(row?.target_kcal) || 0;
    const complete = row?.day_complete === true || row?.day_complete === 'TRUE';
    if (list.length) logged.push({ kcal: t.kcal, p: t.protein_g, c: t.carbs_g, f: t.fat_g });
    lines.push(`| ${dayName(date)} | ${list.length ? r0(t.kcal) : '—'} | ${target ? r0(target) : '—'} | ${list.length ? r0(t.protein_g) + ' g' : '—'} | ${list.length ? r0(t.carbs_g) + ' g' : '—'} | ${list.length ? r0(t.fat_g) + ' g' : '—'} | ${complete ? '✓' : ''} |`);
  }
  if (logged.length) {
    const avg = (k: 'kcal' | 'p' | 'c' | 'f') => logged.reduce((s, x) => s + x[k], 0) / logged.length;
    lines.push('', `Average over ${logged.length} logged day(s): **${r0(avg('kcal'))} kcal**, ${r0(avg('p'))} g protein, ${r0(avg('c'))} g carbs, ${r0(avg('f'))} g fat.`);
    const top = new Map<string, number>();
    for (const e of entries) top.set(e.food_name, (top.get(e.food_name) ?? 0) + e.n.kcal);
    const best = [...top].sort((a, b) => b[1] - a[1]).slice(0, 5);
    lines.push('', 'Biggest calorie sources: ' + best.map(([n, k]) => `${n} (${r0(k)})`).join(', ') + '.');
    const byMeal = new Map<string, number>();
    for (const e of entries) byMeal.set(e.meal, (byMeal.get(e.meal) ?? 0) + e.n.kcal);
    lines.push('', 'By meal: ' + MEALS.filter((m) => byMeal.has(m)).map((m) => `${MEAL_LABELS[m]} ${r0(byMeal.get(m)! / logged.length)}/day`).join(' · ') + '.');
  } else {
    lines.push('', 'No food logged this week.');
  }

  lines.push('', '## Weight', '');
  const weighIns = (coach?.weights ?? []).filter((w) => w.date >= monday && w.date <= sunday).sort((a, b) => a.date.localeCompare(b.date));
  const trendAt = (date: string) => [...(coach?.trend ?? [])].reverse().find((t) => t.date <= date)?.trend;
  const tStart = trendAt(addDays(monday, -1));
  const tEnd = trendAt(sunday);
  if (weighIns.length) lines.push('Weigh-ins: ' + weighIns.map((w) => `${dayName(w.date)} ${r1(w.weight_lb)} lb`).join(', ') + '.');
  else lines.push('No weigh-ins this week.');
  if (tEnd != null) lines.push('', `Trend weight: **${r1(tEnd)} lb**${tStart != null ? ` (${tEnd - tStart >= 0 ? '+' : ''}${r1(tEnd - tStart)} lb this week)` : ''}.`);

  lines.push('', '## Training', '');
  const workouts = history.filter((w) => w.date >= monday && w.date <= sunday).sort((a, b) => a.start_time.localeCompare(b.start_time));
  if (workouts.length) {
    const names = exerciseMap();
    for (const w of workouts) {
      const t = workoutTotals(w);
      lines.push(`- **${dayName(w.date)} — ${w.name}**: ${t.sets} sets, ${r0(t.volume)} lb volume, ${formatDuration(t.durationSec)}`);
      lines.push(`  - ${w.exercises.map((e) => names.get(e.exercise_id)?.name ?? 'Exercise').join(', ')}`);
    }
    const muscles = Object.entries(setsPerMuscle(workouts, names)).sort((a, b) => b[1] - a[1]);
    if (muscles.length) lines.push('', 'Working sets per muscle: ' + muscles.map(([m, n]) => `${m} ${n}`).join(' · ') + '.');
  } else {
    lines.push('No workouts this week.');
  }

  const checkIn = (d.CheckIns ?? [])[0];
  if (checkIn) {
    lines.push('', '## Check-in', '', `${String(checkIn.date)}: expenditure ≈ ${r0(Number(checkIn.expenditure_kcal))} kcal/day, new average target ${r0(Number(checkIn.weekly_budget_kcal) / 7)} kcal/day.`);
    if (checkIn.reason) lines.push('', `> ${String(checkIn.reason)}`);
  }
  lines.push('', `_Exported from Plates on ${stamp()}._`, '');
  return lines.join('\n');
}

export async function exportWeekly(monday: string): Promise<void> {
  const md = await weeklyMarkdown(monday);
  await saveFile(new Blob([md], { type: 'text/markdown' }), `Plates week ${monday}.md`);
}
