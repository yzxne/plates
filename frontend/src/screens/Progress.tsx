import { useEffect, useMemo, useState } from 'preact/hooks';
import { loadSleep, sleepLabel, weekAverage, type Night } from '../sleepData';
import { addDays, daysBetween, nextCheckInDay, weekdayOf } from '../../../shared/coaching';
import { WEEKDAYS } from '../../../shared/schema';
import { errorMessage } from '../api';
import { cachedCoach, ensureCheckIn, expenditureSeries, loadCoach, subscribeCoach, targetsForDate, type CoachData } from '../coachData';
import { AccuracyCard } from '../components/AccuracyReport';
import { UChart, type SeriesSpec } from '../components/UChart';
import { today } from '../dates';
import { fmt } from '../format';
import { getSettings } from '../settingsStore';
import { showToast } from '../toast';
import { showUndo } from '../undo';
import { addWeight, deleteWeight, loadWeights, type WeighIn } from '../weightData';
import { SkeletonScreen } from '../components/Skeleton';

const RANGES = [['1W', 7], ['1M', 30], ['3M', 91], ['6M', 182], ['1Y', 365], ['All', 100000]] as const;
export type ProgressSection = 'weight' | 'expenditure' | 'calories' | null;

const ts = (date: string) => Date.parse(`${date}T12:00:00Z`) / 1000;
const GOAL_LABEL: Record<string, string> = { lose: 'Lose weight', maintain: 'Maintain', gain: 'Gain weight' };

const WEIGHT_SERIES: SeriesSpec[] = [
  { label: 'Scale', color: '#9ea4ad', kind: 'points', unit: 'lb', digits: 1 },
  { label: 'Trend', color: '#b49cff', kind: 'line', unit: 'lb', digits: 1 },
];
const EXP_SERIES: SeriesSpec[] = [{ label: 'Expenditure', color: '#ff8a65', kind: 'line', unit: 'kcal' }];
const CAL_SERIES: SeriesSpec[] = [
  { label: 'Eaten', color: '#5ab0ff', kind: 'bars', unit: 'kcal' },
  { label: 'Target', color: '#f0f2f5', kind: 'step', unit: 'kcal' },
];

