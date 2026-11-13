// Exercise history: records, progress chart, and every session with your body weight that day.
// Used on Train → Exercises and from the workout screen (tap an exercise name).
import { useEffect, useMemo, useState } from 'preact/hooks';
import { bestSet, bestsFor, epley1RM, findStall, isWorkingSet, type LoggedSet, type Workout } from '../../../shared/training';
import { formTips } from '../../../shared/formTips';
import { shiftDate, today } from '../dates';
import { fmt } from '../format';
import { loadWeights, type WeighIn } from '../weightData';
import { UChart, type SeriesSpec } from './UChart';

const RANGES = [['3M', 91], ['6M', 182], ['1Y', 365], ['All', 100000]] as const;
const SERIES: SeriesSpec[] = [
  { label: 'Est. 1RM', color: '#ff6b5b', kind: 'line', unit: 'lb' },
  { label: 'Heaviest', color: '#5ab0ff', kind: 'points', unit: 'lb', digits: 1 },
];

interface Session { w: Workout; sets: LoggedSet[]; e1rm: number; top: number; volume: number; pr: boolean }

/** Body weight on that day: same-day weigh-in, else the closest one within 3 days (marked ≈). */
function weightNear(weights: WeighIn[], date: string): { lb: number; exact: boolean } | null {
  let best: WeighIn | null = null;
  let gap = Infinity;
  for (const w of weights) {
    const d = Math.abs(Date.parse(w.date) - Date.parse(date)) / 86_400_000;
    if (d < gap) { gap = d; best = w; }
  }
  return best && gap <= 3 ? { lb: best.weight_lb, exact: gap === 0 } : null;
}

export function ExerciseHistory({ exerciseId, name, history }: { exerciseId: string; name: string; history: Workout[] }) {
  const [range, setRange] = useState<number>(182);
  const [shown, setShown] = useState(10);
  const [weights, setWeights] = useState<WeighIn[]>([]);
  useEffect(() => { loadWeights().then(setWeights).catch(() => {}); }, []);

  const best = bestSet(exerciseId, history);
  const records = bestsFor(exerciseId, history);
  const stall = findStall(exerciseId, history, today());

  // Oldest → newest, so "new best at the time" can be marked.
  const sessions = useMemo<Session[]>(() => {
    let running = 0;
    return history
      .filter((w) => w.end_time && w.exercises.some((e) => e.exercise_id === exerciseId))
      .sort((a, b) => a.start_time.localeCompare(b.start_time))
      .flatMap((w) => {
        const sets = w.exercises.filter((e) => e.exercise_id === exerciseId).flatMap((e) => e.sets.filter((s) => s.completed));
        const work = sets.filter(isWorkingSet);
        if (!work.length) return [];
        const e1rm = Math.max(0, ...work.map((s) => epley1RM(s.weight_lb ?? 0, s.reps ?? 0)));
        const pr = running > 0 && e1rm > running + 0.01;
        running = Math.max(running, e1rm);
        return [{
          w, sets, e1rm, pr,
          top: Math.max(0, ...work.map((s) => s.weight_lb ?? 0)),
          volume: work.reduce((n, s) => n + (s.weight_lb ?? 0) * (s.reps ?? 0), 0),
        }];
      });
  }, [exerciseId, history]);

  const chart = useMemo(() => {
    const from = shiftDate(today(), -range);
    const inRange = sessions.filter((s) => s.w.date >= from);
    return {
      x: inRange.map((s) => Date.parse(`${s.w.date}T12:00:00Z`) / 1000),
      ys: [inRange.map((s) => (s.e1rm ? Math.round(s.e1rm) : null)), inRange.map((s) => s.top || null)],
    };
  }, [sessions, range]);

  const list = [...sessions].reverse();
  const tips = formTips(name);
  return (
    <>
      <details class="card form-tips" open>
        <summary><h2>Form tips</h2></summary>
        <ul>{tips.tips.map((t) => <li key={t}>{t}</li>)}</ul>
        {tips.general && <small class="muted">General tips; no specific ones for this exercise yet.</small>}
      </details>

      <div class="card">
        <h2>Records</h2>
        {best ? (
          <div class="stat-grid">
            <div><small>Est. 1-rep max</small><strong>{fmt(records.e1rm)} lb</strong><small>{best.date}</small></div>
            <div><small>Heaviest</small><strong>{fmt(records.weight, 1)} lb</strong><small /></div>
            <div><small>Best set</small><strong>{fmt(best.weight_lb, 1)} × {best.reps}</strong><small /></div>
            <div><small>Best session volume</small><strong>{fmt(records.session_volume)} lb</strong><small /></div>
          </div>
        ) : <p class="muted">No working sets logged yet.</p>}
        {stall && <p class="warn tiny mt">No new best in {Math.round(stall.days / 7)} weeks ({stall.sessions} sessions). Try a lighter week (Train → Stalled) or a variation.</p>}
      </div>

      {sessions.length > 1 && (
        <div class="card">
          <h2>Progress</h2>
          {chart.x.length > 1 ? <UChart x={chart.x} ys={chart.ys} series={SERIES} height={170} /> : <p class="muted">Not enough sessions in this range.</p>}
          <div class="chips">
            {RANGES.map(([label, d]) => <button key={label} class={`chip ${range === d ? 'on' : ''}`} onClick={() => setRange(d)}>{label}</button>)}
          </div>
          <small class="muted">Red line: estimated 1-rep max (weight × (1 + reps ÷ 30)). Blue dots: heaviest set.</small>
        </div>
      )}

      <h3 class="group-label">Sessions</h3>
      {list.length === 0 && <p class="muted">Not logged yet.</p>}
      {list.slice(0, shown).map((s) => {
        const bw = weightNear(weights, s.w.date);
        return (
          <div class={`card hist-session ${s.pr ? 'pr' : ''}`} key={s.w.id}>
            <div class="hist-top">
              <strong>{new Date(`${s.w.date}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: s.w.date.slice(0, 4) === today().slice(0, 4) ? undefined : 'numeric' })}</strong>
              {s.pr && <span class="pr-badge">🏆 PR</span>}
              <span class="muted grow-right">{bw ? `Body ${bw.exact ? '' : '≈'}${fmt(bw.lb, 1)} lb` : ''}</span>
            </div>
            <div class="hist-sets">
              {s.sets.map((x, i) => (
                <span key={x.id || i} class={`hist-set ${x.type === 'W' ? 'warm' : ''}`}>
                  <small>{x.type === 'W' ? 'W' : x.type === 'F' ? 'F' : ''}</small>
                  {x.weight_lb != null ? fmt(x.weight_lb, 1) : 'BW'} × {x.reps ?? 0}
                </span>
              ))}
            </div>
            <small class="muted">{s.w.name} · est. 1RM {fmt(s.e1rm)} lb · volume {fmt(s.volume)} lb</small>
          </div>
        );
      })}
      {list.length > shown && <button class="btn link center" onClick={() => setShown(shown + 20)}>Show older sessions</button>}
    </>
  );
}
