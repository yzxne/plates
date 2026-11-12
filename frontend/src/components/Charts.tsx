// Small original SVG charts (no chart library).

export interface Point { label: string; value: number }

export function BarChart({ points, unit = '', height = 140 }: { points: Point[]; unit?: string; height?: number }) {
  if (!points.length) return <p class="muted">No data for this range yet.</p>;
  const max = Math.max(...points.map((p) => p.value), 1);
  const w = 320;
  const gap = 4;
  const bw = Math.max(4, (w - gap * (points.length - 1)) / points.length);
  const fmt = (v: number) => (v >= 10000 ? `${Math.round(v / 1000)}k` : Math.round(v).toLocaleString('en-US'));
  return (
    <figure class="chart">
      <svg viewBox={`0 0 ${w} ${height + 18}`} role="img" aria-label={`Bar chart, max ${fmt(max)} ${unit}`}>
        <line x1="0" x2={w} y1={height} y2={height} class="axis" />
        {points.map((p, i) => {
          const h = (p.value / max) * (height - 16);
          const x = i * (bw + gap);
          return (
            <g key={i}>
              <rect x={x} y={height - h} width={bw} height={h} rx="3" class="bar"><title>{`${p.label}: ${fmt(p.value)} ${unit}`}</title></rect>
              {(points.length <= 8 || i === 0 || i === points.length - 1) && (
                <text x={x + bw / 2} y={height + 14} text-anchor="middle" class="tick">{p.label}</text>
              )}
            </g>
          );
        })}
        <text x="0" y="10" class="tick">{fmt(max)} {unit}</text>
      </svg>
    </figure>
  );
}

/** Sets per muscle. With `target`, bars are colored: under = amber, in range = green, over = blue, with range marks. */
export function MuscleBars({ counts, target }: { counts: Record<string, number>; target?: { min: number; max: number } }) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return <p class="muted">No completed sets yet.</p>;
  const max = Math.max(...entries.map(([, n]) => n), target ? target.max * 1.1 : 0);
  const zone = (n: number) => (!target ? '' : n < target.min ? 'under' : n > target.max ? 'over' : 'ok');
  return (
    <div class="muscle-bars">
      {entries.map(([m, n]) => (
        <div class="mb-row" key={m}>
          <span class="mb-name">{m}</span>
          <span class="mb-track">
            <span class={`mb-fill ${zone(n)}`} style={{ width: `${(n / max) * 100}%` }} />
            {target && <><i class="mb-mark" style={{ left: `${(target.min / max) * 100}%` }} /><i class="mb-mark" style={{ left: `${(target.max / max) * 100}%` }} /></>}
          </span>
          <span class="mb-n">{n}</span>
        </div>
      ))}
    </div>
  );
}

/** Hexagon radar of working sets per muscle group: this period (filled) vs the one before (dashed). Original SVG. */
export function MuscleRadar({ now, prev }: { now: Record<string, number>; prev: Record<string, number> }) {
  const groups = Object.keys(now);
  const max = Math.max(1, ...groups.map((g) => Math.max(now[g] ?? 0, prev[g] ?? 0)));
  const C = 130; const R = 92;
  const pt = (i: number, r: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / groups.length;
    return [C + r * Math.cos(a), C + r * Math.sin(a)] as const;
  };
  const poly = (vals: Record<string, number>) => groups.map((g, i) => pt(i, (R * (vals[g] ?? 0)) / max).join(',')).join(' ');
  return (
    <div>
      <svg class="radar" viewBox="0 0 260 260" role="img" aria-label={`Sets per muscle group: ${groups.map((g) => `${g} ${now[g] ?? 0}`).join(', ')}`}>
        {[0.25, 0.5, 0.75, 1].map((f) => <polygon key={f} class="grid" points={groups.map((_, i) => pt(i, R * f).join(',')).join(' ')} />)}
        {groups.map((_, i) => { const [x, y] = pt(i, R); return <line key={i} class="grid" x1={C} y1={C} x2={x} y2={y} />; })}
        <polygon class="prev" points={poly(prev)} />
        <polygon class="now" points={poly(now)} />
        {groups.map((g, i) => {
          const [x, y] = pt(i, R + 18);
          return <text key={g} class="axis-label" x={x} y={y + 4} text-anchor="middle">{g} {now[g] ?? 0}</text>;
        })}
      </svg>
      <div class="legend"><span><i style={{ background: 'var(--fat)' }} />Last 30 days</span><span><i style={{ background: 'var(--muted)' }} />30 days before</span></div>
    </div>
  );
}