export function Progress({ focus }: { focus?: ProgressSection }) {
  const [data, setData] = useState<CoachData | null>(cachedCoach());
  const [error, setError] = useState('');
  const [range, setRange] = useState(30);

  useEffect(() => {
    loadCoach(true).then(setData).catch((err) => setError(errorMessage(err)));
    return subscribeCoach(setData);
  }, []);
  useEffect(() => {
    if (focus && data) setTimeout(() => document.getElementById(`p-${focus}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }, [focus, !!data]);

  const t = today();
  const from = useMemo(() => {
    if (!data) return t;
    const earliest = [data.weights.map((w) => w.date).sort()[0], data.intake[0]?.date].filter(Boolean).sort()[0] ?? t;
    const r = addDays(t, -(range - 1));
    return r < earliest ? earliest : r;
  }, [data, range]);

  const weight = useMemo(() => {
    if (!data) return null;
    const pts = data.trend.filter((p) => p.date >= from);
    return { x: pts.map((p) => ts(p.date)), ys: [pts.map((p) => p.scale), pts.map((p) => Math.round(p.trend * 10) / 10)] };
  }, [data, from]);

  const exp = useMemo(() => {
    if (!data) return null;
    const pts = expenditureSeries(from);
    return { x: pts.map((p) => ts(p.date)), ys: [pts.map((p) => Math.round(p.kcal))], last: pts.at(-1) };
  }, [data, from]);

  const cal = useMemo(() => {
    if (!data) return null;
    const byDate = new Map(data.intake.map((d) => [d.date, d]));
    const x: number[] = [];
    const eaten: (number | null)[] = [];
    const target: (number | null)[] = [];
    for (let d = from; d <= t; d = addDays(d, 1)) {
      x.push(ts(d));
      const k = byDate.get(d)?.kcal ?? 0;
      eaten.push(k > 0 ? k : null);
      target.push(targetsForDate(d)?.kcal ?? data.dayTargets.get(d)?.kcal ?? null);
    }
    return { x, ys: [eaten, target] };
  }, [data, from]);

  if (error) return <section><header class="screen-head"><h1>Progress</h1></header><div class="card"><p class="error">{error}</p></div></section>;
  if (!data) return <SkeletonScreen title="Progress" cards={3} />;

  return (
    <section>
      <header class="screen-head"><h1>Progress</h1></header>
      <div class="chips range-chips">
        {RANGES.map(([label, d]) => <button key={label} class={`chip ${range === d ? 'on' : ''}`} onClick={() => setRange(d)}>{label}</button>)}
      </div>

      <div class="card" id="p-weight">
        <div class="card-head"><h2>Weight</h2><span class="muted">{data.trend.length ? `Trend ${fmt(data.trend.at(-1)!.trend, 1)} lb` : ''}</span></div>
        {weight && weight.x.length > 1 ? <UChart x={weight.x} ys={weight.ys} series={WEIGHT_SERIES} /> : <p class="muted">Log weigh-ins on Today to see your trend.</p>}
        <small class="muted">Dots: scale weight. Line: trend weight (smoothed, see docs/algorithm.md). Several weigh-ins on one day: the latest counts.</small>
        <RecentWeighIns />
      </div>

      <SleepCard />

      <div class="card" id="p-expenditure">
        <div class="card-head"><h2>Expenditure</h2><span class="muted">{exp?.last ? `${fmt(exp.last.kcal)} kcal · ${exp.last.confidence}` : ''}</span></div>
        {exp && exp.x.length > 1 ? <UChart x={exp.x} ys={exp.ys} series={EXP_SERIES} /> : <p class="muted">Needs your profile (Settings) and a weigh-in.</p>}
        <small class="muted">From what you eat on complete days and how your trend weight moves. "Low data" → "settling" → "stable" over 2–4 weeks.</small>
      </div>

      <div class="card" id="p-calories">
        <div class="card-head"><h2>Calories vs target</h2></div>
        {cal && cal.ys[0]!.some((v) => v != null) ? <UChart x={cal.x} ys={cal.ys} series={CAL_SERIES} /> : <p class="muted">Nothing logged in this range.</p>}
      </div>

      <MacroAverages data={data} from={from} />
      <Habits data={data} from={from} />
      <Strategy data={data} />
      <AccuracyCard data={data} />
      <CheckInHistory data={data} />
    </section>
  );
}

function MacroAverages({ data, from }: { data: CoachData; from: string }) {
  const days = data.intake.filter((d) => d.date >= from && d.kcal > 0);
  if (!days.length) return null;
  const sum = { kcal: 0, protein_g: 0, fat_g: 0, carbs_g: 0 };
  const tsum = { kcal: 0, protein_g: 0, fat_g: 0, carbs_g: 0 };
  let tn = 0;
  for (const d of days) {
    const m = data.macros.get(d.date);
    sum.kcal += d.kcal;
    sum.protein_g += m?.protein_g ?? 0;
    sum.fat_g += m?.fat_g ?? 0;
    sum.carbs_g += m?.carbs_g ?? 0;
    const t = targetsForDate(d.date);
    if (t) { tn++; tsum.kcal += t.kcal; tsum.protein_g += t.protein_g; tsum.fat_g += t.fat_g; tsum.carbs_g += t.carbs_g; }
  }
  const rows = [['Calories', 'kcal', ''], ['Protein', 'protein_g', 'g'], ['Fat', 'fat_g', 'g'], ['Carbs', 'carbs_g', 'g']] as const;
  return (
    <div class="card">
      <div class="card-head"><h2>Daily averages</h2><span class="muted">{days.length} logged day{days.length === 1 ? '' : 's'}</span></div>
      {rows.map(([label, k, unit]) => {
        const a = sum[k] / days.length;
        const t = tn ? tsum[k] / tn : 0;
        return (
          <div class="macro-row" key={k}>
            <div class="macro-label"><span>{label}</span><span class="muted">{fmt(a)}{unit}{t ? ` of ${fmt(t)}${unit}` : ''}</span></div>
            <div class="macro-track"><span class={`macro-fill k-${k}`} style={{ width: `${t ? Math.min(100, (a / t) * 100) : 0}%` }} />{t ? <span class="macro-mark" /> : null}</div>
          </div>
        );
      })}
    </div>
  );
}

function Habits({ data, from }: { data: CoachData; from: string }) {
  const t = today();
  const weeks = Math.min(26, Math.max(4, Math.ceil((daysBetween(from, t) + 1) / 7)));
  // Columns are weeks (Mon start), rows are Mon..Sun.
  const lastMonday = addDays(t, -((new Date(`${t}T12:00:00Z`).getUTCDay() + 6) % 7));
  const firstMonday = addDays(lastMonday, -(weeks - 1) * 7);
  const intake = new Map(data.intake.map((d) => [d.date, d]));
  const weighed = new Set(data.weights.map((w) => w.date));
  const grid = (cell: (date: string) => string) => (
    <div class="habit" style={{ gridTemplateColumns: `repeat(${weeks}, 1fr)` }}>
      {WEEKDAYS.map((_, r) => Array.from({ length: weeks }, (_, c) => {
        const date = addDays(firstMonday, c * 7 + r);
        return <span key={date} class={`hcell ${date > t ? 'future' : cell(date)}`} title={date} />;
      }))}
    </div>
  );
  return (
    <div class="card">
      <h2>Habits</h2>
      <p class="muted tiny-pad">Food logging · bright = day marked complete, dim = logged</p>
      {grid((d) => { const x = intake.get(d); return x?.complete ? 'full' : x && x.kcal > 0 ? 'half' : ''; })}
      <p class="muted tiny-pad">Weigh-ins</p>
      {grid((d) => (weighed.has(d) ? 'full' : ''))}
    </div>
  );
}

function Strategy({ data }: { data: CoachData }) {
  const s = getSettings();
  const latest = data.checkins.at(-1);
  const next = nextCheckInDay(today(), s.checkin_weekday || 'Mon');
  const inDays = daysBetween(today(), next);
  const [busy, setBusy] = useState(false);

  async function checkInNow() {
    if (!confirm('Recalculate targets now? (Normally this happens automatically on your check-in day.)')) return;
    setBusy(true);
    try {
      const r = await ensureCheckIn(true);
      showToast(r.ran ? `New targets average ${fmt(r.avg)} kcal/day` : r.why, r.ran ? 'ok' : 'info', 6000);
    } catch (err) {
      showToast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="card" id="p-strategy">
      <h2>Strategy</h2>
      <p>
        <strong>{GOAL_LABEL[s.goal_type ?? 'maintain'] ?? 'Maintain'}</strong>
        {s.goal_type !== 'maintain' ? <span class="muted"> · {s.goal_rate_lb_per_week} lb/week</span> : null}
        <span class="muted"> · check-in {s.checkin_weekday} (in {inDays} day{inDays === 1 ? '' : 's'})</span>
      </p>
      {latest ? <PlanStack plan={latest.plan} /> : <p class="muted">Your first plan appears after a weigh-in and your profile (sex, birth date, height) in Settings.</p>}
      {latest && <small class="muted">● training day · weekly budget {fmt(Object.values(latest.plan).reduce((a, d) => a + d.kcal, 0))} kcal</small>}
      <button class="btn link" disabled={busy} onClick={checkInNow}>Recalculate now</button>
    </div>
  );
}

/** Each day's target as a column: protein / fat / carbs blocks sized by their calories, total on top. */
function PlanStack({ plan }: { plan: CoachData['checkins'][number]['plan'] }) {
  const days = WEEKDAYS.filter((d) => plan[d]);
  const max = Math.max(1, ...days.map((d) => plan[d]!.kcal));
  const H = 150; // px for the biggest day
  const h = (kcal: number) => `${Math.max(18, (kcal / max) * H)}px`;
  return (
    <div class="stack" role="table" aria-label="Daily targets">
      {days.map((d) => {
        const p = plan[d]!;
        return (
          <div key={d} role="row" class={`stack-day ${weekdayOf(today()) === d ? 'today' : ''}`}
            aria-label={`${d}: ${fmt(p.kcal)} kcal, ${p.protein_g} g protein, ${p.fat_g} g fat, ${p.carbs_g} g carbs`}>
            <span class="stack-kcal">{fmt(p.kcal)}</span>
            <span class="stack-seg p" style={{ height: h(p.protein_g * 4) }}>{p.protein_g}P</span>
            <span class="stack-seg f" style={{ height: h(p.fat_g * 9) }}>{p.fat_g}F</span>
            <span class="stack-seg c" style={{ height: h(p.carbs_g * 4) }}>{p.carbs_g}C</span>
            <span class="stack-dow">{d.slice(0, 1)}{p.training ? '●' : ''}</span>
          </div>
        );
      })}
    </div>
  );
}

function CheckInHistory({ data }: { data: CoachData }) {
  if (!data.checkins.length) return null;
  return (
    <div class="card">
      <h2>Check-ins</h2>
      <ul class="plain checkins">
        {[...data.checkins].reverse().slice(0, 20).map((c) => (
          <li key={c.date}>
            <div><strong>{c.date}</strong> · {fmt(c.avg)} kcal/day avg · trend {fmt(c.trend, 1)} lb</div>
            <small class="muted">{c.reason}</small>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Last night and the 7-day average, from the morning Shortcut. Hidden until the first night arrives. */
function SleepCard() {
  const [nights, setNights] = useState<Night[]>([]);
  useEffect(() => { void loadSleep(true).then(setNights); }, []);
  if (!nights.length) return null;
  const last = nights[0]!;
  const week = weekAverage(nights, today());
  return (
    <div class="card" id="p-sleep">
      <div class="card-head"><h2>Sleep</h2><span class="muted">{week ? `7-day avg ${sleepLabel(week.avg)}` : ''}</span></div>
      <p class="no-mb">Last: <strong>{sleepLabel(last.asleep_min)}</strong>{last.bed_time && last.wake_time ? <span class="muted"> · {last.bed_time}–{last.wake_time}</span> : null}{last.date !== today() ? <span class="muted"> · {last.date}</span> : null}</p>
      <div class="sleep-bars" aria-hidden="true">
        {nights.slice(0, 14).reverse().map((n) => <span key={n.date} class={n.asleep_min < 360 ? 'short' : ''} style={{ height: `${Math.min(100, (n.asleep_min / 600) * 100)}%` }} title={`${n.date}: ${sleepLabel(n.asleep_min)}`} />)}
      </div>
      <small class="muted">From Apple Health each morning. Orange: under 6 hours.</small>
    </div>
  );
}

/** Last weigh-ins with a delete button (fix a typo). Deleting shows Undo; the trend reloads either way. */
function RecentWeighIns() {
  const [list, setList] = useState<WeighIn[] | null>(null);
  const [open, setOpen] = useState(false);
  const reload = () => loadWeights(true).then(setList).catch(() => setList([]));
  useEffect(() => { if (open && !list) void reload(); }, [open]);
  async function remove(w: WeighIn) {
    try {
      await deleteWeight(w);
      setList((l) => (l ?? []).filter((x) => x.id !== w.id));
      void loadCoach(true);
      showUndo(`Deleted ${fmt(w.weight_lb, 1)} lb (${w.date})`, {
        undo: async () => { await addWeight(w.weight_lb, w.date); await reload(); void loadCoach(true); },
      });
    } catch (err) { showToast(errorMessage(err), 'error'); }
  }
  return (
    <details class="weighins" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>Recent weigh-ins</summary>
      {list === null ? <p class="muted tiny-pad">Loading…</p> : list.length === 0 ? <p class="muted tiny-pad">No weigh-ins yet.</p> : (
        <div class="list">
          {list.slice(0, 14).map((w, i, all) => {
            const sameDay = all.filter((x) => x.date === w.date);
            const counts = sameDay[0]?.id === w.id; // list is newest first
            return (
              <div class="row" key={w.id}>
                <span class="row-text">
                  <span>{fmt(w.weight_lb, 1)} lb{sameDay.length > 1 && !counts ? <small class="muted"> · not counted (later entry that day)</small> : null}</span>
                  <small class="muted">{w.date}{w.time ? ` · ${w.time}` : ''}</small>
                </span>
                <button class="btn small-btn danger" aria-label={`Delete ${fmt(w.weight_lb, 1)} lb on ${w.date}`} onClick={() => remove(w)}>Delete</button>
              </div>
            );
          })}
        </div>
      )}
    </details>
  );
}
