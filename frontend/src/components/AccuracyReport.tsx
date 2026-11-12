// Progress → Estimate accuracy: are estimated foods under- or over-counted, judged by your weight trend? (brief §6A)
// Suggestions only — a correction is used only after you tap "Use".
import { useState } from 'preact/hooks';
import {
  accuracyReport, CORRECTION_KEYS, SOURCE_LABELS, sourceOf, type AccuracyReport as Report, type DayLog,
} from '../../../shared/accuracy';
import { constantsFrom } from '../../../shared/coaching';
import { rowToEntry } from '../../../shared/nutrition';
import type { Row } from '../../../shared/schema';
import { api, errorMessage } from '../api';
import type { CoachData } from '../coachData';
import { today } from '../dates';
import { fmt } from '../format';
import { getSettings, saveSettings } from '../settingsStore';
import { showToast } from '../toast';

async function readTab(tab: string): Promise<Row[]> {
  // One tab per request keeps each backend call small.
  return (await api<{ data: Record<string, Row[]> }>('POST', '/sheet/read', { tabs: [tab] }, 45_000)).data[tab] ?? [];
}

async function buildReport(data: CoachData): Promise<Report> {
  const [log, archive] = [await readTab('FoodLog'), await readTab('FoodArchive')];
  const est = new Map<string, DayLog['est']>();
  for (const e of [...archive, ...log].map(rowToEntry)) {
    const s = sourceOf(e);
    if (!s) continue;
    const m = est.get(e.date) ?? {};
    m[s] = (m[s] ?? 0) + e.n.kcal;
    est.set(e.date, m);
  }
  const days: DayLog[] = data.intake.filter((d) => d.complete && d.kcal > 0).map((d) => ({ date: d.date, kcal: d.kcal, est: est.get(d.date) ?? {} }));
  return accuracyReport(days, data.trend, today(), { energyPerLb: constantsFrom(getSettings()).energyPerLb, formulaBurn: data.initial });
}

const pct = (f: number) => `${Math.round(Math.abs(f - 1) * 100)}%`;
const monthDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit', timeZone: 'UTC' });

export function AccuracyCard({ data }: { data: CoachData }) {
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [, force] = useState(0);

  async function run() {
    setBusy(true);
    setError('');
    try { setReport(await buildReport(data)); } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }

  async function use(key: string, value: number) {
    try {
      await saveSettings({ [key]: String(value) });
      showToast(value === 1 ? 'Correction turned off' : `New estimates will use ×${value}`, 'ok');
      force((n) => n + 1);
    } catch (err) { showToast(errorMessage(err), 'error'); }
  }

  const s = getSettings();
  return (
    <div class="card" id="p-accuracy">
      <div class="card-head"><h2>Estimate accuracy</h2>{report && <span class="muted">{report.confidence}</span>}</div>
      {!report && (
        <>
          <p class="muted tiny">Checks whether your estimated foods (AI, restaurant, cafeteria, Cal AI history) add up with how your weight actually moved. Nothing changes unless you choose a correction.</p>
          <button class="btn" style="width:100%" disabled={busy} onClick={run}>{busy ? 'Crunching…' : 'Run the report'}</button>
        </>
      )}
      {error && <p class="error">{error}</p>}
      {report && <ReportBody r={report} s={s} onUse={use} />}
    </div>
  );
}

function ReportBody({ r, s, onUse }: { r: Report; s: Record<string, string>; onUse: (key: string, value: number) => void }) {
  if (r.confidence === 'not enough data') {
    return (
      <p class="muted">
        Not enough data yet. It needs at least three 4-week stretches with 14+ complete days and 2+ weigh-ins each
        {r.blocks.length ? ` (found ${r.blocks.length})` : ''}, where the amount of estimated food differs by at least 150 kcal/day.
        Weighing in a few times a week helps most.
      </p>
    );
  }
  const f = r.overall.factor;
  return (
    <div>
      <p>
        {f == null || r.overall.gap == null ? 'No estimate-heavy stretches to judge yet.'
          : Math.abs(f - 1) < 0.05 ? <>Your estimates line up with your weight trend (<strong>within 5%</strong>).</>
            : <>When you log estimated food, your log runs about <strong>{fmt(Math.abs(r.overall.gap))} kcal/day {r.overall.gap > 0 ? 'under' : 'over'}</strong> what your weight change implies. Your estimates look about <strong>{pct(f)} {f > 1 ? 'too low' : 'too high'}</strong>.</>}
      </p>
      <p class="muted tiny">
        Yardstick: you burn about <strong>{fmt(r.reference ?? 0)} kcal/day</strong>,{' '}
        {r.referenceFrom === 'regression'
          ? 'worked out by comparing stretches with more vs fewer estimated calories against your weight trend.'
          : 'from the resting-rate formula × your activity level (almost everything was estimated, so this is rough).'}
      </p>

      {r.sources.length > 0 && (
        <table class="plan acc">
          <thead><tr><th>Source</th><th>Suggests</th><th>Using</th><th /></tr></thead>
          <tbody>
            {r.sources.map((x) => {
              const key = CORRECTION_KEYS[x.source];
              const current = key ? Number(s[key] || 1) : null;
              return (
                <tr key={x.source}>
                  <td>{SOURCE_LABELS[x.source]}<br /><small class="muted">{fmt(x.estimatedKcal)} kcal logged</small></td>
                  <td>{x.factor == null ? <small class="muted">needs more</small> : `×${x.factor}`}</td>
                  <td>{key ? `×${current}` : <small class="muted">past data</small>}</td>
                  <td>
                    {key && x.factor != null && x.factor !== current && <button class="btn link" onClick={() => onUse(key, x.factor!)}>Use</button>}
                    {key && current !== 1 && <button class="btn link" onClick={() => onUse(key, 1)}>Off</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <details class="tiny mt">
        <summary>4-week stretches ({r.blocks.length})</summary>
        <table class="plan acc">
          <thead><tr><th>Ending</th><th>Logged</th><th>Est.</th><th>Missing</th></tr></thead>
          <tbody>
            {[...r.blocks].reverse().map((b) => (
              <tr key={b.to}>
                <td>{monthDay(b.to)}</td>
                <td>{fmt(b.logged)}</td>
                <td>{Math.round((b.estimated / b.logged) * 100)}%</td>
                <td>{b.gap == null ? '—' : `${b.gap > 0 ? '+' : ''}${fmt(b.gap)}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p class="muted">
          "Missing" = kcal/day your weight change says you ate but didn't log. Water weight, sparse weigh-ins and unlogged
          snacks all show up here too, so treat suggestions as a nudge, not a measurement. A correction only changes the grams
          suggested for new AI estimates of that source; you can still edit them.
        </p>
      </details>
    </div>
  );
}
