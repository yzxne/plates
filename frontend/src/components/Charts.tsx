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

export function MuscleBars({ counts }: { counts: Record<string, number> }) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return <p class="muted">No completed sets yet.</p>;
  const max = Math.max(...entries.map(([, n]) => n));
  return (
    <div class="muscle-bars">
      {entries.map(([m, n]) => (
        <div class="mb-row" key={m}>
          <span class="mb-name">{m}</span>
          <span class="mb-track"><span class="mb-fill" style={{ width: `${(n / max) * 100}%` }} /></span>
          <span class="mb-n">{n}</span>
        </div>
      ))}
    </div>
  );
}
